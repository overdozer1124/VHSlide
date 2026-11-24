import type { HistorySQL } from "./historyStore.ts";
import { featureVersionSchema, versionTriggers } from "./featureVersions.ts";
import { parseDeck } from "./model.ts";
import type { Element, Slide } from "./model.ts";

/** Free-edit slides (stage 1): the teacher designates one slide as a
 * base; each student edits their own copy, stored as an "answer" next
 * to the definition — the worksheet pattern, except the answer is a
 * whole slide. Students can only ever read and write their own copy;
 * the teacher's original slide and the shared deck are never touched.
 *
 * Review-settled rules (PR #11, 2026-11-24):
 * - one answer's JSON is at most 256KB; all answers and answer photos
 *   of a deck total at most 50MB (413 past that);
 * - answers are validated like a one-slide deck load, and learning
 *   parts (worksheet / survey / webbing / thinking / prev-answer
 *   bindings), embeds, external links, data: photos and speaker notes
 *   are refused;
 * - a photo src must be this deck's asset path, and the asset must
 *   either appear in the base snapshot or be the author's own
 *   recorded answer photo for this definition;
 * - the base snapshot strips speaker notes and the same learning
 *   parts, so nothing teacher-only reaches students;
 * - answer photos are uploaded through a dedicated gate (open
 *   definitions, the author's own answer, at most 10 per answer) and
 *   stay readable only by the author and the host, because they are
 *   deck assets no deck slide references (see mayReadAsset);
 * - saves carry the updated stamp the client last saw; a mismatch is
 *   a 409 so the client reloads instead of overwriting.
 */
export class EditSlideError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const insist = (ok: unknown, status: number, message: string): void => {
  if (!ok) throw new EditSlideError(status, message);
};

export const editSlideSchema =
  featureVersionSchema +
  `
CREATE TABLE IF NOT EXISTS edit_slide_defs(id TEXT PRIMARY KEY, deck TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE, source TEXT NOT NULL, base TEXT NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS edit_slide_answers(def TEXT NOT NULL REFERENCES edit_slide_defs(id) ON DELETE CASCADE, author TEXT NOT NULL, slide TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(def,author));
CREATE TABLE IF NOT EXISTS edit_slide_answer_assets(asset TEXT PRIMARY KEY, def TEXT NOT NULL REFERENCES edit_slide_defs(id) ON DELETE CASCADE, author TEXT NOT NULL, hash TEXT NOT NULL, bytes INTEGER NOT NULL, mime TEXT NOT NULL, created INTEGER NOT NULL);` +
  // The feature counter feeds the shared deck poll; the deck's own
  // document version is never touched by these tables.
  versionTriggers("edit_slide_defs", "editslides", (a) => `${a}.deck`) +
  versionTriggers(
    "edit_slide_answers",
    "editslides",
    (a) => `COALESCE((SELECT deck FROM edit_slide_defs WHERE id=${a}.def),'')`,
  );

export const MAX_EDIT_DEFS_PER_DECK = 50;
export const MAX_EDIT_ANSWERS_PER_DEF = 500;
export const MAX_EDIT_ANSWER_BYTES = 256_000;
export const MAX_EDIT_DECK_BYTES = 50_000_000;
export const MAX_EDIT_ANSWER_ASSETS = 10;

export type EditSlideStatus = "draft" | "open" | "closed";
export type EditSlideAnswerView = {
  author: string;
  name: string;
  slide: Slide;
  updated: number;
};
export type EditSlideDefView = {
  id: string;
  source: string;
  status: EditSlideStatus;
  created: number;
  updated: number;
  base: Slide;
  answerCount: number;
  /** The requesting user's own answer, when they have one. */
  mine?: { slide: Slide; updated: number };
  /** Host only: every answer, in class account order. */
  answers?: EditSlideAnswerView[];
  /** Host only: names of members who have not made theirs yet. */
  uncreated?: { name: string }[];
};

const FORBIDDEN_ELEMENT_KEYS = [
  "worksheet",
  "worksheetResult",
  "responseField",
  "survey",
  "surveyResult",
  "webbing",
  "thinking",
  "prevAnswer",
  "embed",
] as const;

