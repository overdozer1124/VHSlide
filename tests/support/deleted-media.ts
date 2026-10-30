import assert from "node:assert/strict";
import { blank } from "../../src/model.ts";
import type { Deck } from "../../src/model.ts";
import { fromBase64, readSharedDeck } from "../../src/sharedDeck.ts";
import * as Y from "yjs";
import { acceptAndApprove } from "./join-approval.ts";
type Call = (p: string, m?: string, v?: any, c?: string) => Promise<any>;
export async function exerciseDeletedMedia(
  call: Call,
  host: string,
  editor: string,
  viewer: string,
  restart: () => Promise<void>,
  edit: (
    id: string,
    cookie: string,
    change: (book: Deck) => Deck,
    allowed: boolean,
  ) => Promise<void>,
) {
  const req = (p: string, m = "GET", v?: any, c = host) => call(p, m, v, c),
    json = async (p: string, c = host) => {
      const r = await req(p, "GET", undefined, c);
      assert.equal(r.status, 200, await r.clone().text());
      return r.json();
    };
  const start = blank(0, 0),
    secret = blank(0, 1),
    other = { ...blank(0, 0), sheetId: "second" };
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
    "base64",
  );
  secret.elements = [
    {
      id: "secret-picture",
      type: "image",
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      src: "data:image/png;base64," + bytes.toString("base64"),
    },
  ];
  const create = await req("/api/decks", "POST", {
    version: 1,
    title: "削除後の配信制御",
    sheets: [
      { id: "main", name: "主題" },
      { id: "second", name: "別シート" },
    ],
    slides: [start, secret, other],
  });
  assert.equal(create.status, 201);
  const { id } = await create.json();
  const invitation = await req(`/api/decks/${id}/invite`, "POST"),
    token = new URL((await invitation.json()).url).searchParams.get("join");
  await acceptAndApprove(req, id, token, editor, host);
  await acceptAndApprove(req, id, token, viewer, host);
  const user = (await json("/api/session", editor)).user;
  assert.equal(
    (
      await req(`/api/decks/${id}/members/${user.id}`, "PATCH", {
        mode: "all",
        comment: true,
        rows: [],
        columns: [],
        slides: [],
      })
    ).status,
    200,
  );
  const readBook = async () => {
    const d = new Y.Doc();
    Y.applyUpdate(d, fromBase64((await json(`/api/decks/${id}`)).state));
    const b = readSharedDeck(d);
    d.destroy();
    return b;
  };
  const src = (await readBook()).slides.find((s) => s.id === secret.id)!
    .elements[0].src!;
  for (const [slide, text] of [
    [secret.id, "削除後は非公開の付箋"],
    [start.id, "公開中の付箋"],
  ])
    assert.equal(
      (
        await req(
          `/api/decks/${id}/comments`,
          "POST",
          { slide, text, x: 0.2, y: 0.2 },
          editor,
        )
      ).status,
      200,
    );
  assert.equal(
    (await json(`/api/decks/${id}/comments`, viewer)).comments.length,
    2,
  );
  const uploaded = await req(`/api/decks/${id}/assets`, "POST", bytes, editor);
  assert.equal(uploaded.status, 201);
  const fresh = (await uploaded.json()).src;
  assert.equal((await req(fresh, "GET", undefined, editor)).status, 200);
  assert.equal((await req(fresh, "GET", undefined, viewer)).status, 404);
  await edit(
    id,
    editor,
    (b) => ({
      ...b,
      slides: b.slides.map((s) =>
        s.id === start.id
          ? {
              ...s,
              elements: [
                ...s.elements,
                {
                  id: "new-photo",
                  type: "image",
                  src: fresh,
                  x: 0,
                  y: 0,
                  w: 100,
                  h: 100,
                },
              ],
            }
          : s,
      ),
    }),
    true,
  );
  assert.equal((await req(fresh, "GET", undefined, viewer)).status, 200);
  // Reuse across sheets: deleting one reference must not break another current slide.
  await edit(
    id,
    host,
    (b) => ({
      ...b,
      slides: b.slides.map((s) =>
        s.id === other.id
          ? {
              ...s,
              elements: [{ ...secret.elements[0], id: "shared-photo", src }],
            }
          : s,
      ),
    }),
    true,
  );
  await edit(
    id,
    host,
    (b) => ({ ...b, slides: b.slides.filter((s) => s.id !== secret.id) }),
    true,
  );
  assert.equal((await req(src, "GET", undefined, viewer)).status, 200);
  const notes = await json(`/api/decks/${id}/comments`, viewer);
  assert.deepEqual(
    notes.comments.map((n: any) => n.text),
    ["公開中の付箋"],
  );
  assert.equal((await json(`/api/decks/${id}/comments`)).comments.length, 2);
  await edit(
    id,
    host,
    (b) => ({
      ...b,
      slides: b.slides.map((s) =>
        s.id === other.id ? { ...s, elements: [] } : s,
      ),
    }),
    true,
  );
  for (const c of [editor, viewer])
    for (const suffix of ["", "?download=1", "?host=1"])
      assert.equal((await req(src + suffix, "GET", undefined, c)).status, 404);
  assert.equal((await req(src)).status, 200);
  // A forged current reference must not unlock historical bytes or comments.
  await edit(
    id,
    editor,
    (b) => ({
      ...b,
      slides: b.slides.map((s) =>
        s.id === start.id
          ? {
              ...s,
              elements: [
                ...s.elements,
                { ...secret.elements[0], id: "forged-photo", src },
              ],
            }
          : s,
      ),
    }),
    false,
  );
  await edit(
    id,
    editor,
    (b) => ({ ...b, slides: [...b.slides, { ...secret, elements: [] }] }),
    false,
  );
  assert.equal((await req(src, "GET", undefined, editor)).status, 404);
  // Even the original uploader loses provisional access after first publication.
  await edit(
    id,
    editor,
    (b) => ({
      ...b,
      slides: b.slides.map((s) =>
        s.id === start.id
          ? { ...s, elements: s.elements.filter((e) => e.id !== "new-photo") }
          : s,
      ),
    }),
    true,
  );
  assert.equal((await req(fresh, "GET", undefined, editor)).status, 404);
  await edit(
    id,
    editor,
    (b) => ({
      ...b,
      slides: b.slides.map((s) =>
        s.id === start.id
          ? {
              ...s,
              elements: [
                ...s.elements,
                {
                  id: "forged-own-photo",
                  type: "image",
                  src: fresh,
                  x: 0,
                  y: 0,
                  w: 100,
                  h: 100,
                },
              ],
            }
          : s,
      ),
    }),
    false,
  );
  await restart();
  assert.equal((await req(src, "GET", undefined, viewer)).status, 404);
  assert.equal((await req(fresh, "GET", undefined, editor)).status, 404);
  assert.equal(
    (await json(`/api/decks/${id}/comments`, viewer)).comments.length,
    1,
  );
  const versions = await json(`/api/decks/${id}/history`),
    entry = versions.entries.find((e: any) => e.reason === "削除する前");
  assert.ok(entry);
  const old = await json(`/api/decks/${id}/history/${entry.id}`);
  assert.ok(old.snapshot.deck.slides.some((s: any) => s.id === secret.id));
  assert.ok(
    old.snapshot.comments.some((n: any) => n.text === "削除後は非公開の付箋"),
  );
  assert.equal(
    (
      await req(
        `/api/decks/${id}/history/${entry.id}`,
        "GET",
        undefined,
        viewer,
      )
    ).status,
    404,
  );
  await edit(id, host, () => old.snapshot.deck, true);
  assert.equal((await req(src, "GET", undefined, viewer)).status, 200);
  assert.equal(
    (await json(`/api/decks/${id}/comments`, viewer)).comments.length,
    2,
  );
}
