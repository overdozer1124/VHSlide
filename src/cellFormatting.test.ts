import { expect, it } from "vitest";
import { cellFormatState, effectiveCellStyle } from "./cellFormatting";
import { createTable, cellKey } from "./tableData";
import type { Element } from "./model";
it("distinguishes mixed values after resolving inherited and header styles without modifying data", () => {
  let n = 0;
  const e: Element = {
    id: "t",
    type: "table",
    x: 0,
    y: 0,
    w: 300,
    h: 200,
    table: createTable(2, 2, () => `c${++n}`),
    color: "#173D38",
    fill: "#ffffff",
    fontSize: 24,
  };
  const t = e.table!,
    a = cellKey(t.rows[0], t.columns[0]),
    b = cellKey(t.rows[1], t.columns[0]);
  t.header = true;
  const original = JSON.stringify(e),
    state = cellFormatState(e, [a, b]);
  expect(state.bold).toBeNull();
  expect(state.fill).toBeNull();
  expect(state.fontSize).toBe(24);
  expect(state.color).toBe("#173d38");
  expect(JSON.stringify(e)).toBe(original);
  t.styles = {
    [a]: { bold: false, fill: "#ffffff", fontSize: 24, color: "#173d38" },
  };
  expect(cellFormatState(e, [a, b])).toEqual(effectiveCellStyle(e, b));
  t.styles[b] = { fontSize: 32, textAlign: "right", italic: true };
  expect(cellFormatState(e, [a, b])).toMatchObject({
    fontSize: null,
    textAlign: null,
    italic: null,
    bold: false,
  });
});