function parseOneSlide(raw: unknown): Slide {
  // Answer photos live under their own read path, which the deck
  // file parser does not (and must not) accept. Swap those srcs to
  // the deck-asset shape for the parse, then restore them by
  // asset id — validation of who may use them happens afterwards.
  const restore = new Map<string, string>();
  const serialized = JSON.stringify(raw ?? {}).replace(
    /\/api\/decks\/[a-f0-9-]{36}\/edit-slides\/[a-f0-9-]{36}\/answer-assets\/([a-f0-9-]{36})/g,
    (whole, asset: string) => {
      restore.set(asset, whole);
      return whole.replace(
        /\/edit-slides\/[a-f0-9-]{36}\/answer-assets\//,
        "/assets/",
      );
    },
  );
  let slide: Slide;
  try {
    slide = parseDeck(
      JSON.stringify({
        version: 1,
        title: "編集スライド",
        slides: [
          {
            ...(JSON.parse(serialized) as Slide),
            x: 0,
            y: 0,
            sheetId: undefined,
            speakerNotes: undefined,
          },
        ],
      }),
    ).slides[0];
  } catch {
    throw new EditSlideError(400, "スライドの形式を確認してください。");
  }
  if (restore.size)
    for (const e of slide.elements)
      if (e.type === "image" && e.src) {
        const m = /\/assets\/([a-f0-9-]{36})$/.exec(e.src);
        if (m && restore.has(m[1])) e.src = restore.get(m[1]);
      }
  return slide;
}

/** Refuse anything a student's slide must not carry: learning parts,
 * embeds, external links, speaker notes, and photos that are not
 * this deck's own assets or the author's own answer photos.
 * Returns the referenced deck asset ids and answer photos
 * (asset id → definition id in the reference). */
function checkSlideParts(
  slide: Slide,
  deck?: string,
): { deckAssets: Set<string>; answerAssets: Map<string, string> } {
  insist(
    slide.speakerNotes === undefined,
    400,
    "発表者メモは含められません。",
  );
  const deckAssets = new Set<string>();
  const answerAssets = new Map<string, string>();
  for (const e of slide.elements) {
    const raw = e as unknown as Record<string, unknown>;
    for (const key of FORBIDDEN_ELEMENT_KEYS)
      insist(
        raw[key] === undefined,
        400,
        "学習の部品は含められません。",
      );
    insist(
      !e.link?.url,
      400,
      "外へのリンクは含められません。",
    );
    if (e.type === "image" && e.src) {
      // The one data: exception is the hand-drawing layer's empty
      // placeholder image (emptyInkImage in InkObject.tsx — a fixed
      // 1x1 transparent PNG; the strokes themselves are stored as
      // vectors in the element). A unit test pins the two together.
      if (
        e.src ===
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII="
      )
        continue;
      insist(
        !e.src.startsWith("data:"),
        400,
        "写真はファイルから追加してください。",
      );
      const answer = ANSWER_ASSET_PATTERN.exec(e.src);
      if (answer) {
        if (deck)
          insist(
            answer[1] === deck,
            400,
            "写真の参照が正しくありません。",
          );
        answerAssets.set(answer[3], answer[2]);
        continue;
      }
      const m = /^\/api\/decks\/([a-f0-9-]{36})\/assets\/([a-f0-9-]{36})$/.exec(
        e.src,
      );
      insist(m, 400, "写真の参照が正しくありません。");
      if (deck)
        insist(
          m![1] === deck,
          400,
          "写真の参照が正しくありません。",
        );
      deckAssets.add(m![2]);
    }
  }
  return { deckAssets, answerAssets };
}

/** The base snapshot: the teacher's slide with everything students
 * must not receive stripped (speaker notes, learning parts, links),
 * re-parsed so the stored copy is always a valid clean slide. */
export function sanitizeEditBase(raw: unknown): Slide {
  const input = raw as Slide;
  insist(
    input && Array.isArray(input.elements),
    400,
    "土台にするスライドを確認してください。",
  );
  const cleaned: Slide = {
    ...input,
    speakerNotes: undefined,
    elements: input.elements.map((e) => {
      const copy: Record<string, unknown> = {
        ...(e as unknown as Record<string, unknown>),
      };
      for (const key of FORBIDDEN_ELEMENT_KEYS) delete copy[key];
      delete copy.link;
      return copy as unknown as Element;
    }),
  };
  const slide = parseOneSlide(cleaned);
  const parts = checkSlideParts(slide);
  insist(
    parts.answerAssets.size === 0,
    400,
    "土台に回答の写真は含められません。",
  );
  return slide;
}

type DefRow = {
  id: string;
  source: string;
  base: string;
  status: string;
  created: number;
  updated: number;
};

