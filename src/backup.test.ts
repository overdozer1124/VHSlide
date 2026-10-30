import { expect, it } from "vitest";
import { zipSync, unzipSync, strToU8 } from "fflate";
import {
  backupSnapshot,
  parseBackupSnapshot,
  restoredComments,
} from "./backupData";
import {
  createBackupArchive,
  createBackupBlob,
  readBackupArchive,
} from "./backupArchive";
import { blank } from "./model";
import { defaultAccess } from "./permissions";
const source = (i = 0) =>
  `/api/decks/11111111-1111-4111-8111-111111111111/assets/${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`;
const image = (i = 0) => ({
  id: `image-${i}`,
  type: "image" as const,
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  src: source(i),
});
function snapshot(images = 1) {
  const deck = {
    version: 1 as const,
    title: "作品",
    sheets: [
      {
        id: "main",
        name: "比較",
        rowIds: { "0": "1", "1": "0" },
        rowLabels: { "0": "B班" },
      },
    ],
    slides: [
      {
        ...blank(0, 0),
        footerLabel: "担当",
        elements: Array.from({ length: images }, (_, i) => image(i)),
      },
    ],
  };
  return backupSnapshot(
    deck,
    [
      {
        id: "note",
        slide: deck.slides[0].id,
        author: "old-user",
        name: "元の投稿者",
        text: "感想",
        x: 0.3,
        y: 0.4,
        color: "#aaddff",
        w: 0.3,
        h: 0.4,
        created: 1234,
      },
    ],
    [],
    [
      {
        email: "A@school.example",
        name: "A",
        access: {
          ...defaultAccess(),
          mode: "scoped",
          rows: [{ sheetId: "main", index: 1, axisId: "0" }],
        },
      },
    ],
  );
}
it("round trips images, stable axes, comments and sharing without credentials or account IDs", async () => {
  const s = snapshot(),
    bytes = await createBackupArchive(s, async () => new Uint8Array([1, 2, 3]));
  const loaded = await readBackupArchive(bytes);
  expect(loaded.snapshot).toEqual(s);
  expect([...loaded.images.get(source())!]).toEqual([1, 2, 3]);
  const clean = parseBackupSnapshot({
    ...s,
    session: "secret",
    token: "secret",
    comments: [{ ...s.comments[0], author: "attacker", id: "arbitrary" }],
    sharing: [{ ...s.sharing[0], userId: "attacker" }],
  });
  expect(JSON.stringify(clean)).not.toContain("secret");
  expect(JSON.stringify(clean)).not.toContain("attacker");
  const c = restoredComments(clean.comments, "new-host")[0];
  expect(c.author).toBe("new-host");
  expect(c.name).toBe("元の投稿者（復元）");
  expect(c.created).toBe(1234);
  expect(c.color).toBe("#aaddff");
  expect(c.id).not.toBe("arbitrary");
});
it("backs up over 25MB of photos without base64 embedding", async () => {
  const s = snapshot(6),
    photo = new Uint8Array(4_500_000);
  const bytes = await createBackupArchive(s, async () => photo);
  expect(bytes.length).toBeGreaterThan(25_000_000);
  const result = await readBackupArchive(bytes);
  expect(result.images.size).toBe(6);
  expect(result.snapshot.deck.slides[0].elements[0].src).toBe(source());
});
it("rejects corrupted photos, missing images, unexpected paths and compressed archives", async () => {
  const bytes = await createBackupArchive(
    snapshot(),
    async () => new Uint8Array([1, 2, 3]),
  );
  const original = unzipSync(bytes);
  const corrupt = { ...original, "images/0.bin": new Uint8Array([2, 3, 4]) };
  await expect(
    readBackupArchive(zipSync(corrupt, { level: 0 })),
  ).rejects.toThrow("破損");
  const missing = { ...original };
  delete missing["images/0.bin"];
  await expect(
    readBackupArchive(zipSync(missing, { level: 0 })),
  ).rejects.toThrow();
  await expect(
    readBackupArchive(
      zipSync({ ...original, "../outside": new Uint8Array([1]) }, { level: 0 }),
    ),
  ).rejects.toThrow("ファイル名");
  await expect(
    readBackupArchive(zipSync(original, { level: 6 })),
  ).rejects.toThrow();
});
it("rejects duplicate manifest entries, mismatched STORE sizes, unsupported versions and excessive values", async () => {
  const bytes = await createBackupArchive(
    snapshot(),
    async () => new Uint8Array([1, 2, 3]),
  );
  const files = unzipSync(bytes),
    manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
  manifest.files[1] = manifest.files[0];
  files["manifest.json"] = strToU8(JSON.stringify(manifest));
  await expect(
    readBackupArchive(zipSync(files, { level: 0 })),
  ).rejects.toThrow();
  const bad = bytes.slice(),
    view = new DataView(bad.buffer);
  for (let i = 0; i < bad.length - 46; i++)
    if (view.getUint32(i, true) === 0x02014b50) {
      view.setUint32(i + 24, 1, true);
      break;
    }
  await expect(readBackupArchive(bad)).rejects.toThrow();
  expect(() => parseBackupSnapshot({ ...snapshot(), version: 2 })).toThrow();
  expect(() =>
    parseBackupSnapshot({
      ...snapshot(),
      comments: Array(2001).fill(snapshot().comments[0]),
    }),
  ).toThrow();
  expect(() =>
    parseBackupSnapshot({
      ...snapshot(),
      sharing: [
        {
          email: "x@school.example",
          access: { ...defaultAccess(), mode: "owner" },
        },
      ],
    }),
  ).toThrow();
});

it("streamed STORE Blobs stay compatible with ZIP version 1 and verified image hashes", async () => {
  const s = snapshot(2);
  const blob = await createBackupBlob(s, async () => new Uint8Array([1, 2, 3]));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const loaded = await readBackupArchive(bytes);
  const legacy = await import("../tests/audit/fixtures/backupArchive-0371");
  expect((await legacy.readBackupArchive(bytes)).snapshot).toEqual(s);
  expect(loaded.snapshot).toEqual(s);
  expect(loaded.images.size).toBe(2);
  expect(loaded.imageHashes?.size).toBe(2);
  const files = unzipSync(bytes);
  expect(
    JSON.parse(new TextDecoder().decode(files["manifest.json"])).version,
  ).toBe(1);
});
