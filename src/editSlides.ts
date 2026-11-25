import type { HistorySQL } from "./historyStore.ts";
import { featureVersionSchema, versionTriggers } from "./featureVersions.ts";
import {
  feedbackAnswerFlags,
  feedbackDeleteTarget,
  feedbackReopenActive,
  feedbackSchema,
} from "./feedback.ts";
import { deckGroups, effectiveGroupId } from "./groups.ts";
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
  /** Machine-readable reason for the client (e.g. "group-changed"
   * on the 409 a save gets after the student changed groups). */
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
/** The 409 for "your group changed since this screen opened". */
export const GROUP_CHANGED = "group-changed";
const insistGroup = (ok: unknown, message: string): void => {
  if (!ok) throw new EditSlideError(409, message, GROUP_CHANGED);
};
const insist = (ok: unknown, status: number, message: string): void => {
  if (!ok) throw new EditSlideError(status, message);
};

export const editSlideSchema =
  featureVersionSchema +
  // The generic feedback table (§4.3) rides along so it always
  // exists where edit slides run: definition deletion clears the
  // target's feedback from editSlideCommand itself.
  feedbackSchema +
  `
CREATE TABLE IF NOT EXISTS edit_slide_defs(id TEXT PRIMARY KEY, deck TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE, source TEXT NOT NULL, base TEXT NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL, base_kind TEXT NOT NULL DEFAULT 'copy', mode TEXT NOT NULL DEFAULT 'single');
CREATE TABLE IF NOT EXISTS edit_slide_answers(def TEXT NOT NULL REFERENCES edit_slide_defs(id) ON DELETE CASCADE, author TEXT NOT NULL, slide TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL, last_editor TEXT, PRIMARY KEY(def,author));
CREATE TABLE IF NOT EXISTS edit_slide_answer_assets(asset TEXT PRIMARY KEY, def TEXT NOT NULL REFERENCES edit_slide_defs(id) ON DELETE CASCADE, author TEXT NOT NULL, hash TEXT NOT NULL, bytes INTEGER NOT NULL, mime TEXT NOT NULL, created INTEGER NOT NULL, uploader TEXT);
CREATE TABLE IF NOT EXISTS edit_slide_shares(id TEXT PRIMARY KEY, deck TEXT NOT NULL, def TEXT NOT NULL, author TEXT NOT NULL, kind TEXT NOT NULL, names INTEGER NOT NULL, slide TEXT NOT NULL, bytes INTEGER NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS edit_slide_share_assets(share TEXT NOT NULL, asset TEXT NOT NULL, PRIMARY KEY(share, asset));` +
  // The counters feed the shared deck poll; the deck's own document
  // version is never touched by these tables. Definitions bump the
  // counter everyone watches ("editslides"); answer saves bump only
  // the host-console counter ("editanswers"), so a class saving at
  // once never makes every client re-read the list.
  versionTriggers("edit_slide_defs", "editslides", (a) => `${a}.deck`) +
  versionTriggers(
    "edit_slide_answers",
    "editanswers",
    (a) => `COALESCE((SELECT deck FROM edit_slide_defs WHERE id=${a}.def),'')`,
  ) +
  // Shares change what the console shows (the 共有中 flag), so they
  // move the host's counter too.
  versionTriggers("edit_slide_shares", "editanswers", (a) => `${a}.deck`);

export const MAX_EDIT_DEFS_PER_DECK = 50;
export const MAX_EDIT_ANSWERS_PER_DEF = 500;
export const MAX_EDIT_ANSWER_BYTES = 256_000;
export const MAX_EDIT_DECK_BYTES = 50_000_000;
export const MAX_EDIT_ANSWER_ASSETS = 10;

export type EditSlideStatus = "draft" | "open" | "closed";
/** One answer's identity for the teacher console — never its
 * content. The console fetches the slide itself, per answer, only
 * when the answer's updated stamp has moved. */
export type EditSlideAnswerMeta = {
  author: string;
  name: string;
  updated: number;
  /** A send-back (§4.3) is in force for this answer. */
  reopen?: boolean;
  /** The answer was saved again after a send-back that the student
   * then closed with "出し直す". */
  resubmitted?: boolean;
  /** A snapshot of this answer is published in the response
   * gallery. */
  shared?: boolean;
  /** Who saved this answer last (stage 3b: for a group's answer,
   * the member who saved; for a personal answer, the author). */
  lastEditor?: string;
};
/** Host-only answer overview for one definition, delivered on the
 * separate "editanswers" poll counter so student saves stay cheap
 * for everyone else. */
