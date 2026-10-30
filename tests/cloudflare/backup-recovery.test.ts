import { COLLABORATION_PROTOCOL } from "../../src/collaborationProtocol.ts";
/** Faults exist only in a temporary copy of the dry-run bundle. Never deployed. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { harness } from "./harness.ts";
import { sample } from "../../src/model.ts";
import { backupSnapshot } from "../../src/backupData.ts";
import {
  applyDeckChange,
  readSharedDeck,
  toBase64,
} from "../../src/sharedDeck.ts";
import * as Y from "yjs";

const origin = "http://recovery.test";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);
const all = { mode: "all", comment: true, rows: [], columns: [], slides: [] };
function gate() {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((r) => (enter = r)),
    released = new Promise<void>((r) => (release = r));
  return {
    entered,
    release,
    wait: async () => {
      enter();
      await released;
    },
  };
}
function inject(source: string) {
  const restore =
    "        this.ctx.storage.transactionSync(() => {\n          if (applySharing)";
  const captured =
    "      const data = await response.json();\n      const latest";
  const beforeCapture =
    "      const recipients = this.recipientList(id2), members = people();\n";
  const roomResponse =
    '      return json({ ok: true });\n    }\n    if (path === "/delete" && request.method === "POST")';
  const purged =
    '      await checked(await room(this.env, id2).fetch(internal("/delete", {})));\n';
  for (const marker of [restore, captured, beforeCapture, roomResponse, purged])
    assert.equal(
      source.split(marker).length,
      2,
      "Injection anchor changed; review the bundle instead of silently skipping",
    );
  return source
    .replace(
      purged,
      purged +
        '      if (!(await this.env.RECOVERY_AUDIT.fetch("http://audit/after-purge/" + id2)).ok) throw new Error("AUDIT_PURGE_INTERRUPTED");\n',
    )
    .replace(
      roomResponse,
      '      if (!(await this.env.RECOVERY_AUDIT.fetch("http://audit/room-response/" + this.id())).ok) throw new Error("AUDIT_ROOM_RESPONSE_LOST");\n' +
        roomResponse,
    )
    .replace(
      beforeCapture,
      beforeCapture +
        '      await this.env.RECOVERY_AUDIT.fetch("http://audit/before-capture/" + id2);\n',
    )
    .replace(
      restore,
      '          if (!(await this.env.RECOVERY_AUDIT.fetch("http://audit/after-room/" + id2)).ok) throw new Error("AUDIT_DIRECTORY_COMMIT_FAILED");\n' +
        restore,
    )
    .replace(
      captured,
      '      const data = await response.json();\n      await this.env.RECOVERY_AUDIT.fetch("http://audit/after-capture/" + id2);\n      const latest',
    );
}

test(
  "isolated recovery faults: publication, replay, cancellation, lost response and capture races",
  { timeout: 120_000 },
  async (t) => {
    const temp = await mkdtemp(join(tmpdir(), "vhslide-recovery-audit-"));
    const scriptPath = join(temp, "instrumented.mjs");
    await writeFile(
      scriptPath,
      inject(await readFile(".wrangler-build/index.js", "utf8")),
    );
    const fixture = await harness(join(temp, "db"), origin);
    let hook: (path: string) => Promise<Response> = async () =>
      new Response("ok");
    let mf = fixture.start({
      scriptPath,
      hook: (r) => hook(new URL(r.url).pathname),
    });
    const request = (
      path: string,
      method = "GET",
      value?: unknown,
      cookie = owner,
    ) =>
      mf.dispatchFetch(origin + path, {
        method,
        headers: { Origin: origin, Cookie: cookie },
        ...(value === undefined
          ? {}
          : {
              body: value instanceof Uint8Array ? value : JSON.stringify(value),
            }),
      });
    let owner = "",
      guest = "";
    async function login(id: string) {
      const r = await request(
        "/api/auth/google",
        "POST",
        { credential: await fixture.sign(id) },
        "",
      );
      assert.equal(r.status, 200);
      return r.headers.get("set-cookie")!.split(";")[0];
    }
    async function data(path: string, cookie = owner) {
      const r = await request(path, "GET", undefined, cookie);
      assert.equal(r.status, 200, await r.clone().text());
      return (await r.json()) as any;
    }
    const stage = async () => {
      const r = await request("/api/restores", "POST", {
        title: "recovery-audit",
      });
      assert.equal(r.status, 201, await r.clone().text());
      const { id } = (await r.json()) as any;
      const uploaded = await request(`/api/decks/${id}/assets`, "POST", png);
      assert.equal(uploaded.status, 201);
      const { src } = (await uploaded.json()) as any;
      const deck = sample();
      deck.title = "recovery-audit";
      deck.slides[0].elements.push({
        id: "photo",
        type: "image",
        x: 0,
        y: 0,
        w: 100,
        h: 100,
        src,
      });
      const snapshot = backupSnapshot(
        deck,
        [
          {
            id: "old-note",
            slide: deck.slides[0].id,
            author: "old",
            name: "元の作者",
            text: "復元する付箋",
            x: 0.2,
            y: 0.3,
            created: 1,
          },
        ],
        [],
        [{ email: "friend@example.test", access: all }],
      );
      return { id, src, snapshot, body: { snapshot, applySharing: true } };
    };
    const assertComplete = async (s: Awaited<ReturnType<typeof stage>>) => {
      const b = await data(`/api/decks/${s.id}/backup`);
      assert.equal(b.comments.length, 1);
      assert.equal(b.sharing.length, 1);
      assert.equal(
        b.deck.slides
          .flatMap((s: any) => s.elements)
          .filter((e: any) => e.type === "image").length,
        1,
      );
      const a = await request(s.src);
      assert.deepEqual(Buffer.from(await a.arrayBuffer()), png);
      assert.equal(
        (await data(`/api/decks/${s.id}/recipients`)).recipients.length,
        1,
      );
    };
    try {
      owner = await login("owner");
      guest = await login("friend");
      await t.test(
        "permanent deletion interrupted after Room cleanup remains non-restorable and retries after restart",
        async () => {
          const s = await stage();
          assert.equal(
            (await request(`/api/decks/${s.id}/restore`, "POST", s.body))
              .status,
            200,
          );
          assert.equal(
            (await request(`/api/decks/${s.id}/trash`, "POST")).status,
            200,
          );
          hook = async (p) =>
            new Response("injected", {
              status: p === `/after-purge/${s.id}` ? 503 : 200,
            });
          assert.equal(
            (await request(`/api/decks/${s.id}`, "DELETE")).status,
            503,
          );
          assert.equal(
            (await request(`/api/decks/${s.id}/untrash`, "POST")).status,
            409,
          );
          assert.equal((await request(s.src)).status, 404);
          await mf.dispose();
          mf = fixture.start({
            scriptPath,
            hook: (r) => hook(new URL(r.url).pathname),
          });
          assert.equal(
            (await request(`/api/decks/${s.id}/untrash`, "POST")).status,
            409,
          );
          assert.equal(
            (await data("/api/trash")).decks.find((d: any) => d.id === s.id)
              .purging,
            1,
          );
          hook = async () => new Response("ok");
          assert.equal(
            (await request(`/api/decks/${s.id}`, "DELETE")).status,
            200,
          );
          assert.equal((await request(`/api/decks/${s.id}`)).status, 404);
        },
      );
      await t.test(
        "A1: Room committed, Directory failed; private; retry preserves one copy",
        async () => {
          const s = await stage();
          let failed = false;
          hook = async (p) => {
            if (p === `/after-room/${s.id}` && !failed) {
              failed = true;
              return new Response("injected", { status: 503 });
            }
            return new Response("ok");
          };
          assert.equal(
            (await request(`/api/decks/${s.id}/restore`, "POST", s.body))
              .status,
            503,
          );
          // Persisted state must also survive a fresh workerd runtime.
          await mf.dispose();
          mf = fixture.start({
            scriptPath,
            hook: (r) => hook(new URL(r.url).pathname),
          });
          const deniedLive = await mf.dispatchFetch(
            `${origin}/api/decks/${s.id}/live`,
            {
              headers: { Origin: origin, Cookie: guest, Upgrade: "websocket" },
            },
          );
          assert.equal(deniedLive.status, 404);
          assert.equal(
            (await request(s.src, "GET", undefined, guest)).status,
            404,
          );
          const rooms = await mf.getDurableObjectNamespace("ROOMS");
          const room = rooms.get(rooms.idFromName(s.id));
          const captured = (await (
            await room.fetch("http://room/backup")
          ).json()) as any;
          assert.equal(
            captured.comments.length,
            1,
            "Room really committed before the injected fault",
          );
          assert.equal(
            (await request(`/api/decks/${s.id}`, "GET", undefined, guest))
              .status,
            404,
          );
          assert.equal(
            (
              await request(
                `/api/decks/${s.id}/comments`,
                "POST",
                {
                  slide: s.snapshot.deck.slides[0].id,
                  text: "forbidden",
                  x: 0.1,
                  y: 0.1,
                },
                guest,
              )
            ).status,
            404,
          );
          assert.equal(
            (await request(`/api/decks/${s.id}`, "GET", undefined, "")).status,
            401,
          );
          assert.equal(
            (await data("/api/decks")).decks.find((d: any) => d.id === s.id)
              .status,
            "restoring",
          );
          assert.equal(
            (await request(`/api/decks/${s.id}/restore`, "POST", s.body))
              .status,
            200,
          );
          await assertComplete(s);
          const persisted = (await (
            await room.fetch("http://room/backup")
          ).json()) as any;
          assert.deepEqual(
            persisted.comments.map((c: any) => c.id),
            captured.comments.map((c: any) => c.id),
          );
          assert.equal(
            (await request(`/api/decks/${s.id}/restore`, "POST", s.body))
              .status,
            200,
          );
          await assertComplete(s);
        },
      );
      await t.test(
        "A2: queued cancellation cannot remove a finalized work",
        async () => {
          const s = await stage(),
            pause = gate();
          hook = async (p) =>
            new Response("injected", {
              status: p === `/after-room/${s.id}` ? 503 : 200,
            });
          assert.equal(
            (await request(`/api/decks/${s.id}/restore`, "POST", s.body))
              .status,
            503,
          );
          hook = async (p) => {
            if (p === `/after-room/${s.id}`) await pause.wait();
            return new Response("ok");
          };
          const commit = request(`/api/decks/${s.id}/restore`, "POST", s.body);
          await pause.entered;
          const cancel = request(`/api/decks/${s.id}/restore`, "DELETE");
          pause.release();
          assert.equal((await commit).status, 200);
          assert.equal((await cancel).status, 409);
          await assertComplete(s);
        },
      );
      await t.test(
        "A3: cancellation after partial commit removes staging data and refuses replay",
        async () => {
          const s = await stage();
          hook = async (p) =>
            new Response("injected", {
              status: p === `/after-room/${s.id}` ? 503 : 200,
            });
          assert.equal(
            (await request(`/api/decks/${s.id}/restore`, "POST", s.body))
              .status,
            503,
          );
          assert.equal(
            (await request(`/api/decks/${s.id}/restore`, "DELETE")).status,
            200,
          );
          assert.equal(
            (await request(`/api/decks/${s.id}/restore`, "POST", s.body))
              .status,
            404,
          );
          assert.equal((await request(s.src)).status, 404);
          assert.ok(
            !(await data("/api/decks")).decks.some((d: any) => d.id === s.id),
          );
        },
      );
      await t.test(
        "A4: a lost Room response leaves an uploading job but replay preserves the committed notes",
        async () => {
          const s = await stage();
          let failed = false;
          hook = async (p) => {
            if (p === `/room-response/${s.id}` && !failed) {
              failed = true;
              return new Response("lost", { status: 503 });
            }
            return new Response("ok");
          };
          assert.equal(
            (await request(`/api/decks/${s.id}/restore`, "POST", s.body))
              .status,
            503,
          );
          assert.equal(
            (await data(`/api/restores/${s.id}`)).status,
            "uploading",
          );
          const ns = await mf.getDurableObjectNamespace("ROOMS");
          const saved = (await (
            await ns.get(ns.idFromName(s.id)).fetch("http://room/backup")
          ).json()) as any;
          await mf.dispose();
          mf = fixture.start({
            scriptPath,
            hook: (r) => hook(new URL(r.url).pathname),
          });
          assert.equal(
            (await request(`/api/decks/${s.id}/restore`, "POST", s.body))
              .status,
            200,
          );
          const notes = (await data(`/api/decks/${s.id}/comments`)).comments;
          assert.deepEqual(
            notes.map((n: any) => n.id),
            saved.comments.map((n: any) => n.id),
          );
          await assertComplete(s);
        },
      );
      hook = async () => new Response("ok");
      await t.test(
        "B: lost commit response is queryable and replay returns the same work",
        async () => {
          const s = await stage();
          // Transport wrapper discards the successful server response before caller sees it.
          const lost = async () => {
            const r = await request(
              `/api/decks/${s.id}/restore`,
              "POST",
              s.body,
            );
            assert.equal(r.status, 200);
            await r.arrayBuffer();
            throw new TypeError("AUDIT_RESPONSE_LOST");
          };
          await assert.rejects(lost, /AUDIT_RESPONSE_LOST/);
          assert.equal(
            (await request(`/api/decks/${s.id}/restore`, "DELETE")).status,
            409,
          );
          const listed = (await data("/api/decks")).decks.filter(
            (d: any) => d.id === s.id,
          );
          assert.equal(listed.length, 1);
          assert.equal(listed[0].status, "ready");
          assert.equal(
            (await request(`/api/decks/${s.id}/restore`)).status,
            200,
          );
          assert.equal(
            (await request(`/api/decks/${s.id}/restore`, "POST", s.body))
              .status,
            200,
          );
          await assertComplete(s);
        },
      );
      await t.test(
        "C: every slide, image, note and sharing change including ABA is rejected",
        async () => {
          const source = await stage();
          assert.equal(
            (
              await request(
                `/api/decks/${source.id}/restore`,
                "POST",
                source.body,
              )
            ).status,
            200,
          );
          assert.equal(
            (await data(`/api/decks/${source.id}`, guest)).access.mode,
            "all",
          );
          const response = await mf.dispatchFetch(
            `${origin}/api/decks/${source.id}/live`,
            {
              headers: { Origin: origin, Cookie: guest, Upgrade: "websocket" },
            },
          );
          assert.equal(response.status, 101);
          const ws = response.webSocket!,
            doc = new Y.Doc();
          let initial!: () => void;
          const ready = new Promise<void>((r) => (initial = r));
          const messages: any[] = [];
          ws.addEventListener("message", (e) => {
            if (typeof e.data === "string") messages.push(JSON.parse(e.data));
            else {
              Y.applyUpdate(doc, new Uint8Array(e.data as ArrayBuffer));
              initial();
            }
          });
          ws.accept();
          await ready;
          let changes = 0;
          async function update(kind: string, title = "取得中の変更") {
            const before = readSharedDeck(doc),
              after = structuredClone(before),
              vector = Y.encodeStateVector(doc);
            if (kind === "slide") after.slides[0].title = title;
            else
              after.slides[0].elements = after.slides[0].elements.filter(
                (e) => e.type !== "image",
              );
            applyDeckChange(doc, before, after);
            const id = `race-${++changes}`;
            ws.send(
              JSON.stringify({
                type: "update",
                protocol: COLLABORATION_PROTOCOL,
                id,
                update: toBase64(Y.encodeStateAsUpdate(doc, vector)),
              }),
            );
            const end = Date.now() + 8000;
            while (!messages.some((m) => m.type === "ack" && m.id === id)) {
              assert.ok(Date.now() < end);
              await new Promise((r) => setTimeout(r, 10));
            }
          }
          try {
            for (const kind of [
              "slide",
              "image",
              "note",
              "sharing",
              "sharing-ABA",
            ]) {
              const pause = gate();
              hook = async (p) => {
                if (p === `/after-capture/${source.id}`) await pause.wait();
                return new Response("ok");
              };
              const exporting = request(`/api/decks/${source.id}/backup`);
              await pause.entered;
              if (kind === "slide" || kind === "image") await update(kind);
              else if (kind === "note")
                assert.equal(
                  (
                    await request(
                      `/api/decks/${source.id}/comments`,
                      "POST",
                      {
                        slide: source.snapshot.deck.slides[0].id,
                        text: "取得中の付箋",
                        x: 0.4,
                        y: 0.5,
                      },
                      guest,
                    )
                  ).status,
                  200,
                );
              else {
                const access = { ...all, mode: "none" };
                assert.equal(
                  (
                    await request(
                      `/api/decks/${source.id}/members/friend`,
                      "PATCH",
                      access,
                    )
                  ).status,
                  200,
                );
                if (kind === "sharing-ABA")
                  assert.equal(
                    (
                      await request(
                        `/api/decks/${source.id}/members/friend`,
                        "PATCH",
                        all,
                      )
                    ).status,
                    200,
                  );
              }
              pause.release();
              const captured = await exporting;
              assert.equal(captured.status, 409, kind);
              if (kind === "sharing")
                assert.equal(
                  (
                    await request(
                      `/api/decks/${source.id}/members/friend`,
                      "PATCH",
                      all,
                    )
                  ).status,
                  200,
                );
              assert.match(((await captured.json()) as any).error, /変更/);
              console.log(`AUDIT_CAPTURE ${kind} status=${captured.status}`);
            }
            // ABA across two DOs: no instant ever had the returned combination.
            // P0/D0 -> P1/D0 -> P1/D1 [Room capture] -> P1/D2 -> P0/D2.
            const beforeRoom = gate(),
              afterRoom = gate();
            hook = async (p) => {
              if (p === `/before-capture/${source.id}`) await beforeRoom.wait();
              if (p === `/after-capture/${source.id}`) await afterRoom.wait();
              return new Response("ok");
            };
            await update("slide", "D0");
            const exporting = request(`/api/decks/${source.id}/backup`);
            await beforeRoom.entered;
            assert.equal(
              (
                await request(
                  `/api/decks/${source.id}/members/friend`,
                  "PATCH",
                  { ...all, comment: false },
                )
              ).status,
              200,
            );
            await update("slide", "D1");
            beforeRoom.release();
            await afterRoom.entered;
            await update("slide", "D2");
            assert.equal(
              (
                await request(
                  `/api/decks/${source.id}/members/friend`,
                  "PATCH",
                  all,
                )
              ).status,
              200,
            );
            afterRoom.release();
            const mixed = await exporting;
            assert.equal(mixed.status, 409);
            assert.match(((await mixed.json()) as any).error, /変更/);
            console.log(
              "REGRESSION_MIXED status=409; inconsistent snapshot rejected",
            );
          } finally {
            ws.close();
            doc.destroy();
            hook = async () => new Response("ok");
          }
        },
      );
    } finally {
      await mf.dispose();
      await rm(temp, { recursive: true, force: true });
    }
  },
);
