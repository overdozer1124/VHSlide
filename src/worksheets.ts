import type { HistorySQL } from "./historyStore.ts";
import { SurveyError } from "./surveys.ts";
export type WorksheetField = {
  id: string;
  label: string;
  kind: "text" | "checkbox" | "single" | "multiple" | "radar";
  options: string[];
  placeholder: string;
  section: string;
  wide: boolean;
  widthPercent?: number;
  inputHeight?: number;
  fontSize?: number;
  radar?: { axes: string[]; series: string[]; min: number; max: number };
};
export type WorksheetDefinition = {
  title: string;
  description: string;
  fields: WorksheetField[];
  fontSize?: number;
};
export type WorksheetBinding = WorksheetDefinition & {
  deckId: string;
  worksheetId: string;
};
export type WorksheetValues = Record<
  string,
  string | boolean | (number | null)[]
>;
export type WorksheetResponse = {
  respondentId: string;
  name: string;
  email: string;
  values: WorksheetValues;
  updated: number;
};
export type WorksheetView = WorksheetDefinition & {
  id: string;
  status: "draft" | "open" | "closed";
  created: number;
  own?: WorksheetResponse;
  results?: { responses: WorksheetResponse[] };
};
function check(ok: unknown, message: string, status = 400): asserts ok {
  if (!ok) throw new SurveyError(status, message);
}
const str = (v: unknown, max: number) =>
  typeof v === "string" && v.length <= max;