export type EditSlideAnswersMeta = {
  id: string;
  answerCount: number;
  answers: EditSlideAnswerMeta[];
  /** Names of members who have not made theirs yet. */
  uncreated: { name: string }[];
};
export type EditSlideDefView = {
  id: string;
  source: string;
  /** Stage 3a: "copy" of the teacher's slide, or a "blank" page.
   * The source slide stays the entry point either way. */
  baseKind: "copy" | "blank";
  /** Stage 3b: "single" — one answer per student; "group" — one
   * answer per group, edited by every member (whole-save). Group
   * definitions are only sent to clients that declare the
   * "editgroup" marker. */
  mode: "single" | "group";
  /** For a group definition, the requesting student's own group
   * (absent when they belong to no group: no entry point). */
  groupId?: string;
  groupName?: string;
  status: EditSlideStatus;
  created: number;
  updated: number;
  base: Slide;
  answerCount: number;
  /** The requesting user's own answer, when they have one. For a
   * group definition this is the group's answer, with the name of
   * the member who saved it last. */
  mine?: { slide: Slide; updated: number; lastEditorName?: string };
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
          "ほかの作品の写真が含まれています。",
        );
      deckAssets.add(m![2]);
    }
  }
  return { deckAssets, answerAssets };
}

/** The base snapshot: the teacher's slide with everything students
 * must not receive stripped (speaker notes, learning parts, links),
 * re-parsed so the stored copy is always a valid clean slide. When
 * the deck id is known, photos belonging to another deck are refused
 * here, at creation time — otherwise students could never save the
 * base they were handed. */
export function sanitizeEditBase(raw: unknown, deck?: string): Slide {
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
  const parts = checkSlideParts(slide, deck);
  insist(
    parts.answerAssets.size === 0,
    400,
    "土台に回答の写真は含められません。",
  );
  return slide;
}

/** A blank starting page (stage 3a): same identity as the entry
 * slide, white, no elements. Parsed like any other base so the
 * stored shape is canonical. */
function blankEditBase(source: string): Slide {
  return parseOneSlide({
    id: source,
    x: 0,
    y: 0,
    title: "",
    background: "#ffffff",
    elements: [],
  } as unknown as Slide);
}

type DefRow = {
  id: string;
  source: string;
  base: string;
  status: string;
  created: number;
  updated: number;
  base_kind?: string;
  mode?: string;
};

/** Older databases predate base_kind (stage 3a); add it lazily,
 * the way webbing adds its columns. */
export function ensureEditSlideShape(sql: HistorySQL): void {
  const columns = [...sql("PRAGMA table_info(edit_slide_defs)")].map(
    (c) => c.name,
  );
  if (columns.length && !columns.includes("base_kind"))
    sql(
      "ALTER TABLE edit_slide_defs ADD COLUMN base_kind TEXT NOT NULL DEFAULT 'copy'",
    );
  if (columns.length && !columns.includes("mode"))
    sql(
      "ALTER TABLE edit_slide_defs ADD COLUMN mode TEXT NOT NULL DEFAULT 'single'",
    );
  const answerColumns = [...sql("PRAGMA table_info(edit_slide_answers)")].map(
    (c) => c.name,
  );
  if (answerColumns.length && !answerColumns.includes("last_editor"))
    sql("ALTER TABLE edit_slide_answers ADD COLUMN last_editor TEXT");
  const assetColumns = [
    ...sql("PRAGMA table_info(edit_slide_answer_assets)"),
  ].map((c) => c.name);
  if (assetColumns.length && !assetColumns.includes("uploader"))
    sql("ALTER TABLE edit_slide_answer_assets ADD COLUMN uploader TEXT");
}

const defMode = (def: DefRow): "single" | "group" =>
  def.mode === "group" ? "group" : "single";

/** The author key a save / read / photo acts on: the user themself
 * for a personal definition; for a group definition, the group the
 * SERVER derives from membership (stage 3b review: the client never
 * picks the author). Undefined when the user belongs to no group. */
function answerAuthor(
  sql: HistorySQL,
  deck: string,
  def: DefRow,
  actor: string,
): string | undefined {
  return defMode(def) === "group"
    ? effectiveGroupId(sql, deck, actor)
    : actor;
}

function defRow(sql: HistorySQL, deck: string, defId: string): DefRow {
  const row = [
    ...sql(
      "SELECT id,source,base,status,created,updated,base_kind,mode FROM edit_slide_defs WHERE deck=? AND id=?",
      deck,
      defId,
    ),
  ][0];
  insist(row, 404, "生徒の編集用が見つかりません。");
  return row as unknown as DefRow;
}

/** Total stored bytes of a deck's answers plus their photos, for
 * the per-deck cap. Counted from the recorded size columns with SQL
 * sums, so a save never reads everyone's answer content. Photo
 * sizes are the answer-asset rows' own recorded sizes (before
 * deduplication), which keeps the count simple and certain. */
