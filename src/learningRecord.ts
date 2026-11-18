import type { HistorySQL } from "./historyStore.ts";
import type { Deck } from "./model.ts";
import { parseThinkingDefinition } from "./thinkingTools.ts";
import type { ThinkingPointValue } from "./thinkingTools.ts";
import { worksheetReasonKey } from "./worksheets.ts";
import type { WorksheetDefinition } from "./worksheets.ts";

/** Stage 3a: the learning record — one student's answers across a
 * whole deck (worksheets, surveys and thinking tools), ordered by
 * their place on the map (sheet → row → column). Read-only: no new
 * tables. The host reads everyone's record; a student reads only
 * their own, and the "own" side is always keyed by the signed-in
 * actor, never by a client-supplied id.
 *
 * Group tools appear in a student's record as the work of the
 * board(s) they actually wrote on (labelled with that group's
 * name) — membership changes over time, authorship does not. A
 * student who wrote nothing on a group tool still sees their
 * current group's board, marked as such. Class tools contribute
 * the points and cards that student authored inside the shared
 * chart. */

export type RecordPlacement = {
  slideId: string;
  sheetName: string;
  rowLabel: string;
  slideTitle: string;
};

export type RecordEntry = {
  kind: "worksheet" | "survey" | "thinking";
  refId: string;
  title: string;
  placement?: RecordPlacement;
  updated: number;
  /** Worksheet: one item per field of the definition. */
  fields?: {
    id: string;
    label: string;
    kind: string;
    options: string[];
    value: unknown;
    reason?: string;
  }[];
  /** Survey. */
  question?: string;
  surveyKind?: string;
  options?: string[];
  choices?: number[];
  text?: string;
  /** Thinking tools. */
  template?: string;
  unit?: string;
  groupName?: string;
  /** Group entry filled from the student's current group only
   * (they wrote nothing on this tool themselves). */
  groupCurrent?: boolean;
  nameA?: string;
  nameB?: string;
  scenes?: { id: string; label: string; value: ThinkingPointValue; reason: string }[];
  zones?: { id: string; label: string; cards: { text: string; color: string }[] }[];
};

export type StudentRecord = {
  userId: string;
  name: string;
  answered: number;
  total: number;
  entries: RecordEntry[];
};

/** Stage 3c: the answer-status matrix — students × map rows
 * （時間）. A column is one map row that holds at least one placed,
 * non-draft item; a cell counts how many of that row's items the
 * student answered and names the slide a click should open (the
 * student's own answered item's slide, else the row's first). */
export type RecordMatrixColumn = {
  key: string;
  sheetName: string;
  rowLabel: string;
  slideTitle: string;
  slideId: string;
  total: number;
};

export type RecordMatrix = {
  columns: RecordMatrixColumn[];
  rows: {
    userId: string;
    name: string;
    cells: { answered: number; slideId: string }[];
  }[];
};

type PlacementInfo = {
  placement: RecordPlacement;
  order: number;
  sheetId: string;
  y: number;
};

function placements(deck: Deck, deckId: string): Map<string, PlacementInfo> {
  const sheets = deck.sheets?.length
    ? deck.sheets
    : [{ id: "main", name: "" }];
  const sheetOrder = new Map(sheets.map((s, i) => [s.id, i]));
  const sheetById = new Map(sheets.map((s) => [s.id, s]));
  const ordered = [...deck.slides].sort(
    (a, b) =>
      (sheetOrder.get(a.sheetId ?? "main") ?? 0) -
        (sheetOrder.get(b.sheetId ?? "main") ?? 0) ||
      a.y - b.y ||
      a.x - b.x,
  );
  const map = new Map<string, PlacementInfo>();
  ordered.forEach((slide, idx) => {
    const sheet = sheetById.get(slide.sheetId ?? "main");
    const info: RecordPlacement = {
      slideId: slide.id,
      sheetName: sheet?.name ?? "",
      rowLabel: sheet?.rowLabels?.[slide.y] ?? "",
      slideTitle: slide.title ?? "",
    };
    const full: PlacementInfo = {
      placement: info,
      order: idx,
      sheetId: slide.sheetId ?? "main",
      y: slide.y,
    };
    for (const el of slide.elements) {
      if (el.worksheet?.deckId === deckId)
        map.set(`worksheet:${el.worksheet.worksheetId}`, full);
      if (el.survey?.deckId === deckId)
        map.set(`survey:${el.survey.surveyId}`, full);
      if (el.thinking?.deckId === deckId)
        map.set(`thinking:${el.thinking.toolId}`, full);
    }
  });
  return map;
}