function defRow(sql: HistorySQL, deck: string, defId: string): DefRow {
  const row = [
    ...sql(
      "SELECT id,source,base,status,created,updated FROM edit_slide_defs WHERE deck=? AND id=?",
      deck,
      defId,
    ),
  ][0];
  insist(row, 404, "生徒の編集用が見つかりません。");
  return row as unknown as DefRow;
}

/** Total stored bytes of a deck's answers plus their photos, for
 * the per-deck cap. Photo sizes are the answer-asset rows' own
 * recorded sizes (before deduplication), which keeps the count
 * simple and certain. */
function deckEditBytes(
  sql: HistorySQL,
  deck: string,
  exceptDef?: string,
  exceptAuthor?: string,
): number {
  let total = 0;
  for (const row of sql(
    "SELECT a.slide AS slide,a.def AS def,a.author AS author FROM edit_slide_answers a JOIN edit_slide_defs d ON d.id=a.def WHERE d.deck=?",
    deck,
  )) {
    if (row.def === exceptDef && row.author === exceptAuthor) continue;
    total += String(row.slide).length;
  }
  for (const row of sql(
    "SELECT aa.bytes AS bytes FROM edit_slide_answer_assets aa JOIN edit_slide_defs d ON d.id=aa.def WHERE d.deck=?",
    deck,
  ))
    total += Number(row.bytes) || 0;
  return total;
}

/** An answer photo reference: the dedicated read path, never the
 * deck's asset path. */
const ANSWER_ASSET_PATTERN =
  /^\/api\/decks\/([a-f0-9-]{36})\/edit-slides\/([a-f0-9-]{36})\/answer-assets\/([a-f0-9-]{36})$/;

export function editSlideList(
  sql: HistorySQL,
  deck: string,
  actor: string,
  host: boolean,
): EditSlideDefView[] {
  const defs = [
    ...sql(
      "SELECT id,source,base,status,created,updated FROM edit_slide_defs WHERE deck=? ORDER BY created",
      deck,
    ),
  ] as unknown as DefRow[];
  const names = new Map<string, string>();
  if (host && defs.length)
    for (const row of sql(
      "SELECT u.id AS id,u.name AS name FROM users u JOIN members m ON m.user_id=u.id WHERE m.deck=?",
      deck,
    ))
      if (typeof row.id === "string")
        names.set(row.id, typeof row.name === "string" ? row.name : "");
  // Class account order, same as the response gallery: recipient
  // rank first, then member registration order.
  const ranks = new Map<string, number>();
  const memberOrder = new Map<string, number>();
  if (host && defs.length) {
    for (const row of sql(
      "SELECT user_id,MIN(rank) AS rank FROM recipients WHERE deck=? AND user_id IS NOT NULL GROUP BY user_id",
      deck,
    ))
      if (typeof row.user_id === "string" && typeof row.rank === "number")
        ranks.set(row.user_id, row.rank);
    for (const row of sql(
      "SELECT rowid,user_id FROM members WHERE deck=?",
      deck,
    ))
      if (typeof row.user_id === "string" && typeof row.rowid === "number")
        memberOrder.set(row.user_id, row.rowid);
  }
  const accountOrder = (a: string, b: string) => {
    const rankA = ranks.get(a),
      rankB = ranks.get(b);
    if ((rankA === undefined) !== (rankB === undefined))
      return rankA === undefined ? 1 : -1;
    if (rankA !== undefined && rankB !== undefined && rankA !== rankB)
      return rankA - rankB;
    const memberA = memberOrder.get(a),
      memberB = memberOrder.get(b);
    if ((memberA === undefined) !== (memberB === undefined))
      return memberA === undefined ? 1 : -1;
    if (memberA !== undefined && memberB !== undefined && memberA !== memberB)
      return memberA - memberB;
    return a.localeCompare(b);
  };
  return defs.map((def) => {
    const answerRows = [
      ...sql(
        "SELECT author,slide,updated FROM edit_slide_answers WHERE def=?",
        def.id,
      ),
    ];
    const mine = answerRows.find((r) => r.author === actor);
    const view: EditSlideDefView = {
      id: def.id,
      source: def.source,
      status: def.status as EditSlideStatus,
      created: def.created,
      updated: def.updated,
      base: JSON.parse(def.base) as Slide,
      answerCount: answerRows.length,
      ...(mine
        ? {
            mine: {
              slide: JSON.parse(String(mine.slide)) as Slide,
              updated: Number(mine.updated),
            },
          }
        : {}),
    };
    if (host) {
      view.answers = answerRows
        .map((r) => ({
          author: String(r.author),
          name: names.get(String(r.author)) || "名前未登録",
          slide: JSON.parse(String(r.slide)) as Slide,
          updated: Number(r.updated),
        }))
        .sort((a, b) => accountOrder(a.author, b.author));
      const answered = new Set(answerRows.map((r) => String(r.author)));
      const missing: string[] = [];
      for (const row of sql(
        "SELECT user_id FROM members WHERE deck=?",
        deck,
      )) {
        const id = row.user_id;
        if (
          typeof id === "string" &&
          id !== actor &&
          !answered.has(id) &&
          !missing.includes(id)
        )
          missing.push(id);
      }
      view.uncreated = missing
        .sort(accountOrder)
        .map((id) => ({ name: names.get(id) || "名前未登録" }));
    }
    return view;
  });
}