function deckEditBytes(
  sql: HistorySQL,
  deck: string,
  exceptDef?: string,
  exceptAuthor?: string,
): number {
  const row = [
    ...sql(
      `SELECT
        (SELECT COALESCE(SUM(a.bytes),0) FROM edit_slide_answers a JOIN edit_slide_defs d ON d.id=a.def WHERE d.deck=? AND NOT (a.def=? AND a.author=?))
        + (SELECT COALESCE(SUM(aa.bytes),0) FROM edit_slide_answer_assets aa JOIN edit_slide_defs d2 ON d2.id=aa.def WHERE d2.deck=?)
        + (SELECT COALESCE(SUM(s.bytes),0) FROM edit_slide_shares s WHERE s.deck=?)
        + (SELECT COALESCE(SUM(aa2.bytes),0) FROM edit_slide_share_assets sa JOIN edit_slide_answer_assets aa2 ON aa2.asset=sa.asset JOIN edit_slide_shares s2 ON s2.id=sa.share WHERE s2.deck=?) AS total`,
      deck,
      exceptDef ?? "",
      exceptAuthor ?? "",
      deck,
      deck,
      deck,
    ),
  ][0];
  return Number(row?.total) || 0;
}

/** An answer photo reference: the dedicated read path, never the
 * deck's asset path. */
const ANSWER_ASSET_PATTERN =
  /^\/api\/decks\/([a-f0-9-]{36})\/edit-slides\/([a-f0-9-]{36})\/answer-assets\/([a-f0-9-]{36})$/;

/** The definition list everyone polls. Deliberately light: counts
 * come from COUNT(*), a student triggers a read of their own answer
 * row only, and nobody's answer content rides along. Definitions
 * still in draft are the teacher's alone — students receive only
 * open and closed ones, so a base taken from a slide the teacher
 * has not shown yet never leaks early. */
export function editSlideList(
  sql: HistorySQL,
  deck: string,
  actor: string,
  host: boolean,
  options?: { groupOk?: boolean },
): EditSlideDefView[] {
  ensureEditSlideShape(sql);
  const defs = [
    ...sql(
      "SELECT id,source,base,status,created,updated,base_kind,mode FROM edit_slide_defs WHERE deck=? ORDER BY created",
      deck,
    ),
  ] as unknown as DefRow[];
  const groups = deckGroups(sql, deck);
  const myGroupId = host ? undefined : effectiveGroupId(sql, deck, actor);
  return defs.flatMap((def) => {
    if (!host && def.status === "draft") return [];
    const mode = defMode(def);
    // Group definitions go only to clients that declare they can
    // handle them; older screens keep the personal-only list.
    if (mode === "group" && !options?.groupOk) return [];
    const count = [
      ...sql(
        "SELECT COUNT(*) AS n FROM edit_slide_answers WHERE def=?",
        def.id,
      ),
    ][0].n as number;
    const authorKey =
      mode === "group" ? (host ? undefined : myGroupId) : actor;
    const mine = authorKey
      ? [
          ...sql(
            "SELECT slide,updated,last_editor FROM edit_slide_answers WHERE def=? AND author=?",
            def.id,
            authorKey,
          ),
        ][0]
      : undefined;
    let lastEditorName: string | undefined;
    if (mine?.last_editor) {
      const editor = [
        ...sql("SELECT name FROM users WHERE id=?", String(mine.last_editor)),
      ][0];
      if (editor?.name) lastEditorName = String(editor.name);
    }
    const view: EditSlideDefView = {
      id: def.id,
      source: def.source,
      baseKind: def.base_kind === "blank" ? "blank" : "copy",
      mode,
      ...(mode === "group" && myGroupId
        ? {
            groupId: myGroupId,
            groupName: groups.find((g) => g.id === myGroupId)?.name,
          }
        : {}),
      status: def.status as EditSlideStatus,
      created: def.created,
      updated: def.updated,
      base: JSON.parse(def.base) as Slide,
      answerCount: count,
      ...(mine
        ? {
            mine: {
              slide: JSON.parse(String(mine.slide)) as Slide,
              updated: Number(mine.updated),
              ...(lastEditorName ? { lastEditorName } : {}),
            },
          }
        : {}),
    };
    return [view];
  });
}

/** Host-only: who answered each definition (names and stamps, no
 * content) and who has not, in class account order — recipient rank
 * first, then member registration order, as in the response
 * gallery. Served on the "editanswers" poll counter. */