function parseJson<T>(raw: unknown, fallback: T): T {
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
}

function buildRecords(
  sql: HistorySQL,
  deck: Deck,
  deckId: string,
  userIds: string[],
): { records: StudentRecord[]; matrix: RecordMatrix } {
  const place = placements(deck, deckId);
  // Matrix columns: one per map row holding at least one placed
  // item, in map order. Totals count non-draft items only (filled
  // in below, where each source's status is known).
  const columnByKey = new Map<
    string,
    RecordMatrixColumn & { order: number }
  >();
  const columnOfItem = new Map<string, string>();
  for (const [itemKey, info] of place) {
    const key = `${info.sheetId}:${info.y}`;
    columnOfItem.set(itemKey, key);
    const existing = columnByKey.get(key);
    if (!existing || info.order < existing.order)
      columnByKey.set(key, {
        key,
        sheetName: info.placement.sheetName,
        rowLabel: info.placement.rowLabel,
        slideTitle: info.placement.slideTitle,
        slideId: info.placement.slideId,
        total: 0,
        order: info.order,
      });
  }
  const countItem = (kind: string, row: Record<string, unknown>) => {
    if (row.status === "draft") return;
    const key = columnOfItem.get(`${kind}:${String(row.id)}`);
    const column = key ? columnByKey.get(key) : undefined;
    if (column) column.total += 1;
  };
  // Per-student answered counts per column, with the slide of the
  // student's earliest answered item in that row as the target.
  const cellMap = new Map<
    string,
    Map<string, { answered: number; slideId: string; order: number }>
  >();
  const nameOf = (id: string): string =>
    [...sql("SELECT name FROM users WHERE id=?", id)][0]?.name || "名前未登録";
  const groupOf = new Map<string, { id: string; name: string }>();
  for (const uid of userIds) {
    const row = [
      ...sql(
        "SELECT m.grp AS id, g.name AS name FROM deck_group_members m JOIN deck_groups g ON g.id=m.grp WHERE m.deck=? AND m.user=?",
        deckId,
        uid,
      ),
    ][0];
    if (row) groupOf.set(uid, { id: String(row.id), name: String(row.name) });
  }

  const worksheets = [...sql("SELECT * FROM worksheets WHERE deck=? ORDER BY created,id", deckId)];
  const surveys = [...sql("SELECT * FROM surveys WHERE deck=? ORDER BY created,id", deckId)];
  const tools = [...sql("SELECT * FROM thinking_tools WHERE deck=? ORDER BY created,id", deckId)];
  const total =
    worksheets.filter((r) => r.status !== "draft").length +
    surveys.filter((r) => r.status !== "draft").length +
    tools.filter((r) => r.status !== "draft").length;
  for (const row of worksheets) countItem("worksheet", row);
  for (const row of surveys) countItem("survey", row);
  for (const row of tools) countItem("thinking", row);

  const byUser = new Map<string, { entry: RecordEntry; order: number; created: number }[]>();
  for (const uid of userIds) byUser.set(uid, []);
  const push = (uid: string, entry: RecordEntry, created: number) => {
    const info = place.get(`${entry.kind}:${entry.refId}`);
    if (info) entry.placement = info.placement;
    byUser.get(uid)?.push({ entry, order: info?.order ?? Number.MAX_SAFE_INTEGER, created });
    if (info) {
      const columnKey = columnOfItem.get(`${entry.kind}:${entry.refId}`);
      if (columnKey) {
        let cells = cellMap.get(uid);
        if (!cells) cellMap.set(uid, (cells = new Map()));
        const cell = cells.get(columnKey) ?? {
          answered: 0,
          slideId: info.placement.slideId,
          order: info.order,
        };
        cell.answered += 1;
        if (info.order < cell.order) {
          cell.order = info.order;
          cell.slideId = info.placement.slideId;
        }
        cells.set(columnKey, cell);
      }
    }
  };

  for (const row of worksheets) {
    if (row.status === "draft") continue;
    const definition = parseJson<WorksheetDefinition>(row.definition, {
      title: "",
      description: "",
      fields: [],
    } as WorksheetDefinition);
    const answers = new Map(
      [...sql("SELECT author, value, updated FROM worksheet_answers WHERE worksheet=?", row.id)].map(
        (a) => [String(a.author), a],
      ),
    );
    for (const uid of userIds) {
      const answer = answers.get(uid);
      if (!answer) continue;
      const values = parseJson<Record<string, unknown>>(answer.value, {});
      push(
        uid,
        {
          kind: "worksheet",
          refId: String(row.id),
          title: definition.title || "ワークシート",
          updated: Number(answer.updated) || 0,
          fields: (definition.fields ?? []).map((f) => ({
            id: f.id,
            label: f.label,
            kind: f.kind,
            options: f.options ?? [],
            value: values[f.id] ?? null,
            ...(f.reason
              ? { reason: String(values[worksheetReasonKey(f.id)] ?? "") }
              : {}),
          })),
        },
        Number(row.created) || 0,
      );
    }
  }

  for (const row of surveys) {
    if (row.status === "draft") continue;
    const options = parseJson<string[]>(row.options, []);
    const answers = new Map(
      [...sql("SELECT author, value, updated FROM survey_answers WHERE survey=?", row.id)].map(
        (a) => [String(a.author), a],
      ),
    );
    for (const uid of userIds) {
      const answer = answers.get(uid);
      if (!answer) continue;
      const value = parseJson<{ choices?: number[]; text?: string }>(answer.value, {});
      push(
        uid,
        {
          kind: "survey",
          refId: String(row.id),
          title: String(row.question ?? ""),
          question: String(row.question ?? ""),
          surveyKind: String(row.kind ?? ""),
          options,
          choices: value.choices ?? [],
          text: value.text ?? "",
          updated: Number(answer.updated) || 0,
        },
        Number(row.created) || 0,
      );
    }
  }

  const groupNames = new Map(
    [...sql("SELECT id, name FROM deck_groups WHERE deck=?", deckId)].map((g) => [
      String(g.id),
      String(g.name),
    ]),
  );

  for (const row of tools) {
    if (row.status === "draft") continue;
    let parsed: ReturnType<typeof parseThinkingDefinition>;
    try {
      parsed = parseThinkingDefinition(
        String(row.template),
        parseJson(row.definition, {}),
      );
    } catch {
      continue;
    }
    const { template, definition } = parsed;
    const unit = String(row.unit);
    const points = [...sql("SELECT owner, scene, value, reason, author FROM thinking_points WHERE tool=?", row.id)];
    const cards = [...sql("SELECT owner, zone, text, color, author FROM thinking_cards WHERE tool=? ORDER BY sort, created", row.id)];
    const isBoard = (definition.zones ?? []).length > 0;
    const buildEntry = (
      uid: string,
      keep: (owner: string, author: string) => boolean,
      extra: Partial<RecordEntry>,
    ): void => {
      const entry: RecordEntry = {
        kind: "thinking",
        refId: String(row.id),
        title: definition.title || "思考ツール",
        template,
        unit,
        nameA: definition.nameA,
        nameB: definition.nameB,
        updated: 0,
        ...extra,
      };
      if (isBoard) {
        const own = cards.filter((c) => keep(String(c.owner), String(c.author)));
        if (!own.length) return;
        entry.zones = (definition.zones ?? []).map((z) => ({
          id: z.id,
          label: z.label,
          cards: own
            .filter((c) => String(c.zone) === z.id)
            .map((c) => ({ text: String(c.text), color: String(c.color ?? "") })),
        }));
      } else {
        const own = points.filter((p) => keep(String(p.owner), String(p.author)));
        if (!own.length) return;
        entry.scenes = (definition.scenes ?? []).map((s) => {
          const point = own.find((p) => String(p.scene) === s.id);
          return point
            ? {
                id: s.id,
                label: s.label,
                value: parseJson<ThinkingPointValue>(point.value, {}),
                reason: String(point.reason ?? ""),
              }
            : { id: s.id, label: s.label, value: {}, reason: "" };
        });
      }
      push(uid, entry, Number(row.created) || 0);
    };
    for (const uid of userIds) {
      if (unit === "group") {
        // The boards in this student's record are the ones they
        // actually wrote on (a point or card with their name on it).
        // Membership changes over time; authorship does not.
        const authored: string[] = [];
        for (const r of [...points, ...cards]) {
          const owner = String(r.owner);
          if (String(r.author) === uid && !authored.includes(owner))
            authored.push(owner);
        }
        const boards = authored.map((owner) => ({ owner, current: false }));
        if (!boards.length) {
          // Nothing written by this student: fall back to their
          // current group's board, marked as the current group.
          const group = groupOf.get(uid);
          const hasBoard =
            !!group &&
            (points.some((p) => String(p.owner) === group.id) ||
              cards.some((c) => String(c.owner) === group.id));
          if (group && hasBoard) boards.push({ owner: group.id, current: true });
        }
        for (const b of boards) {
          buildEntry(uid, (owner) => owner === b.owner, {
            groupName: groupNames.get(b.owner) ?? "班",
            ...(b.current ? { groupCurrent: true } : {}),
          });
        }
      } else {
        buildEntry(
          uid,
          (owner, author) =>
            unit === "individual" ? owner === uid : author === uid,
          {},
        );
      }
    }
  }

  const records = userIds.map((uid) => {
    const list = (byUser.get(uid) ?? []).sort(
      (a, b) => a.order - b.order || a.created - b.created,
    );
    return {
      userId: uid,
      name: nameOf(uid),
      answered: list.length,
      total,
      entries: list.map((x) => x.entry),
    };
  });
  const columns = [...columnByKey.values()]
    .filter((c) => c.total > 0)
    .sort((a, b) => a.order - b.order)
    .map(({ order: _order, ...column }) => column);
  const matrix: RecordMatrix = {
    columns,
    rows: records.map((record) => ({
      userId: record.userId,
      name: record.name,
      cells: columns.map((column) => {
        const cell = cellMap.get(record.userId)?.get(column.key);
        return {
          answered: cell?.answered ?? 0,
          slideId: cell?.slideId ?? column.slideId,
        };
      }),
    })),
  };
  return { records, matrix };
}

