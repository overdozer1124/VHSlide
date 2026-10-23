import { describe, it, expect } from "vitest";
import {
  parseAccountEmails,
  parseRecipients,
  sequentialRecipients,
} from "./preSharing";
import { defaultAccess } from "./permissions";
describe("pre-shared accounts", () => {
  it("keeps clipboard order, understands Workspace-style names and spreadsheet separators and deduplicates case variants", () => {
    expect(
      parseAccountEmails(
        '児童A <First@school.example.jp>, "児童B" <second@school.example.jp>\nFIRST@school.example.jp\tthird@school.example.jp;fourth@school.example.jp',
      ),
    ).toEqual([
      "first@school.example.jp",
      "second@school.example.jp",
      "third@school.example.jp",
      "fourth@school.example.jp",
    ]);
    expect(
      parseAccountEmails("a+one@example.test\na+two@example.test"),
    ).toHaveLength(2);
    for (const invalid of [
      "",
      "a@example.test\ninvalid",
      "a@example.test, @example.test",
    ])
      expect(() => parseAccountEmails(invalid)).toThrow();
  });
  it("assigns sequential rows in the selected sheet without changing slide contents and rejects overflow", () => {
    const rows = sequentialRecipients(
      ["a@example.test", "b@example.test"],
      "sheet-two",
      2,
    );
    expect(rows.map((r) => r.access.rows)).toEqual([
      [{ sheetId: "sheet-two", index: 2 }],
      [{ sheetId: "sheet-two", index: 3 }],
    ]);
    expect(() =>
      sequentialRecipients(["a@example.test", "b@example.test"], "main", 99),
    ).toThrow();
    expect(
      sequentialRecipients(["a@example.test"], "main", 99)[0].access.rows[0]
        .index,
    ).toBe(99);
  });
  it("validates the full batch, rejecting self-sharing, duplicate accounts, invalid rights and oversize batches", () => {
    const access = defaultAccess();
    expect(
      parseRecipients(
        { recipients: [{ email: " Kid@school.example.jp ", access }] },
        "teacher@example.test",
      )[0].email,
    ).toBe("kid@school.example.jp");
    for (const recipients of [
      [{ email: "TEACHER@example.test", access }],
      [
        { email: "a@example.test", access },
        { email: "A@example.test", access },
      ],
      [{ email: "a@example.test", access: { ...access, mode: "host" } }],
      Array.from({ length: 101 }, (_, i) => ({
        email: `a${i}@example.test`,
        access,
      })),
    ])
      expect(() =>
        parseRecipients({ recipients }, "teacher@example.test"),
      ).toThrow();
  });
});
