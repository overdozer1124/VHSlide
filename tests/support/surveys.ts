import assert from "node:assert/strict";
import type { SurveyView } from "../../src/surveys.ts";
type Call = (
  path: string,
  method?: string,
  value?: unknown,
  cookie?: string,
  source?: string,
) => Promise<any>;
export async function exerciseSurveys(
  call: Call,
  id: string,
  otherDeck: string,
  owner: string,
  guest: string,
  stranger: string,
  restart: () => Promise<void>,
) {
  const base = `/api/decks/${id}/surveys`;
  const list = async (who = owner): Promise<SurveyView[]> => {
    const r = await call(base, "GET", undefined, who);
    assert.equal(r.status, 200, await r.clone().text());
    return (await r.json()).surveys;
  };
  const write = async (
    path: string,
    value: unknown,
    who = owner,
    status = 200,
    method = "POST",
  ) => {
    const r = await call(base + path, method, value, who);
    assert.equal(r.status, status, await r.clone().text());
    return r;
  };
  assert.equal((await call(base, "GET", undefined, stranger)).status, 404);
  assert.equal((await call(base, "GET", undefined, "")).status, 401);
  await write(
    "",
    { question: "好きな季節", kind: "single", options: ["春", "夏"] },
    guest,
    403,
  );
  await write(
    "",
    { question: "重複", kind: "single", options: ["春", "春"] },
    owner,
    400,
  );
  await write("", {
    question: "好きな季節",
    kind: "single",
    options: ["春", "夏"],
  });
  const single = (await list())[0];
  assert.deepEqual(await list(guest), []);
  await write(`/${single.id}/status`, { status: "open" }, guest, 403);
  await write(`/${single.id}/answer`, { choices: [0], text: "" }, guest, 409);
  await write(`/${single.id}/status`, { status: "open" });
  await write(
    `/${single.id}/answer`,
    { choices: [0, 1], text: "" },
    guest,
    400,
  );
  await write(`/${single.id}/answer`, { choices: [99], text: "" }, guest, 400);
  await write(`/${single.id}/answer`, { choices: [0], text: "" }, guest);
  await write(
    `/${single.id}/answer`,
    { choices: [1], text: "", author: "forged" },
    guest,
  );
  let host = (await list()).find((s) => s.id === single.id)!;
  assert.deepEqual(host.results, { count: 1, counts: [0, 1], texts: [] });
  const own = (await list(guest))[0];
  assert.deepEqual(own.own, { choices: [1], text: "" });
  assert.equal("results" in own, false);
  const foreign = await call(
    `/api/decks/${otherDeck}/surveys/${single.id}/answer`,
    "POST",
    { choices: [0], text: "" },
    owner,
  );
  assert.equal(foreign.status, 404);
  await write(`/${single.id}/status`, { status: "closed" });
  await write(`/${single.id}/answer`, { choices: [0], text: "" }, guest, 409);
  await write(`/${single.id}/status`, { status: "open" });
  await write(`/${single.id}/answer`, { choices: [0], text: "" }, owner);
  await write("", {
    question: "複数の季節",
    kind: "multiple",
    options: ["春", "夏"],
  });
  const multiple = (await list()).find((s) => s.kind === "multiple")!;
  await write(`/${multiple.id}/status`, { status: "open" });
  await write(
    `/${multiple.id}/answer`,
    { choices: [0, 0], text: "" },
    guest,
    400,
  );
  await write(`/${multiple.id}/answer`, { choices: [0, 1], text: "" }, guest);
  await write("", { question: "気づいたこと", kind: "text" });
  const free = (await list()).find((s) => s.kind === "text")!;
  await write(`/${free.id}/status`, { status: "open" });
  await write(`/${free.id}/answer`, { choices: [], text: " " }, guest, 400);
  await write(
    `/${free.id}/answer`,
    { choices: [], text: "あ".repeat(2001) },
    guest,
    400,
  );
  await write(
    `/${free.id}/answer`,
    { choices: [], text: "<script>は文字として保存</script>\n気づき" },
    guest,
  );
  await restart();
  host = (await list()).find((s) => s.id === free.id)!;
  assert.deepEqual(host.results?.texts, [
    "<script>は文字として保存</script>\n気づき",
  ]);
  assert.equal(host.results?.count, 1);
  const guestView = await list(guest);
  assert.ok(guestView.every((s) => !("results" in s)));
  assert.equal(
    (await list()).find((s) => s.id === multiple.id)!.results!.counts.join(),
    "1,1",
  );
  await write(`/${free.id}`, undefined, guest, 403, "DELETE");
  await write(`/${free.id}`, undefined, owner, 200, "DELETE");
  assert.ok(!(await list()).some((s) => s.id === free.id));
  assert.equal(
    (
      await call(
        base,
        "POST",
        { question: "x", kind: "text" },
        owner,
        "http://evil.test",
      )
    ).status,
    403,
  );
  await call(
    `/api/decks/${id}/members/${(await (await call("/api/session", "GET", undefined, guest)).json()).user.id}`,
    "DELETE",
    undefined,
    owner,
  );
  assert.equal((await call(base, "GET", undefined, guest)).status, 404);
  await write(`/${single.id}/answer`, { choices: [0], text: "" }, guest, 404);
}
