import { afterEach, it, expect, vi } from "vitest";
import { CloudWorkspace } from "./cloud";
import type { SlideComment } from "./permissions";
const note = (text: string): SlideComment => ({
  id: "note",
  slide: "page",
  author: "u",
  name: "投稿者",
  text,
  x: 0.1,
  y: 0.1,
  created: 1,
});
function workspace() {
  const c = new CloudWorkspace();
  c.user = { id: "u", name: "投稿者", email: "u@example.test" };
  c.active = { id: "room", owner: "u" };
  return c;
}
afterEach(() => vi.unstubAllGlobals());
it("serializes note writes across remounts, so an older request cannot finish after a newer write", async () => {
  const c = workspace(),
    writes: string[] = [];
  let release = () => {};
  const gate = new Promise<void>((r) => (release = r));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === "PUT") {
        const text = JSON.parse(options.body as string).text;
        writes.push(text);
        if (text === "古い入力") await gate;
      }
      return new Response(JSON.stringify({ comments: [] }), { status: 200 });
    }),
  );
  const a = c.saveComment("room", note("古い入力")),
    b = c.saveComment("room", note("新しい入力"));
  await vi.waitFor(() => expect(writes).toEqual(["古い入力"]));
  release();
  await Promise.all([a, b]);
  expect(writes).toEqual(["古い入力", "新しい入力"]);
});
it("uses the newest registered draft flusher instead of replaying an unmounted older editor", async () => {
  const c = workspace(),
    old = vi.fn(async () => {}),
    current = vi.fn(async () => {});
  c.retainNoteSave("room", old, "u", "note");
  const unregister = c.registerNoteFlush(current, "note");
  await c.retryNoteSaves();
  expect(current).toHaveBeenCalledTimes(1);
  expect(old).not.toHaveBeenCalled();
  unregister();
});
it("does not clear a newer draft when an older save completes and isolates drafts by account", () => {
  const c = workspace();
  c.markNoteDraft("room", "note", true, "u", note("古い入力"));
  c.markNoteDraft("room", "note", true, "u", note("新しい入力"));
  c.markNoteDraft("room", "note", false, "u", note("古い入力"));
  expect(c.saveSnapshot.notesDirty).toBe(1);
  expect(c.draftComment("room", "note")?.text).toBe("新しい入力");
  c.user = { id: "other", name: "別の人", email: "other@example.test" };
  expect(c.pendingCommentDrafts).toEqual([]);
  expect(c.draftComment("room", "note")).toBeUndefined();
  expect(c.saveSnapshot.notesDirty).toBe(0);
});
it("never sends a queued old-account draft with the new account", async () => {
  const c = workspace(),
    writes: string[] = [];
  let release = () => {};
  const gate = new Promise<void>((r) => (release = r));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, o?: RequestInit) => {
      if (o?.method === "PUT") {
        writes.push(JSON.parse(o.body as string).text);
        await gate;
      }
      return new Response(JSON.stringify({ comments: [] }), { status: 200 });
    }),
  );
  const a = c.saveComment("room", note("送信開始済み"));
  const b = c.saveComment("room", note("送信待ち"));
  const rejected = expect(b).rejects.toThrow("アカウント");
  await vi.waitFor(() => expect(writes).toHaveLength(1));
  c.user = { id: "other", name: "別の人", email: "other@example.test" };
  release();
  await a;
  await rejected;
  expect(writes).toEqual(["送信開始済み"]);
});
