import { remapAxis } from "./axes";
import { W, H, MAX_SLIDES, uid, parseDeck, serializeDeck } from "./model";
import type { Deck, Element, Slide } from "./model";
import type { SurveyView } from "./surveys";
import { chartColors } from "./chartData";

export function insertSurveyResults(
  book: Deck,
  at: Slide,
  survey: SurveyView,
  deckId?: string,
): { book: Deck; first: string } {
  if (!survey.results)
    throw new Error("集計結果を取得してから挿入してください。");
  const result = survey.results;
  if (!result.count) throw new Error("まだ回答がありません。");
  const text = (
    value: string,
    x: number,
    y: number,
    w: number,
    h: number,
    size: number,
  ): Element => ({
    id: uid(),
    type: "text",
    text: value,
    x,
    y,
    w,
    h,
    fontSize: size,
    color: "#173d38",
  });
  const pages: Element[][] = [];
  if (survey.kind !== "text") {
    pages.push([
      {
        id: uid(),
        type: "chart",
        ...(deckId
          ? {
              surveyResult: {
                deckId,
                surveyId: survey.id,
                part: "chart" as const,
              },
            }
          : {}),
        x: 60,
        y: 160,
        w: W - 120,
        h: H - 215,
        chart: {
          kind: "bar",
          title: "回答数",
          showValues: true,
          showLegend: true,
          series: survey.options.map((label, i) => ({
            id: uid(),
            label,
            value: result.counts[i],
            color: chartColors[i % chartColors.length],
          })),
        },
      },
    ]);
  } else {
    const lines: string[] = [];
    result.texts.forEach((answer, i) => {
      lines.push(`【回答 ${i + 1}】`);
      for (const line of answer.split(/\r?\n/)) {
        const chars = Array.from(line);
        if (!chars.length) lines.push("");
        for (let pos = 0; pos < chars.length; pos += 36)
          lines.push(chars.slice(pos, pos + 36).join(""));
      }
      lines.push("");
    });
    for (let i = 0; i < lines.length; i += 11)
      pages.push([
        text(lines.slice(i, i + 11).join("\n"), 60, 160, 840, 335, 22),
      ]);
  }
  const sheetId = at.sheetId ?? "main";
  if (pages.length > 100 || book.slides.length + pages.length > MAX_SLIDES)
    throw new Error(
      "集計結果のページ数が上限を超えます。記述回答を短くするか、作品のページを減らしてください。",
    );
  if (
    book.slides.some(
      (s) => (s.sheetId ?? "main") === sheetId && s.x >= at.x + 1 && s.x >= 99,
    )
  )
    throw new Error(
      "右側の列が100列に達しています。空きのある場所に移動して挿入してください。",
    );
  if (at.x >= 99) throw new Error("右側に挿入する列がありません。");
  const slides = pages.map((elements, i): Slide => ({
    id: uid(),
    sheetId,
    x: at.x + 1,
    y: i,
    title: `${survey.question.slice(0, 160)}（集計${pages.length > 1 ? ` ${i + 1}/${pages.length}` : ""}）`,
    background: "#ffffff",
    elements: [
      text(
        survey.question,
        60,
        20,
        840,
        90,
        survey.question.length > 100
          ? 16
          : survey.question.length > 50
            ? 20
            : 28,
      ),
      {
        ...text(
          `${result.count}人が回答${survey.kind === "multiple" ? "・複数選択（各項目の件数）" : ""} ／ ${new Date().toLocaleString("ja-JP")} 時点`,
          60,
          120,
          840,
          30,
          16,
        ),
        ...(deckId && survey.kind !== "text"
          ? {
              surveyResult: {
                deckId,
                surveyId: survey.id,
                part: "caption" as const,
              },
            }
          : {}),
      },
      ...elements,
    ],
  }));
  const next = {
    ...remapAxis({ ...book, activeSheetId: sheetId }, "columns", (i) =>
      i > at.x ? i + 1 : i,
    ),
    activeSheetId: book.activeSheetId,
    slides: [
      ...book.slides.map((s) =>
        (s.sheetId ?? "main") === sheetId && s.x > at.x
          ? { ...s, x: s.x + 1 }
          : s,
      ),
      ...slides,
    ],
  };
  return { book: parseDeck(serializeDeck(next)), first: slides[0].id };
}
