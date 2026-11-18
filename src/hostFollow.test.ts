import { describe, it, expect } from "vitest";
import {
  idleFollow,
  transitionFollow,
  publicFollow,
  isPublicFollowState,
  FollowError,
} from "./hostFollow";
import { sample } from "./model";

const book = sample();
const actor = {
  host: true,
  connection: "socket-a",
  user: { id: "owner", name: "先生" },
};
const target = {
  mode: "thinking",
  sheetId: "main",
  pageId: book.slides[0].id,
};
const share = { toolId: "tool-1", owner: "student-9", showNames: false };

describe("follow thinking share (stage 4c)", () => {
  it("keeps the share server-side and stamps a public share id", () => {
    const running = transitionFollow(
      idleFollow(),
      { id: "a", action: "start", target, share },
      actor,
      book,
    );
    expect(running.active).toBe(true);
    if (!running.active) throw new Error("not active");
    expect(running.share).toEqual(share);
    expect(running.target.shareId).toBeTruthy();
    const pub = publicFollow(running);
    expect(JSON.stringify(pub)).not.toContain("student-9");
    expect(JSON.stringify(pub)).not.toContain("tool-1");
    expect(isPublicFollowState(pub)).toBe(true);
    // A heartbeat keeps the same share and share id.
    const beat = transitionFollow(
      running,
      { id: "b", action: "heartbeat", sessionId: running.sessionId },
      actor,
      book,
    );
    if (!beat.active) throw new Error("not active");
    expect(beat.share).toEqual(share);
    expect(beat.target.shareId).toBe(running.target.shareId);
    // Stopping clears everything.
    const stopped = transitionFollow(
      beat,
      { id: "c", action: "stop", sessionId: running.sessionId },
      actor,
      book,
    );
    expect(stopped.active).toBe(false);
  });
  it("rotates the share id when the chart changes and drops it for other modes", () => {
    const running = transitionFollow(
      idleFollow(),
      { id: "a", action: "start", target, share },
      actor,
      book,
    );
    if (!running.active) throw new Error("not active");
    const moved = transitionFollow(
      running,
      {
        id: "b",
        action: "move",
        sessionId: running.sessionId,
        target,
        share: { ...share, owner: "student-7" },
      },
      actor,
      book,
    );
    if (!moved.active) throw new Error("not active");
    expect(moved.share?.owner).toBe("student-7");
    expect(moved.target.shareId).not.toBe(running.target.shareId);
    const paged = transitionFollow(
      moved,
      {
        id: "c",
        action: "move",
        sessionId: running.sessionId,
        target: { mode: "page", sheetId: "main", pageId: book.slides[0].id },
      },
      actor,
      book,
    );
    if (!paged.active) throw new Error("not active");
    expect(paged.share).toBeUndefined();
    expect(paged.target.shareId).toBeUndefined();
  });
  it("rejects a thinking target without a valid share", () => {
    expect(() =>
      transitionFollow(
        idleFollow(),
        { id: "a", action: "start", target },
        actor,
        book,
      ),
    ).toThrow(FollowError);
    expect(() =>
      transitionFollow(
        idleFollow(),
        {
          id: "a",
          action: "start",
          target,
          share: { toolId: "tool-1", owner: "x", showNames: "yes" },
        },
        actor,
        book,
      ),
    ).toThrow(FollowError);
  });
});