export function parseWorksheet(value: unknown): WorksheetDefinition {
  const v = value as WorksheetDefinition;
  check(
    v && str(v.title, 200) && v.title.trim() && str(v.description, 1000),
    "タイトル・説明を確認してください。",
  );
  const validSize = (value: unknown, min: number, max: number) =>
    value === undefined ||
    (typeof value === "number" &&
      Number.isInteger(value) &&
      value >= min &&
      value <= max);
  check(
    validSize(v.fontSize, 12, 60),
    "文字の大きさは12〜60で入力してください。",
  );
  check(
    Array.isArray(v.fields) && v.fields.length > 0 && v.fields.length <= 40,
    "入力欄は1〜40項目です。",
  );
  const ids = new Set<string>();
  const fields = v.fields.map((f) => {
    check(
      f &&
        typeof f.id === "string" &&
        /^[a-zA-Z0-9_-]{1,60}$/.test(f.id) &&
        !["__proto__", "constructor", "prototype"].includes(f.id) &&
        !ids.has(f.id),
      "入力欄のIDが不正です。",
    );
    check(
      validSize(f.widthPercent, 20, 100) &&
        validSize(f.inputHeight, 32, 400) &&
        validSize(f.fontSize, 12, 60),
      "入力欄の幅・高さ・文字の大きさを確認してください。",
    );
    ids.add(f.id);
    check(
      str(f.label, 200) &&
        f.label.trim() &&
        str(f.placeholder, 200) &&
        str(f.section, 200) &&
        typeof f.wide === "boolean" &&
        ["text", "checkbox", "single", "multiple", "radar"].includes(f.kind),
      "入力欄の設定を確認してください。",
    );
    check(
      Array.isArray(f.options) &&
        (f.kind === "single" || f.kind === "multiple"
          ? f.options.length >= 2 && f.options.length <= 10
          : f.options.length === 0) &&
        f.options.every((o) => str(o, 100) && o.trim()) &&
        new Set(f.options).size === f.options.length,
      "選択肢は重複しない2〜10項目です。",
    );
    if (f.kind === "radar") {
      const radar = f.radar;
      const validLabels = (
        labels: unknown,
        min: number,
        max: number,
      ): labels is string[] =>
        Array.isArray(labels) &&
        labels.length >= min &&
        labels.length <= max &&
        labels.every((label) => str(label, 80) && label.trim()) &&
        new Set(labels.map((label) => label.trim())).size === labels.length;
      check(
        radar &&
          validLabels(radar.axes, 3, 10) &&
          validLabels(radar.series, 1, 4) &&
          Number.isInteger(radar.min) &&
          Number.isInteger(radar.max) &&
          radar.min >= 0 &&
          radar.max <= 100 &&
          radar.min < radar.max,
        "レーダーチャートの項目・系列・数値の範囲を確認してください。",
      );
    } else
      check(
        f.radar === undefined,
        "レーダーチャートの設定を確認してください。",
      );
    return {
      id: f.id,
      label: f.label.trim(),
      kind: f.kind,
      options: [...f.options],
      placeholder: f.placeholder,
      section: f.section,
      wide: f.wide,
      ...(f.widthPercent !== undefined ? { widthPercent: f.widthPercent } : {}),
      ...(f.inputHeight !== undefined ? { inputHeight: f.inputHeight } : {}),
      ...(f.fontSize !== undefined ? { fontSize: f.fontSize } : {}),
      ...(f.radar
        ? {
            radar: {
              axes: f.radar.axes.map((v) => v.trim()),
              series: f.radar.series.map((v) => v.trim()),
              min: f.radar.min,
              max: f.radar.max,
            },
          }
        : {}),
    };
  });
  return {
    title: v.title.trim(),
    description: v.description,
    fields,
    ...(v.fontSize !== undefined ? { fontSize: v.fontSize } : {}),
  };
}
export function parseWorksheetBinding(value: unknown): WorksheetBinding {
  const v = value as WorksheetBinding;
  check(
    v &&
      /^[a-f0-9-]{36}$/.test(v.deckId) &&
      /^[a-f0-9-]{36}$/.test(v.worksheetId),
    "ワークシートの参照が不正です。",
  );
  return { ...parseWorksheet(v), deckId: v.deckId, worksheetId: v.worksheetId };
}
export function parseWorksheetValues(
  sheet: WorksheetDefinition,
  input: unknown,
): WorksheetValues {
  check(
    input && typeof input === "object" && !Array.isArray(input),
    "入力内容を確認してください。",
  );
  const v = input as WorksheetValues;
  check(
    Object.keys(v).every((k) => sheet.fields.some((f) => f.id === k)),
    "存在しない入力欄です。",
  );
  const result: WorksheetValues = {};
  for (const f of sheet.fields) {
    const x =
      (Object.hasOwn(v, f.id) ? v[f.id] : undefined) ??
      (f.kind === "text" ? "" : f.kind === "checkbox" ? false : []);
    if (f.kind === "text") check(str(x, 2000), "記述欄は2000文字までです。");
    else if (f.kind === "checkbox")
      check(typeof x === "boolean", "チェック項目が不正です。");
    else if (f.kind === "radar")
      check(
        Array.isArray(x) &&
          (x.length === 0 ||
            x.length === f.radar!.axes.length * f.radar!.series.length) &&
          x.every(
            (n) =>
              n === null ||
              (typeof n === "number" &&
                Number.isInteger(n) &&
                n >= f.radar!.min &&
                n <= f.radar!.max),
          ),
        "数値は指定された範囲の整数で入力してください。",
      );
    else
      check(
        Array.isArray(x) &&
          x.length <= (f.kind === "single" ? 1 : 10) &&
          x.every(
            (i) =>
              typeof i === "number" &&
              Number.isInteger(i) &&
              i >= 0 &&
              i < f.options.length,
          ) &&
          new Set(x).size === x.length,
        "選択内容が不正です。",
      );
    result[f.id] = x;
  }
  return result;
}
export const worksheetSchema = `CREATE TABLE IF NOT EXISTS worksheets(id TEXT PRIMARY KEY,deck TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,definition TEXT NOT NULL,status TEXT NOT NULL,created INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS worksheets_deck ON worksheets(deck); CREATE TABLE IF NOT EXISTS worksheet_answers(worksheet TEXT NOT NULL REFERENCES worksheets(id) ON DELETE CASCADE,author TEXT NOT NULL,value TEXT NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(worksheet,author));`;
export function worksheetList(
  sql: HistorySQL,
  deck: string,
  actor: string,
  host: boolean,
): WorksheetView[] {
  return [
    ...sql(
      "SELECT * FROM worksheets WHERE deck=? ORDER BY created DESC,id",
      deck,
    ),
  ]
    .filter((r) => host || r.status !== "draft")
    .map((r) => {
      const sheet: WorksheetView = {
        ...JSON.parse(r.definition),
        id: r.id,
        status: r.status,
        created: r.created,
      };
      const answer = (a: Record<string, any>): WorksheetResponse => ({
        respondentId: a.author,
        name: a.name || "名前未登録",
        email: a.email || "",
        values: JSON.parse(a.value),
        updated: a.updated,
      });
      const own = [
        ...sql(
          "SELECT a.*,u.name,u.email FROM worksheet_answers a LEFT JOIN users u ON u.id=a.author WHERE a.worksheet=? AND a.author=?",
          r.id,
          actor,
        ),
      ][0];
      if (own) sheet.own = answer(own);
      if (host)
        sheet.results = {
          responses: [
            ...sql(
              "SELECT a.*,u.name,u.email FROM worksheet_answers a LEFT JOIN users u ON u.id=a.author WHERE a.worksheet=? ORDER BY a.updated,a.author",
              r.id,
            ),
          ].map(answer),
        };
      return sheet;
    });
}
export function worksheetCommand(
  sql: HistorySQL,
  deck: string,
  actor: string,
  host: boolean,
  action: string,
  id: string | undefined,
  value: Record<string, unknown>,
) {
  check(
    value && typeof value === "object" && !Array.isArray(value),
    "入力内容を確認してください。",
  );
  if (action === "create") {
    check(host, "作成できるのはホストだけです。", 403);
    check(
      [...sql("SELECT COUNT(*) AS n FROM worksheets WHERE deck=?", deck)][0].n <
        30,
      "ワークシートは1作品30件までです。",
      413,
    );
    const definition = parseWorksheet(value);
    sql(
      "INSERT INTO worksheets VALUES(?,?,?,?,?)",
      crypto.randomUUID(),
      deck,
      JSON.stringify(definition),
      "draft",
      Date.now(),
    );
    return;
  }
  const row = [
    ...sql("SELECT * FROM worksheets WHERE deck=? AND id=?", deck, id ?? ""),
  ][0];
  check(row, "ワークシートが見つかりません。", 404);
  if (action === "answer") {
    check(
      row.status === "open",
      "このワークシートは入力を受け付けていません。",
      409,
    );
    const definition = JSON.parse(row.definition) as WorksheetDefinition;
    const incoming = parseWorksheetValues(definition, value.values);
    const existing = [
      ...sql(
        "SELECT value FROM worksheet_answers WHERE worksheet=? AND author=?",
        row.id,
        actor,
      ),
    ][0];
    const values =
      value.patch === true
        ? {
            ...(existing
              ? JSON.parse(existing.value)
              : parseWorksheetValues(definition, {})),
            ...Object.fromEntries(
              Object.keys(value.values as object).map((k) => [k, incoming[k]]),
            ),
          }
        : incoming;
    const prior = [
      ...sql(
        "SELECT author FROM worksheet_answers WHERE worksheet=? AND author=?",
        row.id,
        actor,
      ),
    ][0];
    check(
      prior ||
        [
          ...sql(
            "SELECT COUNT(*) AS n FROM worksheet_answers WHERE worksheet=?",
            row.id,
          ),
        ][0].n < 500,
      "回答は500人までです。",
      413,
    );
    sql(
      "INSERT INTO worksheet_answers VALUES(?,?,?,?) ON CONFLICT(worksheet,author) DO UPDATE SET value=excluded.value,updated=excluded.updated",
      row.id,
      actor,
      JSON.stringify(values),
      Date.now(),
    );
    return;
  }
  check(host, "管理できるのはホストだけです。", 403);
  if (action === "edit") {
    const current = parseWorksheet(JSON.parse(row.definition));
    const expected = parseWorksheet(value.expected);
    check(
      JSON.stringify(current) === JSON.stringify(expected),
      "他の画面で内容が変更されました。最新の内容を読み込んでから編集してください。",
      409,
    );
    const next = parseWorksheet(value.definition);
    check(
      next.fields.length >= current.fields.length &&
        current.fields.every((f) => {
          const updated = next.fields.find((field) => field.id === f.id);
          return (
            !!updated &&
            f.kind === updated.kind &&
            f.options.length <= updated.options.length &&
            (f.kind !== "radar" ||
              (f.radar!.axes.length === updated.radar!.axes.length &&
                f.radar!.series.length === updated.radar!.series.length &&
                f.radar!.min === updated.radar!.min &&
                f.radar!.max === updated.radar!.max))
          );
        }),
      "既存の回答を保つため、既存の項目・選択肢の削除や回答形式の変更はできません。",
    );
    sql(
      "UPDATE worksheets SET definition=? WHERE id=? AND deck=?",
      JSON.stringify(next),
      row.id,
      deck,
    );
  } else if (action === "field") {
    const definition = JSON.parse(row.definition) as WorksheetDefinition;
    const field = (value as { field: WorksheetField }).field;
    const next = parseWorksheet({
      ...definition,
      fields: [...definition.fields, field],
    });
    sql(
      "UPDATE worksheets SET definition=? WHERE id=?",
      JSON.stringify(next),
      row.id,
    );
  } else if (action === "status") {
    check(
      ["open", "closed"].includes(String(value.status)),
      "受付状態を確認してください。",
    );
    sql(
      "UPDATE worksheets SET status=? WHERE id=?",
      value.status as string,
      row.id,
    );
  } else if (action === "delete")
    sql("DELETE FROM worksheets WHERE id=?", row.id);
  else throw new SurveyError(404, "操作が見つかりません。");
}
