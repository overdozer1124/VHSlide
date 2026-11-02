import { expect, it } from "vitest";
import { surveyResponsesCsv } from "./surveyCsv";
import type { SurveyView } from "./surveys";
const survey: SurveyView = {
  id: "s",
  question: '質問,"日本語"',
  kind: "multiple",
  options: ["春", "夏"],
  status: "open",
  created: 0,
  results: {
    count: 1,
    counts: [1, 1],
    texts: [],
    responses: [
      {
        respondentId: "u",
        name: "太郎",
        email: "t@example.test",
        choices: [0, 1],
        text: "",
        updated: Date.UTC(2026, 0, 1),
      },
    ],
  },
};
it("exports named answers, Japanese time, choice indicators and CSV quotes", () => {
  const csv = surveyResponsesCsv(survey);
  expect(csv.startsWith('\ufeff"質問"')).toBe(true);
  expect(csv).toContain(
    '"質問,""日本語""","複数選択","太郎","t@example.test","春 / 夏","2026/1/1 9:00:00","1","1"\r\n',
  );
  expect(csv.split("\r\n")).toHaveLength(3);
});
it("preserves multiline text and neutralizes spreadsheet formulas", () => {
  const s = structuredClone(survey);
  s.kind = "text";
  s.options = [];
  s.question = "=1+1";
  s.results!.responses![0].text = '発見,"花"\n次';
  const csv = surveyResponsesCsv(s);
  expect(csv).toContain('"\'=1+1"');
  expect(csv).toContain('"発見,""花""\n次"');
});
it("requires host response data", () => {
  expect(() => surveyResponsesCsv({ ...survey, results: undefined })).toThrow(
    "ホスト",
  );
});
