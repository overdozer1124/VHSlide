import type { HistorySQL } from "./historyStore.ts";
import { parseDeck } from "./model.ts";
import type { Slide } from "./model.ts";
import { worksheetList } from "./worksheets.ts";
import type { WorksheetView } from "./worksheets.ts";
import { surveyList, SurveyError } from "./surveys.ts";
import type { SurveyView } from "./surveys.ts";
export type GalleryCard = {
  id: string;
  name: string;
  email?: string;
  updated: number;
  worksheets: WorksheetView[];
  surveys: SurveyView[];
};
export type ResponseGallery = {
  slide: Slide;
  cards: GalleryCard[];
  names: boolean;
  live: boolean;
  created: number;
};
type Config = {
  participants: string[] | null;
  names: boolean;
  live: boolean;
  aliases?: Record<string, { id: string; number: number }>;
};
function check(v: unknown, status: number, message: string): asserts v {
  if (!v) throw new SurveyError(status, message);
}
export function galleryBuild(
  sql: HistorySQL,
  deck: string,
  actor: string,
  slide: Slide,
  config: Config,
  privatePreview = false,
): ResponseGallery {
  const fields = new Map<string, Set<string>>(),
    questions = new Set<string>();
  for (const e of slide.elements) {
    const b = e.responseField;
    if (b?.deckId === deck) {
      if (b.source === "worksheet") {
        if (!fields.has(b.worksheetId)) fields.set(b.worksheetId, new Set());
        fields.get(b.worksheetId)!.add(b.field.id);
      } else questions.add(b.surveyId);
    }
    if (e.worksheet?.deckId === deck)
      fields.set(
        e.worksheet.worksheetId,
        new Set(e.worksheet.fields.map((f) => f.id)),
      );
    if (e.survey?.deckId === deck) questions.add(e.survey.surveyId);
  }
  check(
    fields.size || questions.size,
    400,
    "このページに回答欄を配置してください。",
  );
  const sheets = worksheetList(sql, deck, actor, true).filter((s) =>
    fields.has(s.id),
  );
  const surveys = surveyList(sql, deck, actor, true).filter((s) =>
    questions.has(s.id),
  );
  const people = new Map<
    string,
    { name: string; email: string; updated: number }
  >();
  for (const s of [...sheets, ...surveys])
    for (const r of s.results?.responses ?? []) {
      if (config.participants && !config.participants.includes(r.respondentId))
        continue;
      const p = people.get(r.respondentId);
      people.set(r.respondentId, {
        name: r.name,
        email: r.email,
        updated: Math.max(p?.updated ?? 0, r.updated),
      });
    }
  const cards = [...people]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 500)
    .map(([id, p], index): GalleryCard => {
      const aliases = config.aliases;
      const alias =
        !privatePreview && aliases
          ? (aliases[id] ??
            (aliases[id] = {
              id: crypto.randomUUID(),
              number: Object.keys(aliases).length + 1,
            }))
          : undefined;
      const publicId = privatePreview ? id : (alias?.id ?? `card-${index + 1}`);
      const name =
        privatePreview || config.names
          ? p.name
          : `回答 ${alias?.number ?? index + 1}`;
      return {
        id: publicId,
        name,
        ...(privatePreview ? { email: p.email } : {}),
        updated: p.updated,
        worksheets: sheets.map((s) => {
          const { results: _, own: __, ...definition } = s;
          const own = s.results?.responses.find((r) => r.respondentId === id);
          return {
            ...definition,
            fields: s.fields.filter((f) => fields.get(s.id)!.has(f.id)),
            ...(own
              ? {
                  own: {
                    respondentId: publicId,
                    name,
                    email: "",
                    updated: own.updated,
                    values: Object.fromEntries(
                      Object.entries(own.values).filter(([key]) =>
                        fields.get(s.id)!.has(key),
                      ),
                    ),
                  },
                }
              : {}),
          };
        }),
        surveys: surveys.map((s) => ({
          id: s.id,
          question: s.question,
          kind: s.kind,
          options: s.options,
          status: s.status,
          created: s.created,
          own: s.results?.responses?.find((r) => r.respondentId === id)
            ? (({ choices, text }) => ({ choices, text }))(
                s.results.responses.find((r) => r.respondentId === id)!,
              )
            : undefined,
        })),
      };
    });
  return {
    slide,
    cards,
    names: config.names,
    live: config.live,
    created: Date.now(),
  };
}
export function galleryCommand(
  sql: HistorySQL,
  deck: string,
  actor: string,
  host: boolean,
  action: string,
  value: Record<string, unknown>,
): { gallery: ResponseGallery | null } {
  sql(
    "CREATE TABLE IF NOT EXISTS response_gallery(deck TEXT PRIMARY KEY REFERENCES decks(id) ON DELETE CASCADE,slide TEXT NOT NULL,config TEXT NOT NULL,snapshot TEXT NOT NULL)",
  );
  if (action === "read") {
    const row = [
      ...sql("SELECT * FROM response_gallery WHERE deck=?", deck),
    ][0];
    if (!row) return { gallery: null };
    const config = JSON.parse(row.config) as Config;
    if (!config.live) return { gallery: JSON.parse(row.snapshot) };
    config.aliases ??= {};
    const gallery = galleryBuild(
      sql,
      deck,
      actor,
      JSON.parse(row.slide),
      config,
    );
    const encoded = JSON.stringify(config);
    if (encoded !== row.config)
      sql("UPDATE response_gallery SET config=? WHERE deck=?", encoded, deck);
    return { gallery };
  }
  check(host, 403, "共有を操作できるのはホストだけです。");
  if (action === "stop") {
    sql("DELETE FROM response_gallery WHERE deck=?", deck);
    return { gallery: null };
  }
  check(
    action === "preview" || action === "publish",
    404,
    "操作が見つかりません。",
  );
  check(value && typeof value === "object", 400, "設定を確認してください。");
  const input = value.slide as Slide;
  check(
    input && Array.isArray(input.elements),
    400,
    "ページを選択してください。",
  );
  let slide: Slide;
  try {
    slide = parseDeck(
      JSON.stringify({
        version: 1,
        title: "回答の共有",
        slides: [
          {
            ...input,
            x: 0,
            y: 0,
            sheetId: undefined,
            speakerNotes: undefined,
            elements: input.elements.map((e) => ({ ...e, link: undefined })),
          },
        ],
      }),
    ).slides[0];
  } catch {
    throw new SurveyError(400, "ページの形式を確認してください。");
  }
  const config: Config = {
    participants:
      value.participants === null || value.participants === undefined
        ? null
        : (value.participants as string[]),
    names: value.names === true,
    live: value.live === true,
    ...(action === "publish" ? { aliases: {} } : {}),
  };
  check(
    config.participants === null ||
      (Array.isArray(config.participants) &&
        config.participants.length > 0 &&
        config.participants.length <= 500 &&
        config.participants.every(
          (id) => typeof id === "string" && id.length <= 100,
        )),
    400,
    "共有する回答を選択してください。",
  );
  const gallery = galleryBuild(
    sql,
    deck,
    actor,
    slide,
    config,
    action === "preview",
  );
  if (action === "publish") {
    const snapshot = galleryBuild(sql, deck, actor, slide, config);
    sql(
      "INSERT INTO response_gallery VALUES(?,?,?,?) ON CONFLICT(deck) DO UPDATE SET slide=excluded.slide,config=excluded.config,snapshot=excluded.snapshot",
      deck,
      JSON.stringify(slide),
      JSON.stringify(config),
      JSON.stringify(snapshot),
    );
    return { gallery: snapshot };
  }
  return { gallery };
}
