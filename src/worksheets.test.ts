import { describe, it, expect } from "vitest";
import {
  parseWorksheet,
  parseWorksheetBinding,
  parseWorksheetValues,
  worksheetReasonKey,
  worksheetList,
} from "./worksheets";
import { DatabaseSync } from "node:sqlite";
import type { HistorySQL } from "./historyStore";
import {
  worksheetTemplate,
  worksheetTemplateNames,
} from "./worksheetTemplates";
import { worksheetCsv } from "./worksheetCsv";
import { sample, parseDeck, serializeDeck } from "./model";
import { modalLayoutItems } from "./WorksheetModalLayout";
import {
  moveWorksheetFieldToSection,
  sectionWorksheet,
} from "./worksheetSections";
describe("worksheets", () => {
  it("moves fields between sections, including empty sections, without changing their IDs", () => {
    const original = sectionWorksheet(worksheetTemplate("reason"));
    const empty = { id: crypto.randomUUID(), title: "空のセクション" };
    const sheet = {
      ...original,
      sections: [original.sections![0], empty, ...original.sections!.slice(1)],
    };
    const field = sheet.fields[0];
    const moved = moveWorksheetFieldToSection(sheet, field.id, empty.id);
    expect(moved.fields.map((f) => f.id)).toEqual([
      sheet.fields[1].id,
      field.id,
      ...sheet.fields.slice(2).map((f) => f.id),
    ]);
    expect(moved.fields[1]).toEqual({
      ...field,
      sectionId: empty.id,
      section: empty.title,
    });
    expect(sheet.fields[0]).toEqual(field);
    expect(parseWorksheet(moved)).toEqual(moved);
    const value = { [field.id]: "保存済みの回答" };
    expect(parseWorksheetValues(moved, value)[field.id]).toBe("保存済みの回答");
    const last = moveWorksheetFieldToSection(
      moved,
      field.id,
      original.sections![1].id,
    );
    expect(last.fields.at(-1)?.id).toBe(field.id);
    expect(
      moveWorksheetFieldToSection(last, field.id, original.sections![1].id),
    ).toBe(last);
  });
  it("keeps participant order stable and reveals only explicitly published anonymous summaries", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(
      "CREATE TABLE worksheets(id TEXT,deck TEXT,definition TEXT,status TEXT,created INTEGER); CREATE TABLE worksheet_answers(worksheet TEXT,author TEXT,value TEXT,updated INTEGER); CREATE TABLE users(id TEXT,name TEXT,email TEXT); CREATE TABLE members(deck TEXT,user_id TEXT); CREATE TABLE recipients(deck TEXT,user_id TEXT,rank INTEGER)",
    );
    const sql: HistorySQL = (query, ...args) => db.prepare(query).all(...args);
    const field = {
      ...worksheetTemplate("blank").fields[0],
      id: "choice",
      kind: "single",
      options: ["A", "B"],
      reason: true,
    };
    const def = { title: "質問", description: "", fields: [field] };
    db.prepare("INSERT INTO worksheets VALUES(?,?,?,?,?)").run(
      "sheet",
      "deck",
      JSON.stringify(def),
      "open",
      1,
    );
    for (const [id, rank, selected, updated] of [
      ["b", 1, 1, 100],
      ["a", 0, 0, 200],
    ] as const) {
      db.prepare("INSERT INTO users VALUES(?,?,?)").run(id, id, `${id}@test`);
      db.prepare("INSERT INTO members VALUES(?,?)").run("deck", id);
      db.prepare("INSERT INTO recipients VALUES(?,?,?)").run("deck", id, rank);
      db.prepare("INSERT INTO worksheet_answers VALUES(?,?,?,?)").run(
        "sheet",
        id,
        JSON.stringify({ choice: [selected], "choice:reason": "秘密" }),
        updated,
      );
    }
    const host = worksheetList(sql, "deck", "host", true)[0];
    expect(host.results!.responses.map((r) => r.respondentId)).toEqual([
      "a",
      "b",
    ]);
    expect(host.summaries!.choice).toEqual({ count: 2, counts: [1, 1] });
    const privateGuest = worksheetList(sql, "deck", "a", false)[0];
    expect(privateGuest.results).toBeUndefined();
    expect(privateGuest.summaries).toBeUndefined();
    db.prepare("UPDATE worksheets SET definition=?").run(
      JSON.stringify({ ...def, fields: [{ ...field, aggregatePublic: true }] }),
    );
    const guest = worksheetList(sql, "deck", "a", false)[0];
    expect(guest.summaries!.choice).toEqual({ count: 2, counts: [1, 1] });
    expect(JSON.stringify(guest.summaries)).not.toContain("秘密");
    db.prepare(
      "UPDATE worksheet_answers SET updated=999 WHERE author='b'",
    ).run();
    expect(
      worksheetList(sql, "deck", "host", true)[0].results!.responses.map(
        (r) => r.respondentId,
      ),
    ).toEqual(["a", "b"]);
    db.close();
  });
  it("migrates existing groups to independent sections without changing field IDs or answers", () => {
    const legacy = worksheetTemplate("reason");
    const migrated = sectionWorksheet(legacy);
    expect(migrated.sections?.map((s) => s.title)).toEqual([
      "理由と工夫",
      "話し合い",
    ]);
    expect(migrated.fields.map((f) => f.id)).toEqual(
      legacy.fields.map((f) => f.id),
    );
    expect(migrated.fields[0].sectionId).toBe(migrated.fields[1].sectionId);
    expect(migrated.fields[2].sectionId).not.toBe(migrated.fields[1].sectionId);
    const empty = { id: "empty-section", title: "これから入力" };
    const saved = parseWorksheet({
      ...migrated,
      sections: [...migrated.sections!, empty],
    });
    expect(saved.sections?.at(-1)).toEqual(empty);
    const values = { [legacy.fields[0].id]: "残したい回答" };
    expect(parseWorksheetValues(saved, values)[legacy.fields[0].id]).toBe(
      "残したい回答",
    );
    expect(() => parseWorksheet({ ...saved, sections: [] })).toThrow();
  });
  it("keeps choices and reasons separately, validates partial saves, and exports both", () => {
    const base = worksheetTemplate("blank");
    const field = {
      ...base.fields[0],
      kind: "multiple" as const,
      options: ["朝", "昼"],
      reason: true,
    };
    const sheet = parseWorksheet({ ...base, fields: [field] });
    const reasonKey = worksheetReasonKey(field.id);
    const values = parseWorksheetValues(sheet, {
      [field.id]: [1],
      [reasonKey]: "理由,を記入",
    });
    expect(values[field.id]).toEqual([1]);
    expect(values[reasonKey]).toBe("理由,を記入");
    expect(
      parseWorksheetValues(sheet, { [reasonKey]: "途中" })[reasonKey],
    ).toBe("途中");
    expect(() =>
      parseWorksheetValues(sheet, { [reasonKey]: "x".repeat(2001) }),
    ).toThrow();
    expect(() =>
      parseWorksheetValues(
        { ...sheet, fields: [{ ...field, reason: undefined }] },
        { [reasonKey]: "不要" },
      ),
    ).toThrow();
    const csv = worksheetCsv({
      ...sheet,
      id: "sheet",
      status: "open",
      created: 0,
      results: {
        responses: [
          {
            respondentId: "u",
            name: "生徒",
            email: "a@test",
            updated: 0,
            values,
          },
        ],
      },
    });
    expect(csv).toContain(`"${field.label}：理由"`);
    expect(csv).toContain('"昼","理由,を記入"');
  });
  it("preserves and validates modal layout while placing newly added fields below it", () => {
    const sheet = worksheetTemplate("reason");
    const layout = {
      items: [{ id: sheet.fields[0].id, x: 50, y: 20, w: 450, h: 160 }],
    };
    const updated = { ...sheet, modalLayout: layout };
    expect(parseWorksheet(updated).modalLayout).toEqual(layout);
    const items = modalLayoutItems(updated);
    expect(items[0]).toEqual(layout.items[0]);
    expect(items[1].y).toBeGreaterThanOrEqual(180);
    expect(() =>
      parseWorksheet({
        ...sheet,
        modalLayout: { items: [{ ...layout.items[0], x: 700 }] },
      }),
    ).toThrow();
    expect(() =>
      parseWorksheet({
        ...sheet,
        modalLayout: { items: [{ ...layout.items[0], id: "unknown" }] },
      }),
    ).toThrow();
    expect(() =>
      parseWorksheet({
        ...sheet,
        modalLayout: { items: [layout.items[0], layout.items[0]] },
      }),
    ).toThrow();
  });
  it("validates radar scores and exports each axis and series in separate CSV columns", () => {
    const sheet = worksheetTemplate("radar");
    const f = sheet.fields[0];
    const scores = [1, 2, 3, 4, 5, null, 5, 4, 3, 2, 1, null];
    expect(parseWorksheetValues(sheet, { [f.id]: scores })[f.id]).toEqual(
      scores,
    );
    expect(() => parseWorksheetValues(sheet, { [f.id]: [9] })).toThrow();
    expect(() =>
      parseWorksheetValues(sheet, { [f.id]: [9, ...scores.slice(1)] }),
    ).toThrow();
    const csv = worksheetCsv({
      ...sheet,
      id: "sheet",
      created: 0,
      status: "open",
      results: {
        responses: [
          {
            respondentId: "u",
            name: "生徒",
            email: "a@test",
            updated: 0,
            values: { [f.id]: scores },
          },
        ],
      },
    });
    expect(csv).toContain('"項目ごとの評価：場面1：項目1"');
    expect(csv).toContain('"項目ごとの評価：場面2：項目6"');
    expect(csv).toContain('"1","2","3","4","5","","5","4","3","2","1",""');
  });
  it("preserves optional layout settings through serialization and rejects invalid dimensions", () => {
    const sheet = worksheetTemplate("blank");
    const styled = {
      ...sheet,
      fontSize: 24,
      fields: [
        {
          ...sheet.fields[0],
          widthPercent: 70,
          inputHeight: 120,
          fontSize: 22,
        },
      ],
    };
    expect(parseWorksheet(styled)).toEqual(styled);
    const book = sample();
    book.slides[0].elements.push({
      id: crypto.randomUUID(),
      type: "shape",
      shape: "rounded",
      fill: "#ffffff",
      stroke: "#dc8945",
      x: 0,
      y: 0,
      w: 900,
      h: 500,
      worksheet: {
        ...styled,
        deckId: crypto.randomUUID(),
        worksheetId: crypto.randomUUID(),
      },
    });
    expect(parseDeck(serializeDeck(book))).toEqual(book);
    expect(() =>
      parseWorksheet({
        ...styled,
        fields: [{ ...styled.fields[0], widthPercent: 101 }],
      }),
    ).toThrow();
    expect(() =>
      parseWorksheet({
        ...styled,
        fields: [{ ...styled.fields[0], inputHeight: -1 }],
      }),
    ).toThrow();
    expect(() => parseWorksheet({ ...styled, fontSize: 999 })).toThrow();
  });
  it("validates every classroom template and preserves only portable definitions", () => {
    for (const kind of Object.keys(
      worksheetTemplateNames,
    ) as (keyof typeof worksheetTemplateNames)[]) {
      const definition = worksheetTemplate(kind);
      expect(parseWorksheet(definition)).toEqual(definition);
      const sheet = parseWorksheetBinding({
        ...definition,
        deckId: crypto.randomUUID(),
        worksheetId: crypto.randomUUID(),
        results: { secret: "private" },
        own: { secret: "private" },
      });
      expect(sheet).not.toHaveProperty("results");
      expect(sheet).not.toHaveProperty("own");
      const book = sample();
      book.slides[0].elements.push({
        id: crypto.randomUUID(),
        type: "shape",
        shape: "rounded",
        fill: "#ffffff",
        stroke: "#dc8945",
        x: 0,
        y: 0,
        w: 900,
        h: 500,
        worksheet: sheet,
      });
      expect(parseDeck(serializeDeck(book))).toEqual(book);
    }
  });
  it("accepts partial work and unchecked checklists, rejects invalid types and foreign fields", () => {
    const sheet = worksheetTemplate("check");
    const values = parseWorksheetValues(sheet, {});
    expect(Object.values(values).every((v) => v === false)).toBe(true);
    expect(() =>
      parseWorksheetValues(sheet, { [sheet.fields[0].id]: "yes" }),
    ).toThrow();
    expect(() => parseWorksheetValues(sheet, { foreign: "bad" })).toThrow();
    const text = worksheetTemplate("reason");
    expect(parseWorksheetValues(text, {})[text.fields[0].id]).toBe("");
    expect(() =>
      parseWorksheetValues(text, { [text.fields[0].id]: "あ".repeat(2001) }),
    ).toThrow();
  });
  it("rejects duplicate ids, unsafe keys, too many fields, invalid choices and mixed bindings", () => {
    const sheet = worksheetTemplate("blank");
    expect(() =>
      parseWorksheet({ ...sheet, fields: [sheet.fields[0], sheet.fields[0]] }),
    ).toThrow();
    expect(() =>
      parseWorksheet({
        ...sheet,
        fields: [{ ...sheet.fields[0], id: "__proto__" }],
      }),
    ).toThrow();
    expect(() =>
      parseWorksheet({
        ...sheet,
        fields: Array.from({ length: 41 }, (_, i) => ({
          ...sheet.fields[0],
          id: String(i),
        })),
      }),
    ).toThrow();
    const choice = {
      ...sheet,
      fields: [
        { ...sheet.fields[0], kind: "single" as const, options: ["A", "B"] },
      ],
    };
    expect(() =>
      parseWorksheetValues(choice, { [choice.fields[0].id]: [0, 1] }),
    ).toThrow();
    expect(() =>
      parseWorksheetValues(choice, { [choice.fields[0].id]: [2] }),
    ).toThrow();
    const book = sample();
    book.slides[0].elements.push({
      id: crypto.randomUUID(),
      type: "text",
      x: 0,
      y: 0,
      w: 900,
      h: 500,
      worksheet: parseWorksheetBinding({
        ...sheet,
        deckId: crypto.randomUUID(),
        worksheetId: crypto.randomUUID(),
      }),
    });
    expect(() => parseDeck(serializeDeck(book))).toThrow();
  });
  it("exports one row per account with all fields, BOM, multiline quoting and formula protection", () => {
    const sheet = worksheetTemplate("blank");
    const id = sheet.fields[0].id;
    const csv = worksheetCsv({
      ...sheet,
      id: "s",
      created: 0,
      status: "open",
      results: {
        responses: [
          {
            respondentId: "u",
            name: "=1+1",
            email: "a@test",
            updated: 0,
            values: { [id]: '日本語,"花"\n次' },
          },
        ],
      },
    });
    expect(csv.startsWith("\ufeff")).toBe(true);
    expect(csv).toContain('"\'=1+1"');
    expect(csv).toContain('"日本語,""花""\n次"');
    expect(() =>
      worksheetCsv({ ...sheet, id: "s", created: 0, status: "open" }),
    ).toThrow("ホスト");
  });
});
