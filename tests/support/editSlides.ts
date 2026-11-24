import assert from "node:assert/strict";
import * as Y from "yjs";
import { sample } from "../../src/model.ts";
import type { Slide } from "../../src/model.ts";
import { fromBase64, readSharedDeck } from "../../src/sharedDeck.ts";

type Call = (
  path: string,
  method?: string,
  value?: unknown,
  cookie?: string,
  source?: string,
) => Promise<any>;
type Watch = (
  id: string,
  cookie: string,
) => Promise<{ messages: any[]; close: () => void }>;

/** A 1x1 GIF carrying a unique comment block, so its blob hash is
 * unique to this exercise and usage deltas stay exact no matter
 * what other tests stored. */
export const EDIT_SLIDE_GIF = Buffer.concat([
  Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    "base64",
  ).subarray(0, 42),
  Buffer.from([0x21, 0xfe, 0x08]),
  Buffer.from("edit-sld", "ascii"),
  Buffer.from([0x00, 0x3b]),
]);

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Free-edit slides (stage 1) over HTTP, against both servers:
 * draft definitions stay hidden from students; an answer save
 * moves only the host-console poll counter (never the shared one),
 * never touches the deck document and is never broadcast to the
 * room; answer content is served per answer to its author and the
 * host only; and the shared blob pool keeps a photo alive while
 * either the deck assets or the answer photos reference it, with
 * deck deletion returning the owner's usage to where it started.
 * `guest` and `guest2` are deck members; `usage` reads the deck
 * owner's stored bytes.
 */