export type OrphanAnswerAsset = { asset: string; hash: string };

export function editSlideCommand(
  sql: HistorySQL,
  deck: string,
  actor: string,
  host: boolean,
  action: string,
  defId: string | undefined,
  value: Record<string, unknown>,
): { createdId?: string; orphanAssets?: OrphanAnswerAsset[] } {
  if (action === "create") {
    insist(host, 403, "生徒の編集用を作れるのはホストだけです。");
    const count = [
      ...sql("SELECT COUNT(*) AS n FROM edit_slide_defs WHERE deck=?", deck),
    ][0].n as number;
    insist(
      count < MAX_EDIT_DEFS_PER_DECK,
      400,
      "生徒の編集用は1つの作品に50件までです。",
    );
    insist(
      typeof value.source === "string" && value.source.length <= 100,
      400,
      "元のスライドを確認してください。",
    );
    const base = sanitizeEditBase(value.slide);
    const id = crypto.randomUUID();
    const now = Date.now();
    sql(
      "INSERT INTO edit_slide_defs VALUES(?,?,?,?,?,?,?)",
      id,
      deck,
      value.source as string,
      JSON.stringify(base),
      "draft",
      now,
      now,
    );
    return { createdId: id };
  }
  const def = defRow(sql, deck, defId ?? "");
  if (action === "status") {
    insist(host, 403, "受付の切り替えはホストだけです。");
    insist(
      value.status === "draft" ||
        value.status === "open" ||
        value.status === "closed",
      400,
      "状態を確認してください。",
    );
    sql(
      "UPDATE edit_slide_defs SET status=?,updated=? WHERE id=?",
      value.status as string,
      Date.now(),
      def.id,
    );
    return {};
  }
  if (action === "delete") {
    insist(host, 403, "生徒の編集用を消せるのはホストだけです。");
    const orphans = [
      ...sql(
        "SELECT asset,hash FROM edit_slide_answer_assets WHERE def=?",
        def.id,
      ),
    ].map((r) => ({ asset: String(r.asset), hash: String(r.hash) }));
    sql("DELETE FROM edit_slide_defs WHERE id=?", def.id);
    return { orphanAssets: orphans };
  }
  if (action === "answer") {
    insist(
      def.status === "open",
      403,
      "受付中ではないため保存できません。",
    );
    const existing = [
      ...sql(
        "SELECT updated FROM edit_slide_answers WHERE def=? AND author=?",
        def.id,
        actor,
      ),
    ][0];
    const baseUpdated =
      typeof value.baseUpdated === "number" ? value.baseUpdated : 0;
    insist(
      (existing ? Number(existing.updated) : 0) === baseUpdated,
      409,
      "回答が新しい状態に変わっています。最新の状態を読み直してください。",
    );
    if (existing)
      insist(
        Date.now() - Number(existing.updated) >= 1500,
        429,
        "保存が続いています。少し待ってください。",
      );
    // Speaker notes are refused, not silently dropped: check the
    // raw submission before the one-slide parse strips them.
    insist(
      !(value.slide as Slide)?.speakerNotes,
      400,
      "発表者メモは含められません。",
    );
    const slide = parseOneSlide(value.slide);
    const used = checkSlideParts(slide, deck);
    // Every referenced photo must be allowed for this author: deck
    // photos only as part of the base snapshot, answer photos only
    // the author's own ones recorded for this definition.
    const baseAssets = checkSlideParts(
      JSON.parse(def.base) as Slide,
      deck,
    ).deckAssets;
    for (const asset of used.deckAssets) {
      insist(
        baseAssets.has(asset),
        400,
        "使えない写真が含まれています。",
      );
      const found = [
        ...sql("SELECT id FROM assets WHERE id=? AND deck=?", asset, deck),
      ][0];
      insist(found, 400, "写真が見つかりません。");
    }
    const ownRows = [
      ...sql(
        "SELECT asset,hash,created FROM edit_slide_answer_assets WHERE def=? AND author=?",
        def.id,
        actor,
      ),
    ];
    const ownAssets = new Map(
      ownRows.map((r) => [
        String(r.asset),
        { hash: String(r.hash), created: Number(r.created) },
      ]),
    );
    for (const [asset, refDef] of used.answerAssets) {
      insist(
        refDef === def.id && ownAssets.has(asset),
        400,
        "使えない写真が含まれています。",
      );
    }
    const encoded = JSON.stringify(slide);
    insist(
      encoded.length <= MAX_EDIT_ANSWER_BYTES,
      413,
      "スライドが大きすぎます（写真を除いて256KBまで）。",
    );
    if (!existing) {
      const count = [
        ...sql(
          "SELECT COUNT(*) AS n FROM edit_slide_answers WHERE def=?",
          def.id,
        ),
      ][0].n as number;
      insist(
        count < MAX_EDIT_ANSWERS_PER_DEF,
        400,
        "回答は500人分までです。",
      );
    }
    insist(
      deckEditBytes(sql, deck, def.id, actor) + encoded.length <=
        MAX_EDIT_DECK_BYTES,
      413,
      "作品全体の保存量の上限（50MB）に達しました。",
    );
    const now = Date.now();
    sql(
      "INSERT INTO edit_slide_answers VALUES(?,?,?,?) ON CONFLICT(def,author) DO UPDATE SET slide=excluded.slide,updated=excluded.updated",
      def.id,
      actor,
      encoded,
      now,
    );
    // Photos the new slide no longer references are deleted —
    // except ones uploaded in the last few minutes, which a save
    // from another tab may simply not know about yet. They are
    // collected by a later save or by the definition's deletion.
    const grace = Date.now() - 300_000;
    const orphans: OrphanAnswerAsset[] = [];
    for (const [asset, row] of ownAssets) {
      if (used.answerAssets.has(asset) || row.created > grace) continue;
      sql("DELETE FROM edit_slide_answer_assets WHERE asset=?", asset);
      orphans.push({ asset, hash: row.hash });
    }
    return { orphanAssets: orphans };
  }
  throw new EditSlideError(404, "操作が見つかりません。");
}

