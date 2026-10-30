import assert from "node:assert/strict";
import * as Y from "yjs";
import { COLLABORATION_PROTOCOL } from "../../src/collaborationProtocol.ts";
import { readSharedDeck, toBase64 } from "../../src/sharedDeck.ts";
type Live = {
  ws: { send: (data: string) => void; close: () => void; readyState: number };
  doc: Y.Doc;
  messages: any[];
};
export async function exerciseHostFollow(o: {
  create: () => Promise<string>;
  join: (id: string, cookie: string) => Promise<unknown>;
  connect: (id: string, cookie: string) => Promise<Live>;
  owner: string;
  guest: string;
}) {
  const wait = async (test: () => boolean, timeout = 10000) => {
    const end = Date.now() + timeout;
    while (!test()) {
      assert.ok(Date.now() < end, "follow-state timeout");
      await new Promise((r) => setTimeout(r, 15));
    }
  };
  const room = await o.create();
  await o.join(room, o.guest);
  const host = await o.connect(room, o.owner),
    guest = await o.connect(room, o.guest),
    host2 = await o.connect(room, o.owner),
    other = await o.connect(await o.create(), o.owner);
  const connections = [host, guest, host2, other];
  const latest = (c: Live) =>
    c.messages.filter((m) => m.type === "follow-state").at(-1)?.state;
  const send = (c: Live, id: string, action: string, extra: object = {}) =>
    c.ws.send(
      JSON.stringify({
        type: "follow-control",
        protocol: COLLABORATION_PROTOCOL,
        id,
        action,
        ...extra,
      }),
    );
  const error = async (c: Live, id: string, status: number) => {
    await wait(() =>
      c.messages.some((m) => m.type === "follow-error" && m.requestId === id),
    );
    assert.equal(
      c.messages.find((m) => m.type === "follow-error" && m.requestId === id)
        .status,
      status,
    );
  };
  const state = async (id: string) => {
    await wait(() =>
      guest.messages.some(
        (m) => m.type === "follow-state" && m.requestId === id,
      ),
    );
    return guest.messages.find(
      (m) => m.type === "follow-state" && m.requestId === id,
    ).state;
  };
  try {
    await wait(() => !!latest(guest));
    assert.equal(latest(guest).active, false);
    const book = readSharedDeck(host.doc),
      page = book.slides[0],
      target = {
        mode: "page",
        sheetId: page.sheetId ?? "main",
        pageId: page.id,
      },
      bytes = toBase64(Y.encodeStateAsUpdate(host.doc));
    send(guest, "forged-start", "start", {
      target,
      host: true,
      user: { id: "owner" },
    });
    await error(guest, "forged-start", 403);
    assert.equal(guest.ws.readyState, 1);
    send(host, "invalid", "start", {
      target: { mode: "page", sheetId: "missing", pageId: page.id },
    });
    await error(host, "invalid", 400);
    assert.equal(latest(guest).active, false);
    send(host, "start", "start", { target });
    const started = await state("start");
    assert.equal(started.active, true);
    assert.equal(started.target.pageId, page.id);
    assert.ok(started.host.name);
    assert.ok(started.startedAt > 0);
    assert.ok(!("controller" in started));
    send(guest, "forged-stop", "stop", { sessionId: started.sessionId });
    await error(guest, "forged-stop", 403);
    send(guest, "forged-move", "move", {
      sessionId: started.sessionId,
      target: { mode: "map", sheetId: "main" },
    });
    await error(guest, "forged-move", 403);
    send(host2, "other-host-move", "move", {
      sessionId: started.sessionId,
      target: { mode: "map", sheetId: "main" },
    });
    await error(host2, "other-host-move", 409);
    send(host, "move", "move", {
      sessionId: started.sessionId,
      target: { mode: "map", sheetId: "main", pageId: page.id },
    });
    const moved = await state("move");
    assert.equal(moved.target.mode, "map");
    assert.equal(moved.revision, started.revision + 1);
    const late = await o.connect(room, o.guest);
    connections.push(late);
    await wait(() => latest(late)?.active);
    assert.equal(latest(late).sessionId, started.sessionId);
    assert.equal(latest(late).target.mode, "map");
    assert.equal(latest(other).active, false);
    send(host2, "stop", "stop", { sessionId: started.sessionId });
    assert.equal((await state("stop")).active, false);
    send(host2, "next", "start", { target });
    const next = await state("next");
    assert.notEqual(next.sessionId, started.sessionId);
    send(host, "stale-stop", "stop", { sessionId: started.sessionId });
    await error(host, "stale-stop", 409);
    assert.equal(latest(guest).sessionId, next.sessionId);
    host.ws.close();
    send(host2, "next-move", "move", {
      sessionId: next.sessionId,
      target: { mode: "map", sheetId: "main" },
    });
    assert.equal((await state("next-move")).sessionId, next.sessionId);
    assert.equal(
      toBase64(Y.encodeStateAsUpdate(host2.doc)),
      bytes,
      "follow controls must not alter the shared work",
    );
    send(host2, "finish", "stop", { sessionId: next.sessionId });
    assert.equal((await state("finish")).active, false);
    assert.equal(latest(other).active, false);
    send(host2, "disconnect-start", "start", { target });
    await state("disconnect-start");
    host2.ws.close();
    await wait(() => latest(guest)?.active === false);
    const leaseHost = await o.connect(room, o.owner);
    connections.push(leaseHost);
    send(leaseHost, "lease-start", "start", { target });
    const lease = await state("lease-start");
    assert.equal(lease.expiresAt - lease.updatedAt, 45000);
    // Real server time: open socket with no heartbeat models a frozen host tab.
    await wait(() => latest(guest)?.active === false, 48000);
    assert.equal(leaseHost.ws.readyState, 1);
    send(leaseHost, "expired-move", "move", {
      sessionId: lease.sessionId,
      target,
    });
    await error(leaseHost, "expired-move", 409);
    send(leaseHost, "recovered-start", "start", { target });
    const recovered = await state("recovered-start");
    assert.notEqual(recovered.sessionId, lease.sessionId);
    send(leaseHost, "recovered-stop", "stop", {
      sessionId: recovered.sessionId,
    });
    await state("recovered-stop");
  } finally {
    for (const c of connections) {
      try {
        c.ws.close();
      } catch {}
      c.doc.destroy();
    }
  }
}