function recordUserIds(
  sql: HistorySQL,
  deckId: string,
  ownerId: string,
  filterUser?: string,
): string[] {
  const ids = new Set<string>();
  for (const row of sql("SELECT user_id FROM members WHERE deck=?", deckId))
    ids.add(String(row.user_id));
  for (const row of sql(
    "SELECT a.author AS author FROM worksheet_answers a JOIN worksheets w ON w.id=a.worksheet WHERE w.deck=? UNION SELECT a.author FROM survey_answers a JOIN surveys s ON s.id=a.survey WHERE s.deck=? UNION SELECT p.author FROM thinking_points p JOIN thinking_tools t ON t.id=p.tool WHERE t.deck=? UNION SELECT c.author FROM thinking_cards c JOIN thinking_tools t ON t.id=c.tool WHERE t.deck=?",
    deckId,
    deckId,
    deckId,
    deckId,
  ))
    ids.add(String(row.author));
  ids.delete(ownerId);
  const list = [...ids].sort();
  return filterUser ? list.filter((id) => id === filterUser) : list;
}

/** Host view: every student's record. Students are the deck's
 * members plus anyone who has answered, minus the owner. `filterUser`
 * narrows the result to one student. */
export function learningRecord(
  sql: HistorySQL,
  deck: Deck,
  deckId: string,
  ownerId: string,
  filterUser?: string,
): StudentRecord[] {
  return buildRecords(
    sql,
    deck,
    deckId,
    recordUserIds(sql, deckId, ownerId, filterUser),
  ).records;
}

/** Host view: the answer-status matrix for the same students. */
export function learningRecordMatrix(
  sql: HistorySQL,
  deck: Deck,
  deckId: string,
  ownerId: string,
  filterUser?: string,
): RecordMatrix {
  return buildRecords(
    sql,
    deck,
    deckId,
    recordUserIds(sql, deckId, ownerId, filterUser),
  ).matrix;
}

/** A student's own record. The actor comes from the caller's
 * session; nothing in the request can name another student. */
export function myLearningRecord(
  sql: HistorySQL,
  deck: Deck,
  deckId: string,
  actor: string,
): StudentRecord {
  return buildRecords(sql, deck, deckId, [actor]).records[0];
}
