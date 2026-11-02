import * as Y from "yjs";
import assert from "node:assert/strict";
import {
  readSharedDeck,
  sharedText,
  fromBase64,
  toBase64,
} from "../../src/sharedDeck.ts";
import { COLLABORATION_PROTOCOL } from "../../src/collaborationProtocol.ts";
export async function exercisePermissionOrder(
  call: (
    path: string,
    method?: string,
    value?: unknown,
    cookie?: string,
  ) => Promise<any>,
  connect: (
    id: string,
    cookie: string,
  ) => Promise<{
    ws: { send: (value: string) => void; close: () => void };
    doc: Y.Doc;
    messages: any[];
  }>,
  id: string,
  owner: string,
  cookie: string,
) {
  const wait = async (check: () => boolean) => {
    const deadline = Date.now() + 8000;
    while (!check()) {
      assert.ok(Date.now() < deadline, "Expected update ACK");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  const host = await connect(id, owner);
  const peers = [host];
  const send = async (
    peer: typeof host,
    name: string,
    edit: () => void,
    denied = false,
  ) => {
    const vector = Y.encodeStateVector(peer.doc);
    edit();
    peer.ws.send(
      JSON.stringify({
        type: "update",
        protocol: COLLABORATION_PROTOCOL,
        id: name,
        update: toBase64(Y.encodeStateAsUpdate(peer.doc, vector)),
      }),
    );
    await wait(
      () =>
        peer.messages.some((m) => m.id === name && m.type === "ack") ||
        peer.messages.some((m) => m.type === "error"),
    );
    if (denied)
      assert.ok(
        peer.messages.some((m) => m.type === "error" && m.code === "forbidden"),
      );
    else
      assert.ok(
        peer.messages.some((m) => m.id === name && m.type === "ack"),
        JSON.stringify(peer.messages.filter((m) => m.type === "error")),
      );
  };
  try {
    const book = readSharedDeck(host.doc),
      own = book.slides.find((s) => s.y === 0)!,
      locked = book.slides.find((s) => s.y === 1)!;
    host.doc.clientID = Math.max(...host.doc.store.clients.keys()) + 1;
    await send(host, "host-new-field", () => {
      const elements = host.doc
        .getMap<Y.Map<unknown>>("slides")
        .get(locked.id)!
        .get("elements") as Y.Map<Y.Map<unknown>>;
      elements.get(locked.elements[0].id)!.set("textAlign", "center");
    });
    const user = (
      await (await call("/api/session", "GET", undefined, cookie)).json()
    ).user.id;
    assert.equal(
      (
        await call(
          `/api/decks/${id}/members/${encodeURIComponent(user)}`,
          "PATCH",
          {
            mode: "scoped",
            comment: true,
            rows: [{ sheetId: "main", index: 0 }],
            columns: [],
            slides: [],
          },
          owner,
        )
      ).status,
      200,
    );
    for (let i = 0; i < 2; i++) {
      const guest = await connect(id, cookie);
      peers.push(guest);
      await send(guest, `own-after-history-${i}`, () =>
        sharedText(guest.doc, own.id, own.elements[0].id)!.insert(
          0,
          `担当${i} `,
        ),
      );
      const state = (
        await (await call(`/api/decks/${id}`, "GET", undefined, owner)).json()
      ).state;
      const current = new Y.Doc();
      Y.applyUpdate(current, fromBase64(state));
      assert.ok(
        readSharedDeck(current)
          .slides.find((s) => s.id === own.id)!
          .elements[0].text!.includes(`担当${i}`),
      );
      current.destroy();
      if (i === 1)
        await send(
          guest,
          "protected-still-denied",
          () =>
            sharedText(guest.doc, locked.id, locked.elements[0].id)!.insert(
              0,
              "範囲外",
            ),
          true,
        );
      guest.ws.close();
    }
  } finally {
    for (const peer of peers) {
      peer.ws.close();
      peer.doc.destroy();
    }
  }
}