export async function measureHostFollow40(
  o: Parameters<typeof exerciseHostFollow>[0],
  backend: string,
) {
  const room = await o.create();
  await o.join(room, o.guest);
  const connections: Live[] = [];
  const wait = async (test: () => boolean) => {
    const end = performance.now() + 10000;
    while (!test()) {
      assert.ok(performance.now() < end, "40 connection follow timeout");
      await new Promise((r) => setTimeout(r, 5));
    }
  };
  try {
    for (let i = 0; i < 40; i++)
      connections.push(await o.connect(room, i === 0 ? o.owner : o.guest));
    const host = connections[0],
      book = readSharedDeck(host.doc),
      page = book.slides[0];
    const target = {
      mode: "page",
      sheetId: page.sheetId ?? "main",
      pageId: page.id,
    };
    host.ws.send(
      JSON.stringify({
        type: "follow-control",
        protocol: COLLABORATION_PROTOCOL,
        id: "load-start",
        action: "start",
        target,
      }),
    );
    await wait(() =>
      connections.every((c) =>
        c.messages.some((m) => m.requestId === "load-start"),
      ),
    );
    const sessionId = host.messages.find((m) => m.requestId === "load-start")
      .state.sessionId;
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const id = `load-${i}`,
        start = performance.now();
      host.ws.send(
        JSON.stringify({
          type: "follow-control",
          protocol: COLLABORATION_PROTOCOL,
          id,
          action: "move",
          sessionId,
          target: { ...target, pageId: book.slides[i % book.slides.length].id },
        }),
      );
      await wait(() =>
        connections.every((c) => c.messages.some((m) => m.requestId === id)),
      );
      samples.push(performance.now() - start);
    }
    const sorted = [...samples].sort((a, b) => a - b),
      p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
    console.log(
      "FOLLOW_40_METRICS " +
        JSON.stringify({
          backend,
          connections: 40,
          samples: 20,
          p95Ms: p95,
          maxMs: Math.max(...samples),
          allMs: samples,
        }),
    );
    assert.ok(p95 <= 1000, `P95 ${p95}ms exceeds 1s`);
  } finally {
    for (const c of connections) {
      c.ws.close();
      c.doc.destroy();
    }
  }
}