/** Record a freshly stored answer photo for one definition.
 * Called by the servers after they stored the bytes in the shared
 * blob pool; throws (and the server releases the bytes again) when
 * the per-answer photo limit is already reached. Unreferenced
 * photos count toward the limit too, so uploads cannot pile up. */
export function recordEditAnswerAsset(
  sql: HistorySQL,
  deck: string,
  actor: string,
  defId: string,
  asset: string,
  hash: string,
  bytes: number,
  mime: string,
): void {
  const def = defRow(sql, deck, defId);
  insist(
    def.status === "open",
    403,
    "受付中ではないため写真を追加できません。",
  );
  const count = [
    ...sql(
      "SELECT COUNT(*) AS n FROM edit_slide_answer_assets WHERE def=? AND author=?",
      def.id,
      actor,
    ),
  ][0].n as number;
  insist(
    count < MAX_EDIT_ANSWER_ASSETS,
    400,
    "写真は1つのスライドに10枚までです。",
  );
  insist(
    deckEditBytes(sql, deck) + bytes <= MAX_EDIT_DECK_BYTES,
    413,
    "作品全体の保存量の上限（50MB）に達しました。",
  );
  sql(
    "INSERT INTO edit_slide_answer_assets VALUES(?,?,?,?,?,?,?)",
    asset,
    def.id,
    actor,
    hash,
    bytes,
    mime,
    Date.now(),
  );
}

/** The stored form of one answer photo, for the read path. Only the
 * author and the host may read it; everyone else gets a 404. */
export function editAnswerAsset(
  sql: HistorySQL,
  deck: string,
  actor: string,
  host: boolean,
  defId: string,
  asset: string,
): { hash: string; mime: string; author: string } {
  const def = defRow(sql, deck, defId);
  const row = [
    ...sql(
      "SELECT author,hash,mime FROM edit_slide_answer_assets WHERE def=? AND asset=?",
      def.id,
      asset,
    ),
  ][0];
  insist(
    row && (host || row.author === actor),
    404,
    "写真が見つかりません。",
  );
  return {
    hash: String(row!.hash),
    mime: String(row!.mime),
    author: String(row!.author),
  };
}
