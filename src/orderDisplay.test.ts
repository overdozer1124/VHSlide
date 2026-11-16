import { describe, it, expect } from "vitest";
import { shuffledOrder } from "./SlideWorksheet";

describe("order field pool display", () => {
  it("never reproduces the listed order when shuffled", () => {
    const ids = [
      "field-1",
      "abc",
      "order-field-xyz",
      "f",
      "12345678-1234-1234-1234-123456789012",
      "並べ替え",
    ];
    for (const id of ids) {
      for (let count = 2; count <= 10; count++) {
        const order = shuffledOrder(id, count);
        expect(order).toHaveLength(count);
        expect([...order].sort((a, b) => a - b)).toEqual(
          Array.from({ length: count }, (_, i) => i),
        );
        expect(order.every((v, i) => v === i)).toBe(false);
      }
    }
  });
  it("is deterministic for the same field", () => {
    expect(shuffledOrder("field-1", 6)).toEqual(shuffledOrder("field-1", 6));
    expect(shuffledOrder("field-2", 6)).toEqual(shuffledOrder("field-2", 6));
  });
});
