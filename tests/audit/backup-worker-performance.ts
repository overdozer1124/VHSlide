/** Local Chromium, synthetic stored image bytes; never connects to production. */
import { chromium } from "@playwright/test";
import { build, createServer } from "vite";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const directory = "docs/audit-evidence/backup-worker-2026-10-24";
await mkdir(directory, { recursive: true });
const id = "11111111-1111-4111-8111-111111111111";
let targetBytes = 5_000_000;
await build({
  configFile: false,
  build: {
    outDir: "/tmp/vhslide-perf-bundle",
    emptyOutDir: true,
    rollupOptions: {
      preserveEntrySignatures: "strict",
      input: "tests/audit/worker-entry.ts",
      output: { entryFileNames: "entry.js" },
    },
  },
});
const vite = await createServer({
  configFile: false,
  server: { host: "127.0.0.1", port: 3191, strictPort: true },
  plugins: [
    {
      name: "backup-audit-fixture",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === "/entry.js" || req.url?.startsWith("/assets/")) {
            if (!/^\/(entry\.js|assets\/[a-zA-Z0-9_.-]+\.js)$/.test(req.url!)) {
              res.statusCode = 404;
              res.end();
              return;
            }
            void readFile(`/tmp/vhslide-perf-bundle${req.url}`).then(
              (bytes) => {
                res.setHeader("Content-Type", "text/javascript");
                res.end(bytes);
              },
            );
            return;
          }
          if (req.url === "/__backup_audit") {
            res.setHeader("Content-Type", "text/html");
            res.end(
              '<button id="probe" onclick="this.dataset.clicks=Number(this.dataset.clicks||0)+1">応答確認</button>',
            );
            return;
          }
          if (req.url?.startsWith(`/api/decks/${id}/assets/`)) {
            const index = Number(req.url.split("/").pop()!.slice(0, 8));
            const bytes = Buffer.alloc(
              Math.min(5_000_000, targetBytes - index * 5_000_000),
              73,
            );
            res.setHeader("Content-Type", "application/octet-stream");
            res.end(bytes);
            return;
          }
          next();
        });
      },
    },
  ],
});
await vite.listen();
async function rss(root: number) {
  const entries = await readdir("/proc");
  const rows = (
    await Promise.all(
      entries
        .filter((n) => /^\d+$/.test(n))
        .map(async (n) => {
          try {
            const s = await readFile(`/proc/${n}/status`, "utf8");
            return {
              pid: Number(n),
              ppid: Number(s.match(/^PPid:\s+(\d+)/m)![1]),
              kb: Number(s.match(/^VmRSS:\s+(\d+)/m)?.[1] || 0),
            };
          } catch {
            return null;
          }
        }),
    )
  ).filter((x) => x !== null);
  const children = new Set([root]);
  for (let i = 0; i < 8; i++)
    for (const row of rows) if (children.has(row.ppid)) children.add(row.pid);
  return rows
    .filter((r) => children.has(r.pid))
    .reduce((n, r) => n + r.kb * 1024, 0);
}
const results: any = {
  date: new Date().toISOString(),
  environment:
    "Linux headless Chromium; CPU throttle 1; not a physical Chromebook",
  memory:
    "50 ms sampled sum of browser process-tree VmRSS, includes workers; shared pages counted per process; not exclusive physical memory",
  measurements: [],
  checks: [],
};
try {
  for (const mb of (process.env.AUDIT_SIZES || "5,20,50,100,280")
    .split(",")
    .map(Number))
    for (const mode of ["baseline", "worker"]) {
      targetBytes = mb * 1_000_000;
      const server = await chromium.launchServer({
        executablePath: "/usr/bin/chromium",
        args: ["--no-sandbox", "--enable-precise-memory-info"],
      });
      const browser = await chromium.connect(server.wsEndpoint());
      results.chromium = browser.version();
      const page = await browser.newPage({
        viewport: { width: 1366, height: 768 },
      });
      await page.route("https://**", (r) => r.abort());
      await page.goto("http://127.0.0.1:3191/__backup_audit");
      await page.evaluate(
        async ({ id, mb }) => {
          const w = window as any;
          const { blank, backupSnapshot, baseline, workerAPI } = await import(
            "/entry.js" as string
          );
          w.baseline = baseline;
          w.workerAPI = workerAPI;
          w.snapshot = backupSnapshot(
            {
              version: 1,
              title: "Performance fixture",
              slides: [
                {
                  ...blank(0, 0),
                  elements: Array.from(
                    { length: Math.ceil(mb / 5) },
                    (_, i) => ({
                      id: `i-${i}`,
                      type: "image",
                      x: 0,
                      y: 0,
                      w: 100,
                      h: 100,
                      src: `/api/decks/${id}/assets/${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`,
                    }),
                  ),
                },
              ],
            },
            [],
            [],
            [],
          );
        },
        { id, mb },
      );
      const cdp = await page.context().newCDPSession(page);
      for (const action of ["create", "read"]) {
        await cdp.send("HeapProfiler.collectGarbage");
        const before = await rss(server.process().pid!);
        let peak = before;
        let sampling = false;
        const timer = setInterval(() => {
          if (!sampling) {
            sampling = true;
            void rss(server.process().pid!)
              .then((v) => {
                peak = Math.max(peak, v);
              })
              .finally(() => {
                sampling = false;
              });
          }
        }, 50);
        const value = await page.evaluate(
          async ({ mode, action, id }) => {
            const w = window as any;
            let last = performance.now(),
              gap = 0,
              ticks = 0;
            const timer = setInterval(() => {
              const now = performance.now();
              gap = Math.max(gap, now - last);
              last = now;
              ticks++;
              document.getElementById("probe")!.click();
            }, 16);
            const start = performance.now();
            if (action === "create") {
              w.blob =
                mode === "worker"
                  ? await w.workerAPI.createBackupInWorker(w.snapshot, id)
                  : new Blob([
                      (
                        await w.baseline.createBackupArchive(
                          w.snapshot,
                          async (src: string) =>
                            new Uint8Array(
                              await (await fetch(src)).arrayBuffer(),
                            ),
                        )
                      ).slice().buffer,
                    ]);
            } else {
              const file = new File([w.blob], "fixture.vhslide.zip");
              const loaded =
                mode === "worker"
                  ? await w.workerAPI.readBackupInWorker(file)
                  : await w.baseline.readBackupArchive(
                      new Uint8Array(await file.arrayBuffer()),
                    );
              if (
                loaded.images.size !== w.snapshot.deck.slides[0].elements.length
              )
                throw Error("image mismatch");
            }
            const ms = performance.now() - start;
            await new Promise((r) => setTimeout(r, 50));
            clearInterval(timer);
            return {
              ms,
              maxTimerGapMs: gap,
              probeClicks: ticks,
              zipBytes: w.blob.size,
              completed: true,
            };
          },
          { mode, action, id },
        );
        clearInterval(timer);
        peak = Math.max(peak, await rss(server.process().pid!));
        const row = {
          mb,
          mode,
          action,
          ...value,
          rssBeforeBytes: before,
          rssPeakBytes: peak,
        };
        results.measurements.push(row);
        console.log(JSON.stringify(row));
      }
      if (mb === 20 && mode === "worker") {
        const checks = await page.evaluate(
          async ({ id }) => {
            const w = window as any;
            const errors: string[] = [];
            const bad = new Uint8Array(await w.blob.arrayBuffer());
            bad[100] ^= 1;
            try {
              await w.workerAPI.readBackupInWorker(new Blob([bad]));
            } catch (e) {
              errors.push(String(e));
            }
            const cancelRead = new AbortController(),
              cancelCreate = new AbortController();
            const read = w.workerAPI
              .readBackupInWorker(w.blob, cancelRead.signal, () =>
                setTimeout(() => cancelRead.abort(), 0),
              )
              .then(
                () => false,
                (e: Error) => e.name === "AbortError",
              );
            const create = w.workerAPI
              .createBackupInWorker(
                w.snapshot,
                id,
                () => setTimeout(() => cancelCreate.abort(), 0),
                cancelCreate.signal,
              )
              .then(
                () => false,
                (e: Error) => e.name === "AbortError",
              );

            const cancelled = await Promise.all([read, create]);
            const valid = await w.workerAPI.readBackupInWorker(w.blob);
            return {
              corruptionRejected: errors.length === 1,
              cancelled,
              recovered: valid.images.size === 4,
            };
          },
          { id },
        );
        assert.equal(checks.corruptionRejected, true);
        assert.deepEqual(checks.cancelled, [true, true]);
        assert.equal(checks.recovered, true);
        results.checks.push(checks);
      }
      await browser.close();
      await server.close();
      await writeFile(
        process.env.AUDIT_OUTPUT || `${directory}/performance.json`,
        JSON.stringify(results, null, 2),
      );
    }
} finally {
  await vite.close();
}
