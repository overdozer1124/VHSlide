import { blank, parseDeck, type Deck } from "../../src/model";
export function scopeBook(): Deck {
  return parseDeck(
    JSON.stringify({
      version: 1,
      title: "範囲の検証",
      activeSheetId: "main",
      sheets: [
        {
          id: "main",
          name: "学級の比較",
          rowLabels: { 0: "A班", 1: "B班", 2: "C班" },
          columnLabels: { 0: "問い", 1: "理由", 2: "まとめ" },
        },
        { id: "other", name: "別シート" },
      ],
      slides: [
        ...Array.from({ length: 9 }, (_, i) => ({
          ...blank(i % 3, Math.floor(i / 3)),
          id: `p${i % 3}${Math.floor(i / 3)}`,
          title: `ページ${Math.floor(i / 3) + 1}.${(i % 3) + 1}`,
          elements: [
            {
              id: `text-${i}`,
              type: "text",
              x: 70,
              y: 120,
              w: 750,
              h: 150,
              text: `S${Math.floor(i / 3) + 1}.${(i % 3) + 1}`,
              fontSize: 64,
              color: "#173d38",
              ...(i === 0 ? { link: { slideId: "q00" } } : {}),
            },
          ],
        })),
        {
          ...blank(0, 0),
          id: "q00",
          sheetId: "other",
          title: "別シートのページ",
          elements: [
            {
              id: "other-text",
              type: "text",
              x: 70,
              y: 120,
              w: 750,
              h: 150,
              text: "OTHER",
              fontSize: 64,
              color: "#173d38",
            },
          ],
        },
      ],
      routes: [
        { id: "saved", name: "保存済みの発表", slides: ["p22", "q00", "p00"] },
      ],
    }),
  );
}
