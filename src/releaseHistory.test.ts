import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { APP_VERSION, releaseHistory } from "./releaseHistory";
it("keeps the current package, lockfile and history version aligned and the archive in descending release order", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")),
    lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  expect(pkg.version).toBe(APP_VERSION);
  expect(lock.version).toBe(APP_VERSION);
  expect(lock.packages[""].version).toBe(APP_VERSION);
  const versions = new Set<string>();
  for (const [i, r] of releaseHistory.entries()) {
    expect(r.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(versions.has(r.version)).toBe(false);
    versions.add(r.version);
    expect(r.changes.length).toBeGreaterThan(0);
    expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    if (i) {
      expect(r.date <= releaseHistory[i - 1].date).toBe(true);
      const current = r.version.split(".").map(Number),
        previous = releaseHistory[i - 1].version.split(".").map(Number);
      const different = current.findIndex((part, j) => part !== previous[j]);
      expect(different).toBeGreaterThanOrEqual(0);
      expect(current[different]).toBeLessThan(previous[different]);
    }
  }
  expect(releaseHistory.at(-1)?.version).toBe("0.1.0");
});
