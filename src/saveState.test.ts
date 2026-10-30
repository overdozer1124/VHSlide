import { it, expect } from "vitest";
import { describeSaveState, type CloudSaveSnapshot } from "./saveState";
const base: CloudSaveSnapshot = {
  document: "saved",
  notesSaving: 0,
  notesFailed: 0,
  notesDirty: 0,
};
it("only reports saved when both document and notes are saved", () => {
  expect(describeSaveState(base).label).toBe("クラウドに保存済み");
  expect(describeSaveState({ ...base, notesDirty: 1 }).severity).toBe(
    "pending",
  );
  expect(describeSaveState({ ...base, notesSaving: 2 }).label).toContain(
    "付箋を保存中",
  );
});
it("keeps document saved separate from note failure and prioritizes recovery and stopped state", () => {
  expect(describeSaveState({ ...base, notesFailed: 1 }).label).toBe(
    "本文は保存済み・付箋1件を再試行",
  );
  for (const document of ["stopped", "recovery"] as const) {
    const value = describeSaveState({ ...base, document, notesFailed: 2 });
    expect(value.severity).toBe("error");
    expect(value.label).toContain("復旧");
    expect(value.label).toContain("付箋2件");
  }
  expect(
    describeSaveState({ ...base, document: "reconnecting" }).severity,
  ).toBe("pending");
});