export async function exerciseEditSlides(
  call: Call,
  id: string,
  otherDeck: string,
  owner: string,
  guest: string,
  guest2: string,
  usage: () => Promise<number>,
  watch: Watch,
) {
  const base = `/api/decks/${id}/edit-slides`;
  const list = async (who: string) => {
    const r = await call(base, "GET", undefined, who);
    assert.equal(r.status, 200, await r.clone().text());
    return (await r.json()).editSlides as any[];
  };
  const write = async (
    path: string,
    value: unknown,
    who: string,
    status = 200,
    method = "POST",
  ) => {
    const r = await call(base + path, method, value, who);
    assert.equal(r.status, status, await r.clone().text());
    return r;
  };
  const deckState = async (deck: string) =>
    ((await (await call(`/api/decks/${deck}`, "GET", undefined, owner)).json())
      .state as string) ?? "";
  const firstSlide = async (deck: string): Promise<Slide> => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, fromBase64(await deckState(deck)));
    const slide = readSharedDeck(doc).slides[0];
    doc.destroy();
    return slide;
  };
  const poll = async (who: string) => {
    const r = await call(
      `/api/decks/${id}/poll?ev=&ea=`,
      "GET",
      undefined,
      who,
    );
    assert.equal(r.status, 200, await r.clone().text());
    return (await r.json()) as any;
  };
  const userId = async (who: string) =>
    ((await (await call("/api/session", "GET", undefined, who)).json()).user
      .id as string) ?? "";

  const usage0 = await usage();
  const source = await firstSlide(id);

  // Only the host creates definitions; a draft is invisible to
  // students (its base may come from a slide not yet shown).
  await write(
    "",
    { source: source.id, slide: source },
    guest,
    403,
  );
  const created = await write("", { source: source.id, slide: source }, owner);
  const defId = ((await created.json()).editSlides as any[])[0].id as string;
  assert.equal((await list(guest)).length, 0);
  assert.equal((await list(owner)).length, 1);
  // Answers are built on the sanitized base the server stored.
  const slide = (await list(owner))[0].base as Slide;

  // Open the intake. From here the definition is public to members.
  await write(`/${defId}/status`, { status: "open" }, guest, 403);
  await write(`/${defId}/status`, { status: "open" }, owner);
  assert.equal((await list(guest)).length, 1);

  // An answer save: the shared poll counter must not move, the
  // host-console counter must; the deck document must not change
  // and nothing may be broadcast to the room.
  const before = await poll(owner);
  const evBefore = before.editslides.version as number;
  const eaBefore = (before.editanswers?.version as number) ?? 0;
  const stateBefore = await deckState(id);
  const room = await watch(id, owner);
  // Let the connection's own hello/presence messages settle before
  // taking the baseline: only messages after this point could be
  // caused by the save.
  await sleep(500);
  const messagesBefore = room.messages.length;
  await write(`/${defId}/answer`, { slide, baseUpdated: 0 }, guest);
  await sleep(700);
  assert.equal(room.messages.length, messagesBefore);
  room.close();
  assert.equal(await deckState(id), stateBefore);
  const after = await poll(owner);
  assert.equal(after.editslides.version, evBefore);
  assert.equal(after.editanswers.version, eaBefore + 1);
  // Students never receive the answers overview.
  const studentPoll = await poll(guest);
  assert.deepEqual(studentPoll.editanswers?.editAnswers ?? [], []);

  // The overview is metadata only; content comes per answer.
  const meta = after.editanswers.editAnswers as any[];
  assert.equal(meta.length, 1);
  assert.equal(meta[0].answers.length, 1);
  assert.equal(meta[0].answers[0].author, await userId(guest));
  assert.ok(!JSON.stringify(meta).includes("elements"));
  const guestId = await userId(guest);
  const contentPath = `/${defId}/answers/${encodeURIComponent(guestId)}`;
  const content = await call(base + contentPath, "GET", undefined, owner);
  assert.equal(content.status, 200, await content.clone().text());
  assert.equal(
    ((await content.json()).slide as Slide).id,
    slide.id,
  );
  assert.equal(
    (await call(base + contentPath, "GET", undefined, guest)).status,
    200,
  );
  assert.equal(
    (await call(base + contentPath, "GET", undefined, guest2)).status,
    404,
  );
  // The second student has no answer of their own.
  const guest2View = (await list(guest2))[0];
  assert.equal(guest2View.mine, undefined);
  assert.equal(guest2View.answerCount, 1);

  // An answer photo, uploaded through the dedicated gate.
  const uploaded = await call(
    `${base}/${defId}/answer-assets`,
    "POST",
    EDIT_SLIDE_GIF,
    guest,
  );
  assert.equal(uploaded.status, 201, await uploaded.clone().text());
  const src = ((await uploaded.json()).src as string) ?? "";
  assert.ok(src.includes("/answer-assets/"));
  assert.equal(await usage(), usage0 + EDIT_SLIDE_GIF.length);
  const photoSlide: Slide = {
    ...slide,
    elements: [
      ...slide.elements,
      {
        id: "answer-photo",
        type: "image",
        x: 0,
        y: 0,
        w: 120,
        h: 90,
        src,
      } as Slide["elements"][number],
    ],
  };
  const mine = (await list(guest))[0].mine;
  await sleep(1600); // the rapid-save guard window
  await write(
    `/${defId}/answer`,
    { slide: photoSlide, baseUpdated: mine.updated },
    guest,
  );
  const photo = await call(src, "GET", undefined, owner);
  assert.equal(photo.status, 200);
  assert.deepEqual(
    Buffer.from(await photo.arrayBuffer()),
    EDIT_SLIDE_GIF,
  );
  assert.equal((await call(src, "GET", undefined, guest2)).status, 404);
  // The photo is not a deck asset.
  const assetId = src.split("/").pop();
  assert.equal(
    (await call(`/api/decks/${id}/assets/${assetId}`, "GET", undefined, owner))
      .status,
    404,
  );

  // The same bytes as a deck asset of another deck of the same
  // owner share one blob: storing them costs nothing extra, and
  // deleting that deck must not take the answer photo down.
  const assetUpload = await call(
    `/api/decks/${otherDeck}/assets`,
    "POST",
    EDIT_SLIDE_GIF,
    owner,
  );
  assert.equal(assetUpload.status, 201, await assetUpload.clone().text());
  assert.equal(await usage(), usage0 + EDIT_SLIDE_GIF.length);
  await call(`/api/decks/${otherDeck}/trash`, "POST", undefined, owner);
  assert.equal(
    (await call(`/api/decks/${otherDeck}`, "DELETE", undefined, owner))
      .status,
    200,
  );
  assert.equal((await call(src, "GET", undefined, owner)).status, 200);
  assert.equal(await usage(), usage0 + EDIT_SLIDE_GIF.length);

  // Feedback and send-backs (§4.3, stage 2a): closing the intake
  // stops saves; a send-back from the host re-opens saving for that
  // student alone, more than once, until they resubmit; feedback
  // rows reach only their owner (and the host) on the ef poll.
  const feedbackBase = `/api/decks/${id}/feedback`;
  const sendFeedback = async (
    value: unknown,
    who: string,
    status = 200,
  ) => {
    const r = await call(feedbackBase, "POST", value, who);
    assert.equal(r.status, status, await r.clone().text());
    return r;
  };
  const pollFeedback = async (who: string) => {
    const r = await call(
      `/api/decks/${id}/poll?ef=`,
      "GET",
      undefined,
      who,
    );
    assert.equal(r.status, 200, await r.clone().text());
    return ((await r.json()) as any).editfeedback.feedback as any[];
  };
  await write(`/${defId}/status`, { status: "closed" }, owner);
  const closedMine = (await list(guest)).find((d: any) => d.id === defId).mine;
  await write(
    `/${defId}/answer`,
    { slide: closedMine.slide, baseUpdated: closedMine.updated },
    guest,
    403,
  );
  // Students cannot send feedback; the host's send-back can.
  await sendFeedback(
    {
      targetKind: "editslide",
      targetId: defId,
      owner: guestId,
      text: "ここを直して",
      stamp: "",
      reopen: true,
    },
    guest,
    403,
  );
  const eaBeforeFeedback = (await poll(owner)).editanswers.version as number;
  const sentBack = await sendFeedback(
    {
      targetKind: "editslide",
      targetId: defId,
      owner: guestId,
      text: "ここを直して",
      stamp: "もう一歩",
      reopen: true,
    },
    owner,
  );
  // Sending feedback moves the host console's counter too, so the
  // cards' send-back / resubmitted flags refresh without a reload.
  assert.ok(
    ((await poll(owner)).editanswers.version as number) > eaBeforeFeedback,
  );
  assert.equal(((await sentBack.json()).feedback as any[]).length, 1);
  const guestFeedback = await pollFeedback(guest);
  assert.equal(guestFeedback.length, 1);
  assert.equal(guestFeedback[0].reopen, 1);
  assert.equal((await pollFeedback(guest2)).length, 0);
  // The sent-back student saves twice (rate limit spaced), the
  // other student still cannot save at all.
  const saveNow = async () => {
    const mine = (await list(guest)).find((d: any) => d.id === defId).mine;
    await write(
      `/${defId}/answer`,
      { slide: mine.slide, baseUpdated: mine.updated },
      guest,
    );
  };
  await sleep(1600);
  await saveNow();
  await sleep(1600);
  await saveNow();
  await write(
    `/${defId}/answer`,
    { slide: closedMine.slide, baseUpdated: 0 },
    guest2,
    403,
  );
  // Resubmitting closes the send-back: saves stop, and the host's
  // answer overview flags the resubmission.
  const eaBeforeResubmit = (await poll(owner)).editanswers.version as number;
  const resub = await call(
    `${feedbackBase}/resubmit`,
    "POST",
    { targetId: defId },
    guest,
  );
  assert.equal(resub.status, 200, await resub.clone().text());
  assert.ok(
    ((await poll(owner)).editanswers.version as number) > eaBeforeResubmit,
  );
  const afterResubmit = (await list(guest)).find((d: any) => d.id === defId)
    .mine;
  await write(
    `/${defId}/answer`,
    { slide: afterResubmit.slide, baseUpdated: afterResubmit.updated },
    guest,
    403,
  );
  const fbMeta = (await poll(owner)).editanswers.editAnswers.find(
    (m: any) => m.id === defId,
  );
  assert.equal(
    fbMeta.answers.find((a: any) => a.author === guestId).resubmitted,
    true,
  );
  // A plain comment arrives on the same counter and can be read.
  await sendFeedback(
    {
      targetKind: "editslide",
      targetId: defId,
      owner: guestId,
      text: "ありがとう",
      stamp: "よくできました",
    },
    owner,
  );
  const two = await pollFeedback(guest);
  assert.equal(two.length, 2);
  const read = await call(
    `${feedbackBase}/read`,
    "POST",
    { ids: two.map((f: any) => f.id) },
    guest,
  );
  assert.equal(read.status, 200, await read.clone().text());
  assert.ok(
    ((await read.json()).feedback as any[]).every((f) => f.readAt !== null),
  );

  // Removing the answer side frees the blob at last.
  await write(`/${defId}`, undefined, owner, 200, "DELETE");
  assert.equal((await call(src, "GET", undefined, owner)).status, 404);
  assert.equal(await usage(), usage0);

  // Deleting a whole deck with an answer photo returns the owner's
  // usage to where it started.
  const third = (
    await (
      await call("/api/decks", "POST", sample(), owner)
    ).json()
  ).id as string;
  const thirdSlide = await firstSlide(third);
  const thirdBase = `/api/decks/${third}/edit-slides`;
  const thirdCreated = await call(
    thirdBase,
    "POST",
    { source: thirdSlide.id, slide: thirdSlide },
    owner,
  );
  assert.equal(thirdCreated.status, 200, await thirdCreated.clone().text());
  const thirdDef = ((await thirdCreated.json()).editSlides as any[])[0]
    .id as string;
  await call(
    `${thirdBase}/${thirdDef}/status`,
    "POST",
    { status: "open" },
    owner,
  );
  const thirdUpload = await call(
    `${thirdBase}/${thirdDef}/answer-assets`,
    "POST",
    EDIT_SLIDE_GIF,
    owner,
  );
  assert.equal(thirdUpload.status, 201, await thirdUpload.clone().text());
  assert.equal(await usage(), usage0 + EDIT_SLIDE_GIF.length);
  await call(`/api/decks/${third}/trash`, "POST", undefined, owner);
  assert.equal(
    (await call(`/api/decks/${third}`, "DELETE", undefined, owner)).status,
    200,
  );
  assert.equal(await usage(), usage0);
}
