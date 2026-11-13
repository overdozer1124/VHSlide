import type { Deck } from "./model.ts";
export const FOLLOW_LEASE_MS = 45_000;
export type FollowTarget = {
  mode: "map" | "page";
  sheetId: string;
  pageId?: string;
};
export type FollowState =
  | { active: false; revision: number }
  | {
      active: true;
      revision: number;
      sessionId: string;
      controller: string;
      host: { id: string; name: string };
      startedAt: number;
      updatedAt: number;
      expiresAt: number;
      target: FollowTarget;
      pinned?: boolean;
      /** The host is in the presentation view: guests show the slide
       * alone, without any follow chrome. */
      presenting?: boolean;
    };
export const idleFollow = (revision = 0): FollowState => ({
  active: false,
  revision,
});
export class FollowError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export function followTarget(value: unknown, book: Deck): FollowTarget {
  const v = value as FollowTarget;
  if (
    !v ||
    !["map", "page"].includes(v.mode) ||
    typeof v.sheetId !== "string" ||
    !v.sheetId ||
    v.sheetId.length > 100 ||
    !(book.sheets ?? [{ id: "main" }]).some((s) => s.id === v.sheetId)
  )
    throw new FollowError(400, "追従先のシートが正しくありません。");
  if (
    v.pageId !== undefined &&
    (typeof v.pageId !== "string" ||
      v.pageId.length > 100 ||
      !book.slides.some(
        (s) => s.id === v.pageId && (s.sheetId ?? "main") === v.sheetId,
      ))
  )
    throw new FollowError(400, "追従先のページが見つかりません。");
  if (v.mode === "page" && !v.pageId)
    throw new FollowError(400, "追従先のページを指定してください。");
  return {
    mode: v.mode,
    sheetId: v.sheetId,
    ...(v.pageId === undefined ? {} : { pageId: v.pageId }),
  };
}
export function transitionFollow(
  current: FollowState,
  value: unknown,
  actor: {
    host: boolean;
    connection: string;
    user: { id: string; name: string };
  },
  book: Deck,
  now = Date.now(),
  sessionId: string = crypto.randomUUID(),
): FollowState {
  if (!actor.host)
    throw new FollowError(403, "追従を操作できるのはホストだけです。");
  const v = value as {
    id: string;
    action: string;
    sessionId?: string;
    target?: unknown;
    presenting?: unknown;
  };
  if (
    !v ||
    typeof v.id !== "string" ||
    !v.id ||
    v.id.length > 80 ||
    !["start", "move", "stop", "heartbeat", "pin", "resume"].includes(v.action)
  )
    throw new FollowError(400, "追従の通信形式が正しくありません。");
  if (v.action === "start") {
    if (current.active)
      throw new FollowError(
        409,
        "すでに追従中です。終了してから開始してください。",
      );
    return {
      active: true,
      revision: current.revision + 1,
      sessionId,
      controller: actor.connection,
      host: { id: actor.user.id, name: actor.user.name },
      startedAt: now,
      updatedAt: now,
      expiresAt: now + FOLLOW_LEASE_MS,
      target: followTarget(v.target, book),
      ...(v.presenting === true ? { presenting: true } : {}),
    };
  }
  if (!current.active || v.sessionId !== current.sessionId)
    throw new FollowError(
      409,
      "追従の状態が変わりました。現在の状態を確認してください。",
    );
  if (v.action === "stop") return idleFollow(current.revision + 1);
  if (actor.connection !== current.controller)
    throw new FollowError(409, "追従を開始した画面から操作してください。");
  if (v.action === "pin" && current.target.mode !== "page")
    throw new FollowError(400, "固定するスライドを表示してください。");
  return {
    ...current,
    revision: current.revision + 1,
    updatedAt: now,
    expiresAt: now + FOLLOW_LEASE_MS,
    pinned:
      v.action === "pin"
        ? true
        : v.action === "resume"
          ? false
          : current.pinned,
    target:
      v.action === "resume"
        ? followTarget(v.target, book)
        : v.action === "move" && !current.pinned
          ? followTarget(v.target, book)
          : current.target,
    ...(typeof v.presenting === "boolean"
      ? { presenting: v.presenting }
      : {}),
  };
}
export function publicFollow(state: FollowState) {
  if (!state.active) return state;
  const { controller: _, ...result } = state;
  return result;
}
export type PublicFollowState = ReturnType<typeof publicFollow>;
export function isPublicFollowState(
  value: unknown,
): value is PublicFollowState {
  const v = value as PublicFollowState;
  if (
    !v ||
    !Number.isSafeInteger(v.revision) ||
    v.revision < 0 ||
    typeof v.active !== "boolean"
  )
    return false;
  if (!v.active) return true;
  return (
    typeof v.sessionId === "string" &&
    v.sessionId.length <= 100 &&
    !!v.host &&
    typeof v.host.id === "string" &&
    typeof v.host.name === "string" &&
    !!v.target &&
    ["map", "page"].includes(v.target.mode) &&
    typeof v.target.sheetId === "string" &&
    (v.pinned === undefined || typeof v.pinned === "boolean") &&
    (v.presenting === undefined || typeof v.presenting === "boolean") &&
    (v.target.pageId === undefined || typeof v.target.pageId === "string") &&
    Number.isFinite(v.startedAt) &&
    Number.isFinite(v.updatedAt) &&
    Number.isFinite(v.expiresAt)
  );
}

export function expireFollow(
  state: FollowState,
  now = Date.now(),
): FollowState {
  return state.active &&
    (!Number.isFinite(state.expiresAt) || state.expiresAt <= now)
    ? idleFollow(state.revision + 1)
    : state;
}