export function editSlideAnswersMeta(
  sql: HistorySQL,
  deck: string,
  actor: string,
  host: boolean,
): EditSlideAnswersMeta[] {
  if (!host) return [];
  const defs = [
    ...sql(
      "SELECT id,mode FROM edit_slide_defs WHERE deck=? ORDER BY created",
      deck,
    ),
  ];
  if (!defs.length) return [];
  const names = new Map<string, string>();
  for (const row of sql(
    "SELECT u.id AS id,u.name AS name FROM users u JOIN members m ON m.user_id=u.id WHERE m.deck=?",
    deck,
  ))
    if (typeof row.id === "string")
      names.set(row.id, typeof row.name === "string" ? row.name : "");
  const ranks = new Map<string, number>();
  for (const row of sql(
    "SELECT user_id,MIN(rank) AS rank FROM recipients WHERE deck=? AND user_id IS NOT NULL GROUP BY user_id",
    deck,
  ))
    if (typeof row.user_id === "string" && typeof row.rank === "number")
      ranks.set(row.user_id, row.rank);
  const memberOrder = new Map<string, number>();
  for (const row of sql("SELECT rowid,user_id FROM members WHERE deck=?", deck))
    if (typeof row.user_id === "string" && typeof row.rowid === "number")
      memberOrder.set(row.user_id, row.rowid);
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
    const groupMode = String(def.mode ?? "single") === "group";
    const groups = groupMode ? deckGroups(sql, deck) : [];
    const rows = [
      ...sql(
        "SELECT author,updated,last_editor FROM edit_slide_answers WHERE def=?",
        String(def.id),
      ),
    ];
    const sharedAuthors = new Set(
      [
        ...sql(
          "SELECT author FROM edit_slide_shares WHERE def=? AND kind='gallery'",
          String(def.id),
        ),
      ].map((r) => String(r.author)),
    );
    const answers = rows
      .map((r) => {
        const author = String(r.author);
        const updated = Number(r.updated);
        const flags = feedbackAnswerFlags(
          sql,
          deck,
          "editslide",
          String(def.id),
          author,
          updated,
        );
        const lastEditor =
          typeof r.last_editor === "string" ? r.last_editor : undefined;
        return {
          author,
          name: groupMode
            ? (groups.find((g) => g.id === author)?.name ?? "削除された班")
            : names.get(author) || "名前未登録",
          updated,
          ...(flags.reopen ? { reopen: true } : {}),
          ...(flags.resubmitted ? { resubmitted: true } : {}),
          ...(sharedAuthors.has(author) ? { shared: true } : {}),
          ...(lastEditor && names.get(lastEditor)
            ? { lastEditor: names.get(lastEditor) }
            : {}),
        };
      })
      .sort((a, b) => accountOrder(a.author, b.author));
    const answered = new Set(answers.map((a) => a.author));
    if (groupMode)
      return {
        id: String(def.id),
        answerCount: answers.length,
        answers,
        uncreated: groups
          .filter((g) => !answered.has(g.id))
          .map((g) => ({ name: g.name })),
      };
    const missing: string[] = [];
    for (const row of sql("SELECT user_id FROM members WHERE deck=?", deck)) {
      const id = row.user_id;
      if (
        typeof id === "string" &&
        id !== actor &&
        !answered.has(id) &&
        !missing.includes(id)
      )
        missing.push(id);
    }
    return {
      id: String(def.id),
      answerCount: answers.length,
      answers,
      uncreated: missing
        .sort(accountOrder)
        .map((id) => ({ name: names.get(id) || "名前未登録" })),
    };
  });
}

/** One answer's content, fetched on demand: the console asks for a
 * slide only when its updated stamp moved, and a student can only
 * ever fetch their own. */
/** The light probe behind the group studio's watcher (stage 3b
 * review): the caller's own group and their answer's version
 * stamp for one definition — no slide content. Group definitions
 * stay hidden from screens without the marker, exactly like the
 * list. */
export function editSlideAnswerVersion(
  sql: HistorySQL,
  deck: string,
  actor: string,
  host: boolean,
  defId: string,
  groupOk: boolean,
): { groupId: string | null; updated: number | null } {
  ensureEditSlideShape(sql);
  const def = defRow(sql, deck, defId);
  if (defMode(def) !== "group") return { groupId: null, updated: null };
  insist(groupOk, 404, "生徒の編集用が見つかりません。");
  if (host) return { groupId: null, updated: null };
  const groupId = effectiveGroupId(sql, deck, actor) ?? null;
  if (!groupId) return { groupId: null, updated: null };
  const row = [
    ...sql(
      "SELECT updated FROM edit_slide_answers WHERE def=? AND author=?",
      defId,
      groupId,
    ),
  ][0];
  return { groupId, updated: row ? Number(row.updated) : null };
}

