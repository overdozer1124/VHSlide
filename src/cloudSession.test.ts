import { describe, it, expect, vi, afterEach } from "vitest";
import {
  api,
  setSessionExpiredListener,
  SESSION_EXPIRED_MESSAGE,
  CloudWorkspace,
} from "./cloud";

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })),
  );
}

afterEach(() => {
  setSessionExpiredListener(undefined);
  vi.unstubAllGlobals();
});

describe("session expiry handling", () => {
  it("turns the session-required 401 into an expiry notice and notifies the listener", async () => {
    const listener = vi.fn();
    setSessionExpiredListener(listener);
    stubFetch(401, { error: "Googleアカウントでサインインしてください。" });
    await expect(api("/api/decks")).rejects.toThrow(SESSION_EXPIRED_MESSAGE);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("leaves other 401 messages untouched and does not notify", async () => {
    const listener = vi.fn();
    setSessionExpiredListener(listener);
    stubFetch(401, {
      error: "サインインし直すか、作品への参加権限を確認してください。",
    });
    await expect(api("/api/decks")).rejects.toThrow(
      "サインインし直すか、作品への参加権限を確認してください。",
    );
    expect(listener).not.toHaveBeenCalled();
  });

  it("leaves other errors untouched", async () => {
    stubFetch(413, { error: "写真の保存容量を超えています。" });
    await expect(api("/api/decks")).rejects.toThrow(
      "写真の保存容量を超えています。",
    );
  });

  it("drops the signed-in state when the session expires", () => {
    const workspace = new CloudWorkspace();
    workspace.user = { id: "u1", name: "先生", email: "t@example.test" };
    workspace.decks = [
      { id: "d1", title: "作品", owner: "u1", updated: 1 },
    ];
    (workspace as unknown as { expireSession: () => void }).expireSession();
    expect(workspace.user).toBeNull();
    expect(workspace.decks).toEqual([]);
    expect(workspace.error).toBe(SESSION_EXPIRED_MESSAGE);
    // A second call is a no-op once signed out.
    workspace.error = "";
    (workspace as unknown as { expireSession: () => void }).expireSession();
    expect(workspace.error).toBe("");
  });
});
