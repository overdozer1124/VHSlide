/** Local Chromium substitute, not a Chromebook measurement. No production network. */
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { harness } from "../cloudflare/harness.ts";

const output =
  process.env.AUDIT_OUTPUT || "/tmp/vhslide-backup-browser-audit.json";
const storage = await mkdtemp(join(tmpdir(), "vhslide-backup-browser-audit-"));
const fixture = await harness(storage, "http://127.0.0.1:3187", 3187);
const mf = fixture.start();
const built = await build({
  stdin: {
    contents: `export { createBackupArchive, readBackupArchive } from './src/backupArchive'; export { restoreFullBackup, downloadFullBackup, cancelRestoreTask } from './src/backupClient'; export { backupSnapshot } from './src/backupData'; export { sample, blank } from './src/model';`,
    resolveDir: resolve("."),
  },
  bundle: true,
  format: "iife",
  globalName: "BackupAudit",
  write: false,
  platform: "browser",
});
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--enable-precise-memory-info"],
});
const results: any = {
  kind: "local Chromium substitute; not ChromeOS",
  node: process.version,
  chromium: browser.version(),
  cpuThrottle: 4,
  date: new Date().toISOString(),
  measurements: [],
  failures: [],
};
try {
  await mf.ready;
  const page = await browser.newPage({
    baseURL: "http://127.0.0.1:3187",
    viewport: { width: 1366, height: 768 },
  });
  await page.route("https://**", (route) => route.abort());
  await page.route("http://127.0.0.1:3187/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Local backup audit</title><body>Isolated backup audit</body>",
    }),
  );
  await page.goto("http://127.0.0.1:3187/");
  await page.addScriptTag({ content: built.outputFiles[0].text });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("HeapProfiler.enable");
  async function login(name: string) {
    const credential = await fixture.sign(name);
    await page.evaluate(async (credential) => {
      const r = await fetch("/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential }),
      });
      if (!r.ok) throw new Error(await r.text());
    }, credential);
  }
  async function measure(label: string, action: string, arg?: any) {
    await cdp.send("HeapProfiler.collectGarbage");
    const before = await cdp.send("Runtime.getHeapUsage");
    let peakJS = before.usedSize,
      peakBacking = before.backingStorageSize || 0;
    const poll = setInterval(() => {
      void cdp
        .send("Runtime.getHeapUsage")
        .then((m) => {
          peakJS = Math.max(peakJS, m.usedSize);
          peakBacking = Math.max(peakBacking, m.backingStorageSize || 0);
        })
        .catch(() => {});
    }, 50);
    try {
      const value = await page.evaluate(
        async ({ action, arg }) => {
          const w = window as any;
          let last = performance.now(),
            maxGap = 0,
            ticks = 0;
          const timer = setInterval(() => {
            const now = performance.now();
            maxGap = Math.max(maxGap, now - last);
            last = now;
            ticks++;
          }, 16);
          const start = performance.now();
          let result: any, error: string | undefined;
          try {
            result = await w.runAuditAction(action, arg);
          } catch (e) {
            error = String(e);
          }
          const ms = performance.now() - start;
          await new Promise((r) => setTimeout(r, 50));
          clearInterval(timer);
          return { ms, maxTimerGapMs: maxGap, ticks, result, error };
        },
        { action, arg },
      );
      const after = await cdp.send("Runtime.getHeapUsage");
      const row = {
        label,
        ...value,
        before,
        after,
        sampledPeakJSBytes: Math.max(peakJS, after.usedSize),
        sampledPeakBackingBytes: Math.max(
          peakBacking,
          after.backingStorageSize || 0,
        ),
      };
      results.measurements.push(row);
      console.log(JSON.stringify(row));
      return row;
    } finally {
      clearInterval(poll);
    }
  }
  await page.evaluate(() => {
    const w = window as any,
      a = w.BackupAudit;
    const req = async (p: string, method = "GET", value?: any) => {
      const r = await fetch(p, {
        method,
        ...(value === undefined
          ? {}
          : {
              body: value instanceof Uint8Array ? value : JSON.stringify(value),
            }),
      });
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      return await r.json();
    };
    w.runAuditAction = async (action: string, arg: any) => {
      if (action === "prepare") {
        w.archive = null;
        w.loaded = null;
        w.inputImages = null;
        w.snapshot = null;
        // Real PNG bytes from deterministic noisy canvas; unique references, same photo bytes.
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 768;
        const ctx = canvas.getContext("2d")!,
          pixels = ctx.createImageData(768, 768);
        let seed = 42;
        for (let i = 0; i < pixels.data.length; i += 4) {
          for (let c = 0; c < 3; c++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            pixels.data[i + c] = seed >>> 24;
          }
          pixels.data[i + 3] = 255;
        }
        ctx.putImageData(pixels, 0, 0);
        const blob = await new Promise<Blob>((r) =>
          canvas.toBlob((b) => r(b!), "image/png"),
        );
        const photo = new Uint8Array(await blob.arrayBuffer());
        const count = Math.max(1, Math.floor((arg.mb * 1e6) / photo.length));
        const deck = a.sample();
        deck.title = `audit-${arg.mb}MB`;
        deck.slides = [a.blank(0, 0)];
        const stage = await req("/api/restores", "POST", { title: deck.title });
        w.sourceId = stage.id;
        w.inputImages = new Map();
        for (let i = 0; i < count; i++) {
          let src = `/api/decks/${stage.id}/assets/${crypto.randomUUID()}`;
          if (arg.server)
            src = (await req(`/api/decks/${stage.id}/assets`, "POST", photo))
              .src;
          if (deck.slides[deck.slides.length - 1].elements.length >= 100)
            deck.slides.push(a.blank(deck.slides.length, 0));
          deck.slides[deck.slides.length - 1].elements.push({
            id: crypto.randomUUID(),
            type: "image",
            x: 0,
            y: 0,
            w: 100,
            h: 100,
            src,
          });
          w.inputImages.set(src, photo.slice());
        }
        w.snapshot = a.backupSnapshot(deck, [], [], []);
        if (arg.server) {
          await req(`/api/decks/${stage.id}/restore`, "POST", {
            snapshot: w.snapshot,
            applySharing: false,
          });
          w.snapshot = await req(`/api/decks/${stage.id}/backup`);
          w.original = JSON.stringify(w.snapshot.deck);
        } else await req(`/api/decks/${stage.id}/restore`, "DELETE");
        return {
          imageCount: count,
          imageBytes: photo.length,
          totalImageBytes: photo.length * count,
          serverSource: arg.server,
        };
      }
      if (action === "zip") {
        w.archive = await a.createBackupArchive(
          w.snapshot,
          async (src: string) => {
            if (!arg.server) return w.inputImages.get(src);
            const r = await fetch(src);
            if (!r.ok) throw new Error(`photo ${r.status}`);
            return new Uint8Array(await r.arrayBuffer());
          },
        );
        return { bytes: w.archive.length };
      }
      if (action === "read") {
        w.loaded = await a.readBackupArchive(w.archive);
        return { images: w.loaded.images.size, bytes: w.loaded.size };
      }
      if (action === "restore") {
        return {
          id: await a.restoreFullBackup(
            w.loaded,
            false,
            () => {},
            new AbortController().signal,
          ),
        };
      }
      if (action === "verify") {
        const b = await req(`/api/decks/${w.sourceId}/backup`),
          list = await req("/api/decks");
        return {
          sourceUnchanged: JSON.stringify(b.deck) === w.original,
          staging: list.decks.filter((d: any) => d.status === "restoring")
            .length,
          works: list.decks.length,
        };
      }
      if (action === "retry") {
        return await a.restoreFullBackup(
          w.loaded,
          false,
          () => {},
          new AbortController().signal,
        );
      }
      if (action === "corrupt") {
        const old = w.archive.slice();
        old[Math.floor(old.length / 2)] ^= 1;
        try {
          await a.readBackupArchive(old);
          throw new Error("CORRUPT_ACCEPTED");
        } catch (e) {
          if (String(e).includes("CORRUPT_ACCEPTED")) throw e;
          return { rejected: true };
        }
      }
    };
  });
  for (const mb of (process.env.AUDIT_SIZES || "5,20,45,120,280")
    .split(",")
    .filter(Boolean)
    .map(Number)) {
    const server = mb <= 45;
    await login(`perf-${mb}`);
    const prepared = await measure(`${mb}MB prepare`, "prepare", {
      mb,
      server,
    });
    if (prepared.error) {
      results.failures.push(prepared);
      continue;
    }
    await measure(`${mb}MB zip`, "zip", { server });
    await measure(`${mb}MB read`, "read");
    await measure(`${mb}MB corrupt`, "corrupt");
    if (server) {
      await measure(`${mb}MB restore`, "restore");
      const verified = await measure(`${mb}MB verify`, "verify");
      assert.equal(verified.result?.sourceUnchanged, true);
      const restore = results.measurements.find(
        (m: any) => m.label === `${mb}MB restore`,
      );
      assert.equal(verified.result?.staging, restore?.error ? 1 : 0);
    }
  }
  // Use the actual browser client. Lose a successful commit response once.
  await login("lost-response-client");
  await measure("B client prepare", "prepare", { mb: 1, server: true });
  await measure("B client zip", "zip", { server: true });
  await measure("B client read", "read");
  let lost = false;
  await page.route("**/api/decks/*/restore", async (route) => {
    if (route.request().method() === "POST" && !lost) {
      lost = true;
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await route.abort("connectionreset");
    } else await route.continue();
  });
  const recovered = await measure("B client lost response", "restore");
  assert.ok(recovered.result?.id);
  assert.equal(recovered.error, undefined);
  const first = await measure("B client after lost response", "verify");
  assert.equal(first.result.works, 2);
  const repeated = await measure("B client retry", "retry");
  assert.ok(repeated.result);
  const second = await measure("B client after retry", "verify");
  assert.equal(second.result.works, 2);
  assert.equal(repeated.result, recovered.result.id);
  // Update notes and sharing after metadata capture, while a photo is being read.
  const sourceId = await page.evaluate(() => (window as any).sourceId);
  const beforeImages = await (
    await page.request.get(`/api/decks/${sourceId}/backup`)
  ).json();
  let changedDuringImages = false;
  await page.route(`**/api/decks/${sourceId}/assets/*`, async (route) => {
    if (!changedDuringImages) {
      changedDuringImages = true;
      const note = await page.request.post(`/api/decks/${sourceId}/comments`, {
        headers: { Origin: "http://127.0.0.1:3187" },
        data: {
          slide: beforeImages.deck.slides[0].id,
          text: "写真取得中の付箋",
          x: 0.2,
          y: 0.3,
        },
      });
      assert.equal(note.status(), 200);
      const share = await page.request.post(
        `/api/decks/${sourceId}/recipients`,
        {
          headers: { Origin: "http://127.0.0.1:3187" },
          data: {
            recipients: [
              {
                email: "during-images@example.test",
                access: {
                  mode: "none",
                  comment: true,
                  rows: [],
                  columns: [],
                  slides: [],
                },
              },
            ],
          },
        },
      );
      assert.equal(share.status(), 200);
    }
    await route.continue();
  });
  let downloads = 0;
  page.on("download", () => downloads++);
  const refused = await page.evaluate(async (id) => {
    try {
      await (window as any).BackupAudit.downloadFullBackup(id, () => {});
      return "UNEXPECTED_SUCCESS";
    } catch (e) {
      return (e as Error).message;
    }
  }, sourceId);
  assert.match(refused, /変更/);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(downloads, 0);
  const afterImages = await (
    await page.request.get(`/api/decks/${sourceId}/backup`)
  ).json();
  assert.equal(afterImages.comments.length, 1);
  assert.equal(afterImages.sharing.length, 1);
  results.imageFetchRace = {
    zipDelivered: false,
    error: refused,
    changedDuringImages,
    downloads,
    serverComments: afterImages.comments.length,

    serverSharing: afterImages.sharing.length,
  };
  const cancelledId = await page.evaluate(async () => {
    const r = await fetch("/api/restores", {
      method: "POST",
      body: JSON.stringify({ title: "取り消し応答の試験" }),
    });
    if (!r.ok) throw new Error(await r.text());
    return (await r.json()).id;
  });
  await page.route(`**/api/decks/${cancelledId}/restore`, async (route) => {
    if (route.request().method() === "DELETE") {
      const r = await route.fetch();
      assert.equal(r.status(), 200);
      await route.abort("connectionreset");
    } else await route.continue();
  });
  await page.evaluate(async (id) => {
    await (window as any).BackupAudit.cancelRestoreTask(id);
  }, cancelledId);
  const cancelled = await (
    await page.request.get(`/api/restores/${cancelledId}`)
  ).json();
  assert.equal(cancelled.status, "cancelled");
  results.cancellationResponseLossRecovered = true;
  results.clientResponseLoss = {
    preservedCompletedWork: true,
    automaticStatusRecovery: true,
    newWorkOnUserRetry: false,
  };
} finally {
  await writeFile(output, JSON.stringify(results, null, 2));
  await browser.close();
  await mf.dispose();
  await rm(storage, { recursive: true, force: true });
}
console.log(`Evidence: ${output}`);