export function editSlideAnswerContent(
  sql: HistorySQL,
  deck: string,
  actor: string,
  host: boolean,
  defId: string,
  author: string,
): { slide: Slide; updated: number } {
  const def = defRow(sql, deck, defId);
  insist(
    host ||
      author === actor ||
      (defMode(def) === "group" &&
        answerAuthor(sql, deck, def, actor) === author),
    404,
    "回答が見つかりません。",
  );
  const row = [
    ...sql(
      "SELECT slide,updated FROM edit_slide_answers WHERE def=? AND author=?",
      def.id,
      author,
    ),
  ][0];
  insist(row, 404, "回答が見つかりません。");
  return {
    slide: JSON.parse(String(row!.slide)) as Slide,
    updated: Number(row!.updated),
  };
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
  ensureEditSlideShape(sql);
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
    // One definition per entry slide: the student's entry point
    // (and the console's follow target) resolves a slide to a
    // single definition, so a second one — of either base kind —
    // would shadow the first.
    const sameSlide = [
      ...sql(
        "SELECT COUNT(*) AS n FROM edit_slide_defs WHERE deck=? AND source=?",
        deck,
        value.source as string,
      ),
    ][0].n as number;
    insist(
      sameSlide === 0,
      400,
      "このスライドには、すでに生徒の編集用があります。",
    );
    // Stage 3b: a group definition needs the deck's groups to
    // exist — its answers are keyed by group, so with no groups
    // nobody could ever answer.
    const group = value.mode === "group";
    if (group)
      insist(
        deckGroups(sql, deck).length > 0,
        400,
        "班が作られていない作品では、班の編集用は作れません。",
      );
    // Stage 3a: the base is either a copy of the teacher's slide
    // or a blank page. The source slide is always the entry point
    // (the student's button, the follow target, the gallery key),
    // so it is required for both kinds.
    const blank = value.baseKind === "blank";
    const base = blank
      ? blankEditBase(value.source as string)
      : sanitizeEditBase(value.slide, deck);
    const id = crypto.randomUUID();
    const now = Date.now();
    sql(
      "INSERT INTO edit_slide_defs(id,deck,source,base,status,created,updated,base_kind,mode) VALUES(?,?,?,?,?,?,?,?,?)",
      id,
      deck,
      value.source as string,
      JSON.stringify(base),
      "draft",
      now,
      now,
      blank ? "blank" : "copy",
      group ? "group" : "single",
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
    feedbackDeleteTarget(sql, deck, "editslide", def.id);
    deleteEditShares(sql, deck, def.id);
    sql("DELETE FROM edit_slide_defs WHERE id=?", def.id);
    return { orphanAssets: orphans };
  }
  if (action === "answer") {
    // Stage 3b: for a group definition the answer belongs to the
    // group the server derives from membership — never to a group
    // the client claims. A claim that disagrees is a conflict
    // (the student's group changed under them), and a student in
    // no group cannot save at all. This derivation runs on every
    // save, including an overwrite after a conflict.
    const author = answerAuthor(sql, deck, def, actor);
    insist(author !== undefined, 403, "班に入っていないため保存できません。");
    if (defMode(def) === "group") {
      // Stage 3b review: the claim is required for group saves,
      // and it must be the group the screen opened with — a
      // mismatch is the group-changed 409, told apart by its code
      // so the screen closes instead of offering an overwrite.
      insist(
        typeof value.groupId === "string",
        400,
        "班の情報がありません。画面を読み直してください。",
      );
      insistGroup(
        value.groupId === author,
        "班が変わっています。画面を読み直してください。",
      );
    }
    // A send-back (§4.3) in force for this author re-opens saving
    // for them alone after the intake closed; it stays in force
    // across saves until the student resubmits or the host cancels.
    insist(
      def.status === "open" ||
        (def.status === "closed" &&
          feedbackReopenActive(sql, deck, "editslide", def.id, author!)),
      403,
      "受付中ではないため保存できません。",
    );
    const existing = [
      ...sql(
        "SELECT updated FROM edit_slide_answers WHERE def=? AND author=?",
        def.id,
        author!,
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
        author!,
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
    // The cap is on stored bytes, not characters: Japanese text is
    // three bytes per character once encoded.
    const byteLength = new TextEncoder().encode(encoded).length;
    insist(
      byteLength <= MAX_EDIT_ANSWER_BYTES,
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
      deckEditBytes(sql, deck, def.id, author!) + byteLength <=
        MAX_EDIT_DECK_BYTES,
      413,
      "作品全体の保存量の上限（50MB）に達しました。",
    );
    const now = Date.now();
    sql(
      "INSERT INTO edit_slide_answers(def,author,slide,bytes,updated,last_editor) VALUES(?,?,?,?,?,?) ON CONFLICT(def,author) DO UPDATE SET slide=excluded.slide,bytes=excluded.bytes,updated=excluded.updated,last_editor=excluded.last_editor",
      def.id,
      author!,
      encoded,
      byteLength,
      now,
      actor,
    );
    // Photos the new slide no longer references are deleted —
    // except ones uploaded in the last few minutes, which a save
    // from another tab may simply not know about yet. They are
    // collected by a later save or by the definition's deletion.
    const grace = Date.now() - 300_000;
    const orphans: OrphanAnswerAsset[] = [];
    for (const [asset, row] of ownAssets) {
      if (used.answerAssets.has(asset) || row.created > grace) continue;
      // A photo inside a live share (follow or gallery snapshot)
      // stays: the snapshot must keep rendering as it was taken.
      const shared = [
        ...sql(
          "SELECT share FROM edit_slide_share_assets WHERE asset=?",
          asset,
        ),
      ][0];
      if (shared) continue;
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
  claimGroupId?: string,
): void {
  const def = defRow(sql, deck, defId);
  const author = answerAuthor(sql, deck, def, actor);
  insist(author !== undefined, 403, "班に入っていないため写真を追加できません。");
  // A claim that disagrees with the server-derived group is the
  // group-changed 409 (the screen opened under another group).
  if (claimGroupId !== undefined)
    insistGroup(
      claimGroupId === author,
      "班が変わっています。画面を読み直してください。",
    );
  insist(
    def.status === "open" ||
      (def.status === "closed" &&
        feedbackReopenActive(sql, deck, "editslide", def.id, author!)),
    403,
    "受付中ではないため写真を追加できません。",
  );
  const count = [
    ...sql(
      "SELECT COUNT(*) AS n FROM edit_slide_answer_assets WHERE def=? AND author=?",
      def.id,
      author!,
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
    "INSERT INTO edit_slide_answer_assets(asset,def,author,hash,bytes,mime,created,uploader) VALUES(?,?,?,?,?,?,?,?)",
    asset,
    def.id,
    author!,
    hash,
    bytes,
    mime,
    Date.now(),
    actor,
  );
}

/** The stored form of one answer photo, for the read path. The
 * author and the host may read it; any other member may read it
 * only while it sits inside a live share snapshot of this deck
 * (stage 2b) — once the share goes away, so does the access. */
export function editAnswerAsset(
  sql: HistorySQL,
  deck: string,
  actor: string,
  host: boolean,
  defId: string,
  asset: string,
): {
  hash: string;
  mime: string;
  author: string;
  /** Set when the read is allowed only through a follow snapshot:
   * the server must confirm the room's follow is live for this
   * definition + author before serving the bytes. */
  follow?: { defId: string; author: string };
} {
  const def = defRow(sql, deck, defId);
  const row = [
    ...sql(
      "SELECT author,hash,mime FROM edit_slide_answer_assets WHERE def=? AND asset=?",
      def.id,
      asset,
    ),
  ][0];
  insist(row, 404, "写真が見つかりません。");
  const ownGroupPhoto =
    defMode(def) === "group" &&
    answerAuthor(sql, deck, def, actor) === String(row!.author);
  if (!host && row!.author !== actor && !ownGroupPhoto) {
    const kinds = [
      ...sql(
        "SELECT DISTINCT s.kind AS kind FROM edit_slide_share_assets sa JOIN edit_slide_shares s ON s.id=sa.share WHERE sa.asset=? AND s.deck=?",
        asset,
        deck,
      ),
    ].map((r) => String(r.kind));
    if (kinds.includes("gallery"))
      return {
        hash: String(row!.hash),
        mime: String(row!.mime),
        author: String(row!.author),
      };
    // A follow snapshot alone is not enough: follow can end by
    // many routes (the band's stop button, a switch to another
    // showing, the lease expiring), and the row would linger. The
    // server must confirm the room's follow is live for this
    // definition + author before serving the bytes.
    const followRef = [
      ...sql(
        "SELECT s.def AS def,s.author AS author FROM edit_slide_share_assets sa JOIN edit_slide_shares s ON s.id=sa.share WHERE sa.asset=? AND s.deck=? AND s.kind='follow'",
        asset,
        deck,
      ),
    ][0];
    insist(followRef, 404, "写真が見つかりません。");
    return {
      hash: String(row!.hash),
      mime: String(row!.mime),
      author: String(row!.author),
      follow: {
        defId: String(followRef!.def),
        author: String(followRef!.author),
      },
    };
  }
  return {
    hash: String(row!.hash),
    mime: String(row!.mime),
    author: String(row!.author),
  };
}

/* ------------------------------------------------------------------
 * Stage 2b: showing one student's slide to the class. Both routes —
 * follow (集合で見せる) and the response gallery — present a
 * SNAPSHOT: a copy of the answer as it was when the host picked it,
 * never the live answer, so a student editing afterwards cannot
 * change what the class is looking at (or swap a photo under it).
 * The host re-takes the snapshot to show the latest version.
 * Snapshot photos are referenced from edit_slide_share_assets:
 * those references keep the blobs alive and are the only way other
 * students may read an answer photo. Snapshots count toward the
 * deck's 50MB like everything else.
 * ------------------------------------------------------------------ */

export type EditShareView = {
  id: string;
  /** Set only when the host chose to show names for this share. */
  name?: string;
  slide: Slide;
};

type ShareRow = {
  id: string;
  def: string;
  author: string;
  kind: string;
  names: number;
  slide: string;
};

const shareRow = (
  sql: HistorySQL,
  deck: string,
  id: string,
): ShareRow | undefined => {
  const row = [
    ...sql(
      "SELECT id,def,author,kind,names,slide FROM edit_slide_shares WHERE deck=? AND id=?",
      deck,
      id,
    ),
  ][0];
  return row
    ? {
        id: String(row.id),
        def: String(row.def),
        author: String(row.author),
        kind: String(row.kind),
        names: Number(row.names),
        slide: String(row.slide),
      }
    : undefined;
};

function deleteShareRow(sql: HistorySQL, id: string) {
  sql("DELETE FROM edit_slide_share_assets WHERE share=?", id);
  sql("DELETE FROM edit_slide_shares WHERE id=?", id);
}

/** Remove gallery shares — for one source slide, or for the whole
 * deck when source is omitted. Called when the response gallery is
 * stopped: unpublishing the gallery must take its edit-slide
 * snapshots (and their photo access) down with it. */
export function deleteGalleryShares(
  sql: HistorySQL,
  deck: string,
  source?: string,
) {
  const rows = [
    ...sql(
      source
        ? "SELECT s.id AS id FROM edit_slide_shares s JOIN edit_slide_defs d ON d.id=s.def WHERE s.deck=? AND s.kind='gallery' AND d.source=?"
        : "SELECT id FROM edit_slide_shares WHERE deck=? AND kind='gallery'",
      ...(source ? [deck, source] : [deck]),
    ),
  ];
  for (const row of rows) deleteShareRow(sql, String(row.id));
}

/** Remove every share of one definition (or of the whole deck when
 * defId is omitted). Called on definition deletion; the servers do
 * the same for deck deletion inside their own cleanup. */
export function deleteEditShares(
  sql: HistorySQL,
  deck: string,
  defId?: string,
) {
  const rows = [
    ...sql(
      defId
        ? "SELECT id FROM edit_slide_shares WHERE deck=? AND def=?"
        : "SELECT id FROM edit_slide_shares WHERE deck=?",
      ...(defId ? [deck, defId] : [deck]),
    ),
  ];
  for (const row of rows) deleteShareRow(sql, String(row.id));
}

/** Take (or re-take) a snapshot of one student's answer. Follow
 * snapshots are one per deck — follow itself shows one thing at a
 * time — while gallery snapshots are one per (definition, author).
 * Returns the share id. */
export function takeEditShare(
  sql: HistorySQL,
  deck: string,
  host: boolean,
  defId: string,
  author: string,
  kind: "follow" | "gallery",
  names: boolean,
): string {
  insist(host, 403, "見せる作品を選べるのはホストだけです。");
  const def = defRow(sql, deck, defId);
  const answer = [
    ...sql(
      "SELECT slide,bytes FROM edit_slide_answers WHERE def=? AND author=?",
      def.id,
      author,
    ),
  ][0];
  insist(answer, 404, "その生徒のスライドが見つかりません。");
  const slide = JSON.parse(String(answer.slide)) as Slide;
  // The snapshot's own bytes plus its photos' recorded sizes join
  // the deck's 50MB accounting; the replaced snapshot's share is
  // subtracted again through the deletion below.
  const photoBytes = [...slideAssetIds(deck, slide)].reduce(
    (sum, asset) => {
      const row = [
        ...sql(
          "SELECT bytes FROM edit_slide_answer_assets WHERE asset=?",
          asset,
        ),
      ][0];
      return sum + (row ? Number(row.bytes) : 0);
    },
    0,
  );
  const replaced =
    kind === "follow"
      ? [...sql("SELECT id FROM edit_slide_shares WHERE deck=? AND kind='follow'", deck)]
      : [
          ...sql(
            "SELECT id FROM edit_slide_shares WHERE deck=? AND kind='gallery' AND def=? AND author=?",
            deck,
            def.id,
            author,
          ),
        ];
  let replacedBytes = 0;
  for (const row of replaced) {
    const old = shareRow(sql, deck, String(row.id));
    if (old) {
      const joined = [
        ...sql(
          "SELECT COALESCE(SUM(aa.bytes),0) AS total FROM edit_slide_share_assets sa JOIN edit_slide_answer_assets aa ON aa.asset=sa.asset WHERE sa.share=?",
          old.id,
        ),
      ][0];
      replacedBytes +=
        new TextEncoder().encode(old.slide).length +
        (Number(joined?.total) || 0);
    }
    deleteShareRow(sql, String(row.id));
  }
  insist(
    deckEditBytes(sql, deck) - replacedBytes + Number(answer.bytes) + photoBytes <=
      MAX_EDIT_DECK_BYTES,
    413,
    "作品全体の保存量の上限（50MB）に達しました。",
  );
  const id = crypto.randomUUID();
  const now = Date.now();
  sql(
    "INSERT INTO edit_slide_shares VALUES(?,?,?,?,?,?,?,?,?,?)",
    id,
    deck,
    def.id,
    author,
    kind,
    names ? 1 : 0,
    String(answer.slide),
    Number(answer.bytes),
    now,
    now,
  );
  for (const asset of slideAssetIds(deck, slide))
    sql("INSERT INTO edit_slide_share_assets VALUES(?,?)", id, asset);
  return id;
}

/** The answer-photo ids a slide references (this deck's only). */
function slideAssetIds(deck: string, slide: Slide): Set<string> {
  const ids = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      const match = ANSWER_ASSET_PATTERN.exec(value);
      if (match && match[1] === deck) ids.add(match[3]);
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object")
      Object.values(value).forEach(visit);
  };
  visit(slide);
  return ids;
}

/** A definition's source slide id (the slide it was taken from). */
export function editSlideSource(
  sql: HistorySQL,
  deck: string,
  defId: string,
): string | undefined {
  const def = [...sql("SELECT source FROM edit_slide_defs WHERE deck=? AND id=?", deck, defId)][0];
  return def ? String(def.source) : undefined;
}

/** Remove the deck's follow share, or one definition's gallery
 * share (named by share id, or by its author). */
export function removeEditShare(
  sql: HistorySQL,
  deck: string,
  host: boolean,
  defId: string,
  value: { shareId?: unknown; follow?: unknown; author?: unknown },
) {
  insist(host, 403, "共有を操作できるのはホストだけです。");
  if (value.follow === true) {
    for (const row of sql(
      "SELECT id FROM edit_slide_shares WHERE deck=? AND kind='follow'",
      deck,
    ))
      deleteShareRow(sql, String(row.id));
    return;
  }
  if (typeof value.author === "string") {
    for (const row of sql(
      "SELECT id FROM edit_slide_shares WHERE deck=? AND kind='gallery' AND def=? AND author=?",
      deck,
      defId,
      value.author,
    ))
      deleteShareRow(sql, String(row.id));
    return;
  }
  insist(
    typeof value.shareId === "string",
    400,
    "取り消す共有を指定してください。",
  );
  const row = shareRow(sql, deck, value.shareId as string);
  insist(row, 404, "その共有は見つかりません。");
  deleteShareRow(sql, row!.id);
}

const shareView = (
  sql: HistorySQL,
  row: ShareRow,
  deck?: string,
): EditShareView => {
  let name: string | undefined;
  if (row.names) {
    // A group answer is credited to the group alone (stage 3b
    // design note) — never to the member who saved it last.
    const def = deck
      ? [...sql("SELECT mode FROM edit_slide_defs WHERE deck=? AND id=?", deck, row.def)][0]
      : undefined;
    if (def && String(def.mode) === "group") {
      const group = deckGroups(sql, deck!).find((g) => g.id === row.author);
      if (group) name = group.name;
    } else {
      const user = [...sql("SELECT name FROM users WHERE id=?", row.author)][0];
      if (user?.name) name = String(user.name);
    }
  }
  return {
    id: row.id,
    ...(name ? { name } : {}),
    slide: JSON.parse(row.slide) as Slide,
  };
};

/** The deck's live follow snapshot for one definition + author, as
 * the share endpoint serves it. Undefined when the host is not
 * showing that answer. */
export function followShareView(
  sql: HistorySQL,
  deck: string,
  defId: string,
  author: string,
): EditShareView | undefined {
  const row = [
    ...sql(
      "SELECT id,def,author,kind,names,slide FROM edit_slide_shares WHERE deck=? AND kind='follow' AND def=? AND author=?",
      deck,
      defId,
      author,
    ),
  ][0];
  if (!row) return undefined;
  return shareView(
    sql,
    {
      id: String(row.id),
      def: String(row.def),
      author: String(row.author),
      kind: String(row.kind),
      names: Number(row.names),
      slide: String(row.slide),
    },
    deck,
  );
}

/** Published gallery snapshots whose definition belongs to one
 * source slide, for the response gallery's read path. */
export function galleryShareViews(
  sql: HistorySQL,
  deck: string,
  source: string,
): EditShareView[] {
  return [
    ...sql(
      "SELECT s.id AS id,s.def AS def,s.author AS author,s.kind AS kind,s.names AS names,s.slide AS slide FROM edit_slide_shares s JOIN edit_slide_defs d ON d.id=s.def WHERE s.deck=? AND s.kind='gallery' AND d.source=? ORDER BY s.created",
      deck,
      source,
    ),
  ].map((row) =>
    shareView(
      sql,
      {
        id: String(row.id),
        def: String(row.def),
        author: String(row.author),
        kind: String(row.kind),
        names: Number(row.names),
        slide: String(row.slide),
      },
      deck,
    ),
  );
}
