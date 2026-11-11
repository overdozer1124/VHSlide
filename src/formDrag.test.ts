import { describe, expect, it } from "vitest";
import { additiveSelectionIntent } from "./formDrag";

describe("additiveSelectionIntent", () => {
  it("treats a plain click as an answering gesture, not selection", () => {
    expect(additiveSelectionIntent({}, false)).toBe(false);
    expect(
      additiveSelectionIntent(
        { shiftKey: false, ctrlKey: false, metaKey: false },
        false,
      ),
    ).toBe(false);
  });

  it("treats modifier clicks as additive selection even on form parts", () => {
    expect(additiveSelectionIntent({ shiftKey: true }, false)).toBe(true);
    expect(additiveSelectionIntent({ ctrlKey: true }, false)).toBe(true);
    expect(additiveSelectionIntent({ metaKey: true }, false)).toBe(true);
  });

  it("treats every tap as additive selection in multi-select mode", () => {
    expect(additiveSelectionIntent({}, true)).toBe(true);
    expect(additiveSelectionIntent({ shiftKey: false }, true)).toBe(true);
  });
});
