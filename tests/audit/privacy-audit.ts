import { COLLABORATION_PROTOCOL } from "../../src/collaborationProtocol.ts";
/** Read-only product audit: only synthetic users and disposable local stores. */
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { WebSocket } from "ws";
import * as Y from "yjs";
import { createApplication } from "../../server/app.ts";
import { harness } from "../cloudflare/harness.ts";
import { sample } from "../../src/model.ts";
import {
  applyDeckChange,
  readSharedDeck,
  fromBase64,
  toBase64,
} from "../../src/sharedDeck.ts";
const origin = "http://privacy.test";
const findings: any[] = [];
async function until(fn: () => boolean) {
  const end = Date.now() + 8000;
  while (!fn()) {
    assert.ok(Date.now() < end, "wait timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}
for (const backend of ["node", "cloudflare"]) {
  const temp = await mkdtemp(join(tmpdir(), "vhslide-privacy-"));
  let app: any,
    mf: any,
    base = "",
    fixture: any;
  const peers: any[] = [];
  try {
    if (backend === "node") {
      app = createApplication({
        directory: temp,
        origin,
        clientId: "privacy-test",
        verifyIdentity: async (credential) => ({
          id: credential,
          name: credential,
          email: `${credential}@example.test`,
        }),
      });
      app.server.listen(0, "127.0.0.1");
      await once(app.server, "listening");
      base = `http://127.0.0.1:${app.server.address().port}`;
    } else {
      fixture = await harness(temp, origin);
      mf = fixture.start();
      await mf.ready;
    }
    const request = async (
      path: string,
      method = "GET",
      value?: unknown,
      cookie = "",
      source = origin,
      extraHeaders: Record<string, string> = {},
    ) => {
      const options = {
        method,
        headers: {
          Origin: source,
          Cookie: cookie,
          "Content-Type": "application/json",
          ...extraHeaders,
        },
        ...(value === undefined ? {} : { body: JSON.stringify(value) }),
      };
      return backend === "node"
        ? fetch(base + path, options)
        : mf.dispatchFetch(origin + path, options);
    };
    const login = async (id: string) => {
      const r = await request("/api/auth/google", "POST", {
        credential: backend === "node" ? id : await fixture.sign(id),
      });
      assert.equal(r.status, 200);
      return r.headers.get("set-cookie")!.split(";")[0];
    };
    const owner = await login("privacy-teacher"),
      student = await login("privacy-student-a"),
      outsider = await login("privacy-outsider");
    const book = sample(),
      secret = book.slides.find((s) => s.y === 1)!;
    secret.title = "FICTIONAL_OTHER_STUDENT_PRIVATE_TITLE";
    secret.elements[0].text = "FICTIONAL_OTHER_STUDENT_PRIVATE_BODY";
    const photo = await readFile(
      new URL("./fixtures/privacy-photo.jpg", import.meta.url),
    );
    secret.elements.push({
      id: "privacy-photo",
      type: "image",
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      src: `data:image/jpeg;base64,${photo.toString("base64")}`,
    });
    const cr = await request("/api/decks", "POST", book, owner);
    assert.equal(cr.status, 201);
    const { id } = (await cr.json()) as any;
    const scoped = (index: number) => ({
      mode: "scoped",
      comment: true,
      rows: [{ sheetId: "main", index }],
      columns: [],
      slides: [],
    });
    assert.equal(
      (
        await request(
          `/api/decks/${id}/recipients`,
          "POST",
          {
            recipients: [
              { email: "privacy-student-a@example.test", access: scoped(0) },
              { email: "privacy-student-b@example.test", access: scoped(1) },
            ],
          },
          owner,
        )
      ).status,
      200,
    );
    const read = async (path: string, cookie = student) => {
      const r = await request(path, "GET", undefined, cookie);
      assert.equal(r.status, 200, await r.clone().text());
      return r.json() as Promise<any>;
    };
    await read("/api/decks"); // claim only the pre-shared A account
    const state = await read(`/api/decks/${id}`),
      doc = new Y.Doc();
    Y.applyUpdate(doc, fromBase64(state.state));
    const decoded = readSharedDeck(doc);
    const src = decoded.slides
      .find((s) => s.id === secret.id)!
      .elements.find((e) => e.id === "privacy-photo")!.src!;
    const blocked: any[] = [];
    for (const path of [
      `/api/decks/${id}`,
      src,
      `/api/decks/${id}/comments`,
      `/api/decks/${id}/row-accounts`,
      `/api/decks/${id}/history`,
      `/api/decks/${id}/backup`,
    ]) {
      const anon = await request(path),
        external = await request(path, "GET", undefined, outsider);
      assert.equal(anon.status, 401);
      assert.equal(external.status, 404);
      blocked.push({
        endpoint: path.replaceAll(id, "WORK"),
        anonymous: anon.status,
        nonMember: external.status,
      });
    }
    findings.push({
      backend,
      check: "non-member privacy boundary",
      result: "PASS",
      evidence: blocked,
    });
    const ownerOnly = [];
    for (const extra of ["members", "recipients", "history", "backup"]) {
      const r = await request(
        `/api/decks/${id}/${extra}`,
        "GET",
        undefined,
        student,
      );
      assert.ok([403, 404].includes(r.status));
      ownerOnly.push({ extra, status: r.status });
    }
    findings.push({
      backend,
      check: "host-only roster, emails, versions, complete backup",
      result: "PASS",
      evidence: ownerOnly,
    });
    assert.equal(
      decoded.slides.find((s) => s.id === secret.id)!.title,
      secret.title,
    );
    assert.equal(state.access.rows[0].index, 0);
    assert.equal((await request(src, "GET", undefined, student)).status, 200);
    findings.push({
      backend,
      check: "scoped student reads other rows and their photos",
      result: "CONFIRMED_RISK",
      assignedRow: 0,
      readOtherRow: secret.y,
      readPages: decoded.slides.length,
    });
    const names = await read(`/api/decks/${id}/row-accounts`);
    assert.ok(JSON.stringify(names).includes("privacy-student-b"));
    assert.ok(!JSON.stringify(names).includes("@example.test"));
    findings.push({
      backend,
      check:
        "pre-joined roster identifiers are sent even when row names are not enabled",
      result: "CONFIRMED_RISK",
      unjoinedAccountAliasVisible: true,
      fullEmailAutomatic: false,
    });
    const got = await request(src, "GET", undefined, student);
    assert.deepEqual(Buffer.from(await got.arrayBuffer()), photo);
    findings.push({
      backend,
      check: "photo original metadata is preserved",
      result: "CONFIRMED_RISK",
      exifMarker: photo.includes(Buffer.from("FICTIONAL_STUDENT_METADATA")),
      bytesUnchanged: true,
    });
    const note = await request(
      `/api/decks/${id}/comments`,
      "POST",
      { slide: secret.id, text: "FICTIONAL_PRIVATE_NOTE", x: 0.2, y: 0.2 },
      owner,
    );
    assert.equal(note.status, 200);
    assert.ok(
      JSON.stringify(await read(`/api/decks/${id}/comments`)).includes(
        "FICTIONAL_PRIVATE_NOTE",
      ),
    );
    const inv = await readInvite();
    async function readInvite() {
      const r = await request(
        `/api/decks/${id}/invite`,
        "POST",
        undefined,
        owner,
      );
      assert.equal(r.status, 200);
      return new URL(((await r.json()) as any).url).searchParams.get("join")!;
    }
    const pendingOutsider = await request(
      `/api/invites/${inv}/accept`,
      "POST",
      undefined,
      outsider,
    );
    assert.equal(pendingOutsider.status, 202);
    const outsiderRequest = (await pendingOutsider.json()) as any;
    assert.equal(
      (await request(`/api/decks/${id}`, "GET", undefined, outsider)).status,
      404,
    );
    assert.equal(
      (
        await request(
          `/api/decks/${id}/join-requests/approve`,
          "POST",
          { requestIds: [outsiderRequest.requestId] },
          owner,
        )
      ).status,
      200,
    );
    const joined = await read(`/api/decks/${id}`, outsider);
    assert.equal(joined.access.mode, "none");
    findings.push({
      backend,
      check: "invitation alone cannot admit an unapproved account",
      result: "PASS",
      pendingStatus: 202,
      readBeforeApproval: 404,
      readAfterExplicitApproval: 200,
    });
    assert.equal(
      (
        await request(
          `/api/decks/${id}/members/privacy-student-a`,
          "DELETE",
          undefined,
          owner,
        )
      ).status,
      200,
    );
    assert.equal(
      (await request(`/api/decks/${id}`, "GET", undefined, student)).status,
      404,
    );
    const readmission = await request(
      `/api/invites/${inv}/accept`,
      "POST",
      undefined,
      student,
    );
    assert.equal(readmission.status, 202);
    const again = (await readmission.json()) as any;
    assert.equal(
      (await request(`/api/decks/${id}`, "GET", undefined, student)).status,
      404,
    );
    findings.push({
      backend,
      check: "revoked account cannot return without a fresh host approval",
      result: "PASS",
      pendingStatus: 202,
      readAfterReaccept: 404,
    });
    assert.equal(
      (
        await request(
          `/api/decks/${id}/join-requests/approve`,
          "POST",
          { requestIds: [again.requestId] },
          owner,
        )
      ).status,
      200,
    );
    assert.equal(
      (await request(`/api/decks/${id}/invite`, "DELETE", undefined, owner))
        .status,
      200,
    );
    assert.equal(
      (
        await request(
          `/api/decks/${id}/members/privacy-student-a`,
          "DELETE",
          undefined,
          owner,
        )
      ).status,
      200,
    );
    assert.equal(
      (await request(`/api/invites/${inv}/accept`, "POST", undefined, student))
        .status,
      404,
    );
    assert.equal(
      (await request(`/api/decks/${id}`, "GET", undefined, student)).status,
      404,
    );
    findings.push({
      backend,
      check: "invalidate invitation then remove participant prevents re-entry",
      result: "PASS",
    });
    // Reauthorise the synthetic student to continue the other independent checks.
    assert.equal(
      (
        await request(
          `/api/decks/${id}/recipients`,
          "POST",
          {
            recipients: [
              { email: "privacy-student-a@example.test", access: scoped(0) },
            ],
          },
          owner,
        )
      ).status,
      200,
    );
    await read("/api/decks");
    assert.equal(
      (
        await request(
          "/api/decks",
          "POST",
          sample(),
          student,
          "http://evil.invalid",
        )
      ).status,
      403,
    );
    findings.push({
      backend,
      check: "cross-origin authenticated mutation denied",
      result: "PASS",
    });

    const connect = async (cookie: string) => {
      const messages: any[] = [],
        d = new Y.Doc();
      let ws: any, ready!: () => void;
      const loaded = new Promise<void>((r) => (ready = r));
      if (backend === "node") {
        ws = new WebSocket(
          base.replace("http", "ws") + `/api/decks/${id}/live`,
          { headers: { Origin: origin, Cookie: cookie } },
        );
        ws.on("message", (data: Buffer, binary: boolean) => {
          if (binary) {
            Y.applyUpdate(d, data);
            ready();
          } else messages.push(JSON.parse(data.toString()));
        });
      } else {
        const r = await mf.dispatchFetch(origin + `/api/decks/${id}/live`, {
          headers: { Origin: origin, Cookie: cookie, Upgrade: "websocket" },
        });
        assert.equal(r.status, 101);
        ws = r.webSocket;
        ws.addEventListener("message", (e: any) => {
          if (typeof e.data === "string") messages.push(JSON.parse(e.data));
          else {
            Y.applyUpdate(d, new Uint8Array(e.data));
            ready();
          }
        });
        ws.accept();
      }
      await loaded;
      const p = { ws, doc: d, messages };
      peers.push(p);
      return p;
    };
    const host = await connect(owner),
      client = await connect(student);
    assert.ok(
      readSharedDeck(client.doc).slides.some((s) => s.title === secret.title),
    );
    // A viewer must still be unable to write through a forged client.
    const vec = Y.encodeStateVector(client.doc);
    (client.doc.getMap("slides").get(secret.id) as Y.Map<any>).set(
      "title",
      "UNAUTHORISED_CHANGE",
    );
    client.ws.send(
      JSON.stringify({
        type: "update",
        protocol: COLLABORATION_PROTOCOL,
        id: "privacy-forged-edit",
        update: toBase64(Y.encodeStateAsUpdate(client.doc, vec)),
      }),
    );
    await until(() => client.messages.some((m) => m.type === "error"));
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, fromBase64((await read(`/api/decks/${id}`)).state));
    assert.equal(
      readSharedDeck(fresh).slides.find((s) => s.id === secret.id)!.title,
      secret.title,
    );
    fresh.destroy();
    findings.push({
      backend,
      check: "full WebSocket document readable, forged write denied",
      result: "PASS",
      fullReadConfirmed: true,
      writeRejected: true,
    });
    const before = readSharedDeck(host.doc),
      after = {
        ...before,
        slides: before.slides.filter((s) => s.id !== secret.id),
      },
      v = Y.encodeStateVector(host.doc);
    applyDeckChange(host.doc, before, after);
    host.ws.send(
      JSON.stringify({
        type: "update",
        protocol: COLLABORATION_PROTOCOL,
        id: "privacy-delete",
        update: toBase64(Y.encodeStateAsUpdate(host.doc, v)),
      }),
    );
    await until(() =>
      host.messages.some((m) => m.type === "ack" && m.id === "privacy-delete"),
    );
    assert.equal((await request(src, "GET", undefined, student)).status, 404);
    assert.equal(
      (
        await request(src, "GET", undefined, student, origin, {
          "X-Media-Host": "1",
          "X-Media-User": "privacy-teacher",
          "X-Uploaded-By": "privacy-student-a",
        })
      ).status,
      404,
    );
    const comments = await read(`/api/decks/${id}/comments`, student);
    assert.ok(!JSON.stringify(comments).includes("FICTIONAL_PRIVATE_NOTE"));
    assert.equal((await request(src, "GET", undefined, owner)).status, 200);
    const archived = await read(`/api/decks/${id}/comments`, owner);
    assert.ok(JSON.stringify(archived).includes("FICTIONAL_PRIVATE_NOTE"));
    findings.push({
      backend,
      check:
        "deleted media no longer readable by ordinary members; host recovery retained",
      result: "PASS",
      photoStatus: 404,
      deletedSlideNoteRetainedForHostOnly: true,
      forgedInternalHeadersDenied: true,
    });
    const full = await read(`/api/decks/${id}/backup`, owner);
    assert.ok(JSON.stringify(full.sharing).includes("@example.test"));
    findings.push({
      backend,
      check: "complete backup includes plaintext recipient emails",
      result: "CONFIRMED_RISK",
      emailCount: full.sharing.length,
    });
    assert.equal(
      (await request(`/api/decks/${id}/trash`, "POST", undefined, owner))
        .status,
      200,
    );
    assert.equal((await request(src, "GET", undefined, student)).status, 404);
    assert.equal(
      (await request(`/api/decks/${id}/untrash`, "POST", undefined, owner))
        .status,
      200,
    );
    assert.equal(
      (await request(`/api/decks/${id}`, "GET", undefined, outsider)).status,
      200,
    );
    assert.equal((await request(src, "GET", undefined, outsider)).status, 404);
    findings.push({
      backend,
      check: "trash blocks reads, restoration reactivates former members",
      result: "PASS",
      restoredOldMembers: true,
    });
    assert.equal(
      (await request(`/api/decks/${id}`, "DELETE", undefined, owner)).status,
      200,
    );
    assert.equal((await request(src, "GET", undefined, student)).status, 404);
    assert.equal(
      (await request("/api/logout", "POST", undefined, student)).status,
      200,
    );
    assert.equal(
      (await request("/api/decks", "GET", undefined, student)).status,
      401,
    );
    findings.push({
      backend,
      check:
        "permanent deletion blocks photo reads and logout invalidates server session",
      result: "PASS",
    });
    doc.destroy();
    console.log(`${backend}: isolated privacy assertions passed`);
  } finally {
    for (const p of peers) {
      p.ws.close();
      p.doc.destroy();
    }
    if (app) await app.close();
    if (mf) await mf.dispose();
    await rm(temp, { recursive: true, force: true });
  }
}
await writeFile(
  "/tmp/vhslide-privacy-results.json",
  JSON.stringify(findings, null, 2),
);
console.log(JSON.stringify(findings, null, 2));
