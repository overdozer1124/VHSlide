import { idleFollow, isPublicFollowState } from "./hostFollow";
import type { PublicFollowState, FollowTarget } from "./hostFollow";
import type { CloudSaveSnapshot } from "./saveState";
import { COLLABORATION_PROTOCOL } from "./collaborationProtocol.ts";
import type { JoinState } from "./joinRequests";
import { layoutState } from "./axes";
import {
  assertDeckAccess,
  canEdit,
  defaultAccess,
  hostAccess,
} from "./permissions";
import { emptyAccountLabels } from "./preSharing";
import type { AccountLabels, RowAccounts } from "./preSharing";
import type { EditAccess, SlideComment } from "./permissions";
import * as Y from "yjs";
import { QuillBinding } from "y-quill";
import type { Deck, Slide } from "./model";
import { serializeDeck } from "./model";
import {
  cacheDocument,
  cachedDocument,
  cachedRecovery,
  quarantineDocument,
  recoveryDocuments,
  acknowledgeRecovery,
} from "./cloudCache";
import type { CacheRecovery } from "./cloudCache";
import { serverDocument, mergeCachedDocument } from "./cloudDocument";
import {
  applyDeckChange,
  fromBase64,
  LOCAL_CHANGE,
  readSharedDeck,
  toBase64,
} from "./sharedDeck";

export interface CloudUser {
  id: string;
  name: string;
  email: string;
}
export interface CloudDeck {
  pendingRequests?: number;
  status?: string;
  id: string;
  title: string;
  owner: string;
  updated: number;
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(typeof options.body === "string"
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(value.error || "サーバーに接続できませんでした。");
  return value as T;
}
export async function portableDeck(deck: Deck): Promise<Deck> {
  const next = structuredClone(deck);
  const seen = new Map<string, string>();
  for (const slide of next.slides)
    for (const e of slide.elements)
      if (e.type === "image" && e.src?.startsWith("/api/decks/")) {
        if (!seen.has(e.src)) {
          const response = await fetch(`${e.src}?download=1`, {
            credentials: "same-origin",
          });
          if (!response.ok)
            throw new Error(
              "写真を取得できませんでした。接続と参加権限を確認してください。",
            );
          const blob = await response.blob();
          const data = await new Promise<string>((done, fail) => {
            const reader = new FileReader();
            reader.onload = () => done(String(reader.result));
            reader.onerror = fail;
            reader.readAsDataURL(blob);
          });
          seen.set(e.src, data);
        }
        e.src = seen.get(e.src)!;
      }
  serializeDeck(next);
  return next;
}

export class CloudWorkspace {
  follow: PublicFollowState = idleFollow();
  followError = "";
  private followDriver?: string;
  private followHeartbeat?: ReturnType<typeof setInterval>;
  private followWatchdog?: ReturnType<typeof setTimeout>;
  private followReceivedAt = 0;
  private followLiveness = () => {
    if (
      this.follow.active &&
      performance.now() - this.followReceivedAt >= 60_000
    ) {
      this.resetFollow();
      this.emit();
      this.reconnect(0);
    }
  };
  private armFollowLiveness() {
    clearTimeout(this.followWatchdog);
    this.followReceivedAt = performance.now();
    if (this.follow.active)
      this.followWatchdog = setTimeout(this.followLiveness, 60_100);
    if (this.drivesFollow && !this.followHeartbeat) {
      this.followHeartbeat = setInterval(() => {
        if (this.drivesFollow && this.followConnected)
          void this.followCommand("heartbeat").catch(() => {});
      }, 15_000);
    } else if (!this.drivesFollow) {
      clearInterval(this.followHeartbeat);
      this.followHeartbeat = undefined;
    }
  }
  private followRequests = new Map<
    string,
    {
      action: string;
      resolve: () => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  get followConnected() {
    return (
      this.connected &&
      !this.stopped &&
      this.socket?.readyState === WebSocket.OPEN
    );
  }
  get drivesFollow() {
    return this.follow.active && this.follow.sessionId === this.followDriver;
  }
  get followPending() {
    return [...this.followRequests.values()].some(
      (r) => !["move", "heartbeat"].includes(r.action),
    );
  }
  private resetFollow() {
    clearInterval(this.followHeartbeat);
    clearTimeout(this.followWatchdog);
    this.followHeartbeat = undefined;
    this.follow = idleFollow();
    this.followDriver = undefined;
    for (const r of this.followRequests.values()) {
      clearTimeout(r.timer);
      r.reject(new Error("追従の接続が終了しました。"));
    }
    this.followRequests.clear();
  }
  private followCommand(
    action: "start" | "move" | "stop" | "heartbeat",
    target?: FollowTarget,
  ): Promise<void> {
    if (
      !this.isHost ||
      !this.socket ||
      this.socket.readyState !== WebSocket.OPEN
    )
      return Promise.reject(new Error("ホストの接続を確認してください。"));
    this.flush();
    const id = crypto.randomUUID();
    this.followError = "";
    const promise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.followRequests.delete(id);
        this.followError = "追従の応答がありません。接続を確認してください。";
        this.emit();
        reject(new Error(this.followError));
      }, 8000);
      this.followRequests.set(id, { action, resolve, reject, timer });
      this.socket!.send(
        JSON.stringify({
          type: "follow-control",
          protocol: COLLABORATION_PROTOCOL,
          id,
          action,
          ...(this.follow.active ? { sessionId: this.follow.sessionId } : {}),
          ...(target ? { target } : {}),
        }),
      );
    });
    this.emit();
    return promise;
  }
  startFollow(target: FollowTarget) {
    return this.followCommand("start", target);
  }
  stopFollow() {
    return this.followCommand("stop");
  }
  moveFollow(target: FollowTarget) {
    return this.drivesFollow
      ? this.followCommand("move", target)
      : Promise.resolve();
  }
  available = false;
  clientId = "";
  schoolClientId = "";
  schoolDomain = "";
  user: CloudUser | null = null;
  decks: CloudDeck[] = [];
  active?: { id: string; owner: string };
  access: EditAccess = defaultAccess();
  private permissionDeck?: Deck;
  recoveryOnly = false;
  viewingRevoked = false;
  cacheRecovery?: {
    record: CacheRecovery;
    stored: boolean;
    dismissed: boolean;
  };
  async downloadCacheRecovery() {
    if (!this.cacheRecovery) return;
    const record = this.cacheRecovery.record;
    const data = JSON.stringify(
      {
        format: "vhslide-local-recovery",
        version: 1,
        created: record.created,
        documents: record.documents,
      },
      (_key, value) =>
        value instanceof Uint8Array
          ? { encoding: "base64", data: toBase64(value) }
          : value,
    );
    const url = URL.createObjectURL(
      new Blob([data], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `VHSlide-未送信データ-${new Date(record.created).toISOString().replace(/[:.]/g, "-")}.vhslide-recovery.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async dismissCacheRecovery() {
    const recovery = this.cacheRecovery;
    if (!recovery?.stored) return;
    await acknowledgeRecovery(recovery.record.id);
    if (this.cacheRecovery === recovery) {
      recovery.dismissed = true;
      this.emit();
    }
  }
  comments: SlideComment[] = [];
  rowAccounts: RowAccounts = {};
  accountLabels: AccountLabels = emptyAccountLabels();
  private rosterRequest = 0;
  private rosterTimer?: ReturnType<typeof setTimeout>;
  async refreshRowAccounts() {
    const id = this.active?.id,
      sequence = ++this.rosterRequest;
    if (!id) return;
    const data = await api<AccountLabels>(`/api/decks/${id}/row-accounts`);
    if (this.active?.id === id && sequence === this.rosterRequest) {
      this.rowAccounts = data.rows;
      this.accountLabels = { ...emptyAccountLabels(), ...data };
      this.emit();
    }
  }
  private scheduleRoster() {
    clearTimeout(this.rosterTimer);
    this.rosterTimer = setTimeout(
      () => void this.refreshRowAccounts().catch(() => {}),
      200,
    );
  }

  get isHost() {
    return !this.active || this.active.owner === this.user?.id;
  }
  canEdit(slide: Slide) {
    return (
      !this.active ||
      (!this.stopped &&
        (this.isHost ||
          canEdit(
            this.access,
            slide,
            this.doc
              ? (this.permissionDeck ??= readSharedDeck(this.doc))
              : undefined,
          )))
    );
  }
  private commentsRequest = 0;
  async refreshComments() {
    const sequence = ++this.commentsRequest;
    const id = this.active?.id;
    if (!id) return;
    const result = await api<{ comments: SlideComment[] }>(
      `/api/decks/${id}/comments`,
    );
    if (this.active?.id === id && sequence === this.commentsRequest) {
      this.comments = result.comments;
      this.emit();
    }
  }
  // Independent of the global busy flag: typing in one note must not drop
  // another note's save (or a simultaneous workspace operation).
  private noteWrites = new Set<Promise<unknown>>();
  private noteFlushers = new Map<
    () => Promise<void>,
    { room: string; user: string; id?: string }
  >();
  private noteRecoveries = new Map<
    () => Promise<void>,
    { room: string; user: string; id?: string }
  >();
  private noteDraftValues = new Map<
    string,
    { room: string; user: string; note: SlideComment }
  >();
  get pendingCommentDrafts() {
    return [...this.noteDraftValues.values()]
      .filter((v) => v.room === this.active?.id && v.user === this.user?.id)
      .map((v) => v.note);
  }
  draftComment(room: string, id: string) {
    const v = this.noteDraftValues.get(`${room}/${id}`);
    return v && v.user === this.user?.id ? v.note : undefined;
  }
  private noteDirty = new Map<string, { room: string; user: string }>();
  private noteRequests = new Map<
    string,
    { room: string; id: string; user: string; options: RequestInit }
  >();
  markNoteDraft(
    room: string,
    id: string,
    dirty: boolean,
    user = this.user?.id ?? "",
    value?: SlideComment,
  ) {
    const key = `${room}/${id}`;
    if (dirty && value)
      this.noteDraftValues.set(key, { room, user, note: { ...value } });
    if (!dirty) {
      const previous = this.noteDraftValues.get(key);
      if (
        value &&
        previous &&
        JSON.stringify([
          previous.note.text,
          previous.note.x,
          previous.note.y,
          previous.note.color,
          previous.note.w,
          previous.note.h,
        ]) !==
          JSON.stringify([
            value.text,
            value.x,
            value.y,
            value.color,
            value.w,
            value.h,
          ])
      )
        return;
      if (previous?.user === user) this.noteDraftValues.delete(key);
    }
    if (dirty) {
      if (this.noteDirty.get(key)?.user === user) return;
      this.noteDirty.set(key, { room, user });
    } else if (
      this.noteDirty.get(key)?.user !== user ||
      !this.noteDirty.delete(key)
    )
      return;
    this.emit();
  }
  retainNoteSave(
    room: string,
    save: () => Promise<void>,
    user = this.user?.id ?? "",
    id?: string,
  ) {
    if (
      [...this.noteFlushers].some(
        ([f, m]) =>
          f !== save && m.room === room && m.user === user && m.id === id,
      )
    )
      return;
    this.noteRecoveries.set(save, { room, user, id });
    this.emit();
  }
  releaseNoteSave(save: () => Promise<void>) {
    if (this.noteRecoveries.delete(save)) this.emit();
  }
  private activeNoteSaves() {
    const latest = new Map<string, () => Promise<void>>();
    for (const [save, m] of [...this.noteRecoveries, ...this.noteFlushers])
      if (m.room === this.active?.id && m.user === this.user?.id)
        latest.set(m.id ?? String(latest.size), save);
    return [...latest.values()];
  }
  hasNoteFailure(room: string, id: string) {
    const request = this.noteRequests.get(`${room}/${id}`);
    return !!request && request.user === this.user?.id;
  }
  async retryNoteSaves() {
    const results = await Promise.allSettled(
      this.activeNoteSaves().map(async (save) => {
        await save();
        this.releaseNoteSave(save);
      }),
    );
    const requests = [...this.noteRequests.values()].filter(
      (r) => r.room === this.active?.id && r.user === this.user?.id,
    );
    // Only retry DELETE requests directly. PUT always comes from the latest live/retained draft.
    for (const request of requests)
      if (request.options.method === "DELETE")
        await this.deleteComment(request.id, request.room);
    if (
      results.some((r) => r.status === "rejected") ||
      this.saveSnapshot.notesFailed ||
      this.saveSnapshot.notesDirty
    )
      throw new Error(
        "保存できていない付箋があります。接続・権限と付箋の内容を確認してください。この画面の未保存内容は再読み込みせずに残してください。",
      );
  }
  get saveSnapshot(): CloudSaveSnapshot {
    const notesDirty = [...this.noteDirty.values()].filter(
      (m) => m.room === this.active?.id && m.user === this.user?.id,
    ).length;
    return {
      document:
        this.recoveryOnly || (this.cacheRecovery && !this.cacheRecovery.stored)
          ? "recovery"
          : this.stopped
            ? "stopped"
            : !this.connected
              ? "reconnecting"
              : this.pending.size || this.buffer.length
                ? "saving"
                : "saved",
      notesSaving: this.noteWrites.size,
      notesFailed: [...this.noteRequests.values()].filter(
        (r) => r.room === this.active?.id && r.user === this.user?.id,
      ).length,
      notesDirty,
    };
  }
  registerNoteFlush(flush: () => Promise<void>, id?: string) {
    for (const [f, m] of this.noteRecoveries)
      if (m.room === this.active?.id && m.user === this.user?.id && m.id === id)
        this.noteRecoveries.delete(f);
    this.noteFlushers.set(flush, {
      room: this.active?.id ?? "",
      user: this.user?.id ?? "",
      id,
    });
    return () => {
      this.noteFlushers.delete(flush);
    };
  }
  async prepareBackup() {
    await Promise.all(
      this.activeNoteSaves().map(async (flush) => {
        await flush();
        this.releaseNoteSave(flush);
      }),
    );
    await Promise.all([...this.noteWrites]);
    if (!this.readyForBackupRestore)
      throw new Error(
        "未保存の変更や付箋があります。保存の完了を待つか、編集画面で付箋の保存を再試行してください。",
      );
  }
  private noteQueues = new Map<string, Promise<void>>();
  private async writeNote(deckId: string, id: string, options: RequestInit) {
    const key = `${deckId}/${id}`,
      actor = this.user?.id;
    const operation = (this.noteQueues.get(key) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (this.user?.id !== actor)
          throw new Error("アカウントが変わったため付箋の送信を停止しました。");
        await this.performNoteWrite(deckId, id, options);
      });
    this.noteQueues.set(key, operation);
    this.noteWrites.add(operation);
    this.emit();
    try {
      await operation;
    } finally {
      this.noteWrites.delete(operation);
      if (this.noteQueues.get(key) === operation) this.noteQueues.delete(key);
      this.emit();
    }
  }
  private async performNoteWrite(
    deckId: string,
    id: string,
    options: RequestInit,
  ) {
    const actor = this.user?.id ?? "";
    const key = `${deckId}/${id}`,
      write = api(`/api/decks/${deckId}/comments/${id}`, options);

    try {
      await write;
      this.noteRequests.delete(key);
      if (options.method === "DELETE") {
        if (this.noteDirty.get(key)?.user === actor) this.noteDirty.delete(key);
        if (this.noteDraftValues.get(key)?.user === actor)
          this.noteDraftValues.delete(key);
      }
    } catch (error) {
      this.noteRequests.set(key, {
        room: deckId,
        id,
        user: actor,
        options,
      });
      throw error;
    } finally {
      this.emit();
    }
    if (this.active?.id === deckId) await this.refreshComments();
  }
  async saveComment(deckId: string, note: SlideComment) {
    await this.writeNote(deckId, note.id, {
      method: "PUT",
      body: JSON.stringify(note),
    });
  }
  async deleteComment(id: string, deckId = this.active!.id) {
    const actor = this.user?.id;
    try {
      await this.writeNote(deckId, id, { method: "DELETE" });
    } catch (error) {
      if (this.user?.id !== actor) throw error;
      // A deletion response can be lost. Verify absence with the authorized list; never equate a failed request with success.
      const result = await api<{ comments: SlideComment[] }>(
        `/api/decks/${deckId}/comments`,
      );
      if (result.comments.some((note) => note.id === id)) throw error;
      const key = `${deckId}/${id}`;
      this.noteRequests.delete(key);
      this.noteDirty.delete(key);
      this.noteDraftValues.delete(key);
      if (this.active?.id === deckId) this.comments = result.comments;
      this.emit();
    }
  }
  doc?: Y.Doc;
  undoManager?: Y.UndoManager;
  members: { id: string; name: string }[] = [];
  status = "";
  panel = false;
  busy = false;
  error = "";
  notice = "";
  onState = () => {};
  onDeck = (_deck: Deck, _reset: boolean) => {};
  joinRequest?: {
    requestId: string;
    status: "pending" | "rejected" | "expired";
  };
  private joinTimer?: ReturnType<typeof setTimeout>;
  private checkingJoin = false;
  private socket?: WebSocket;
  private generation = 0;
  private retry?: ReturnType<typeof setTimeout>;
  private flushTimer?: ReturnType<typeof setTimeout>;
  private buffer: Uint8Array[] = [];
  private pending = new Set<string>();
  private vector?: Uint8Array;
  private connected = false;
  private stopped = false;
  private attempts = 0;
  private syncIntervalMs = 100;
  private connectionTimer?: ReturnType<typeof setTimeout>;
  private ackTimer?: ReturnType<typeof setTimeout>;
  private retryAt = 0;
  private recoverable = false;
  private connectionError = "";
  get canRetryConnection() {
    return !!this.active && this.recoverable && !this.recoveryOnly;
  }
  retryConnection() {
    if (!this.canRetryConnection) return;
    this.stopped = false;
    this.attempts = 0;
    this.reconnect();
  }
  private clearConnectionTimers() {
    clearTimeout(this.connectionTimer);
    clearTimeout(this.ackTimer);
    this.connectionTimer = this.ackTimer = undefined;
  }
  private healthyConnection() {
    this.attempts = 0;
    this.recoverable = false;
    this.retryAt = 0;
    if (this.error === this.connectionError) this.error = "";
    this.connectionError = "";
  }
  /** Keep the same Y.Doc and undo history. A server vector determines what to resend. */
  private reconnect(delay = 0) {
    clearTimeout(this.retry);
    this.clearConnectionTimers();
    const socket = this.socket;
    this.resetFollow();
    this.socket = undefined;
    socket?.close();
    this.connected = false;
    this.vector = undefined;
    this.members = [];
    this.recoverable = true;
    if (this.stopped || !this.active || !navigator.onLine) {
      this.updateStatus();
      return;
    }
    if (this.attempts >= 6) {
      this.stopped = true;
      this.error = this.connectionError =
        "再接続を繰り返しましたが保存できません。接続を再試行するか、JSONを保存してください。";
      this.updateStatus();
      return;
    }
    this.retryAt = Math.max(
      this.retryAt,
      Date.now() + delay,
      Date.now() + Math.min(30_000, 1000 * 2 ** this.attempts++),
    );
    this.retry = setTimeout(
      () => this.connect(),
      Math.max(0, this.retryAt - Date.now()),
    );
    this.updateStatus();
  }
  private emit = () => this.onState();
  private offline = () => {
    this.resetFollow();
    clearTimeout(this.retry);
    this.clearConnectionTimers();
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
    this.connected = false;
    this.members = [];
    if (this.active) this.updateStatus();
  };
  private online = () => {
    clearTimeout(this.retry);
    if (this.active && !this.stopped) this.reconnect();
  };
  async initialize() {
    window.addEventListener("offline", this.offline);
    window.addEventListener("online", this.online);
    document.addEventListener("visibilitychange", this.followLiveness);
    const generation = ++this.generation;
    try {
      const configResponse = await fetch("./api/config");
      if (!configResponse.ok) return;
      const config = await configResponse.json();
      if (generation !== this.generation) return;
      this.available = true;
      this.clientId = config.clientId || "";
      this.schoolClientId = config.schoolClientId || "";
      this.schoolDomain = config.schoolDomain || "";
      this.notice = typeof config.notice === "string" ? config.notice : "";
      if (Number.isFinite(config.syncIntervalMs))
        this.syncIntervalMs = Math.max(
          100,
          Math.min(2000, config.syncIntervalMs),
        );
      this.user = (await api<{ user: CloudUser | null }>("/api/session")).user;
      if (generation !== this.generation) return;
      await this.refresh();
      const params = new URLSearchParams(location.search);
      if (params.has("join") || params.has("room") || params.has("request")) {
        if (this.user) {
          // Restoring a signed-in workspace must not open a dialog while its
          // document, editor module or local cache is still loading.
          try {
            await this.openLocation();
          } catch (error) {
            this.error = (error as Error).message;
            this.panel = true;
          }
        } else this.panel = true;
      }
      this.emit();
    } catch {
      /* Static/offline editing remains available without a server. */
    } finally {
      if (generation === this.generation) this.emit();
    }
  }
  async refresh() {
    this.decks = this.user
      ? (await api<{ decks: CloudDeck[] }>("/api/decks")).decks
      : [];
    this.emit();
  }
  async signIn(credential: string) {
    await this.run(async () => {
      this.user = (
        await api<{ user: CloudUser }>("/api/auth/google", {
          method: "POST",
          body: JSON.stringify({ credential }),
        })
      ).user;
      await this.refresh();
      await this.openLocation();
    });
  }
  private async openLocation() {
    const params = new URLSearchParams(location.search);
    if (params.has("join")) {
      const result = await api<JoinState>(
        `/api/invites/${encodeURIComponent(params.get("join")!)}/accept`,
        { method: "POST" },
      );
      if (result.status === "approved") {
        await this.open(result.id);
        await this.refresh();
      } else if (result.status === "pending" || result.status === "rejected") {
        this.joinRequest = {
          requestId: result.requestId,
          status: result.status,
        };
        this.panel = true;
        const url = new URL(location.href);
        url.searchParams.delete("join");
        url.searchParams.delete("room");
        url.searchParams.set("request", result.requestId);
        history.replaceState(null, "", url);
        this.scheduleJoin();
        this.emit();
      }
    } else if (params.has("request")) {
      this.joinRequest = {
        requestId: params.get("request")!,
        status: "pending",
      };
      this.panel = true;
      await this.refreshJoinRequest();
    } else if (params.has("room")) await this.open(params.get("room")!);
  }
  private scheduleJoin() {
    clearTimeout(this.joinTimer);
    if (this.joinRequest?.status !== "pending") return;
    this.joinTimer = setTimeout(() => {
      if (this.panel && document.visibilityState === "visible")
        void this.refreshJoinRequest();
      else this.scheduleJoin();
    }, 5000);
  }
  async refreshJoinRequest() {
    const waiting = this.joinRequest,
      user = this.user?.id;
    if (!waiting || !user || this.checkingJoin) return;
    this.checkingJoin = true;
    try {
      const result = await api<JoinState>(
        `/api/join-requests/${encodeURIComponent(waiting.requestId)}`,
      );
      if (
        this.user?.id !== user ||
        this.joinRequest?.requestId !== waiting.requestId
      )
        return;
      if (result.status === "approved") {
        if (this.panel) {
          await this.open(result.id);
          await this.refresh();
        }
      } else {
        this.joinRequest = {
          requestId: waiting.requestId,
          status: result.status,
        };
        this.error = "";
        this.emit();
      }
    } catch (error) {
      if (this.joinRequest?.requestId === waiting.requestId) {
        this.error = (error as Error).message;
        this.emit();
      }
    } finally {
      this.checkingJoin = false;
      this.scheduleJoin();
    }
  }

  async run(action: () => Promise<void>) {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    this.emit();
    try {
      await action();
    } catch (error) {
      this.error = (error as Error).message;
    } finally {
      this.busy = false;
      this.emit();
    }
  }
  async create(deck: Deck) {
    await this.run(async () => {
      if (
        this.active &&
        (!this.connected || this.pending.size || this.buffer.length)
      )
        throw new Error(
          "現在の作品の保存が完了してからコピーを作ってください。",
        );
      const portable = await portableDeck(deck);
      const result = await api<{ id: string }>("/api/decks", {
        method: "POST",
        body: serializeDeck(portable),
      });
      try {
        localStorage.setItem(
          `vhslide-cloud-deck:${result.id}`,
          JSON.stringify(deck),
        );
      } catch {
        /* The document still lives on the server. */
      }
      await this.open(result.id);
      await this.refresh();
    });
  }
  get readyForBackupRestore() {
    return (
      !this.active ||
      (this.connected &&
        !this.stopped &&
        !this.pending.size &&
        !this.buffer.length &&
        !this.noteWrites.size &&
        !this.saveSnapshot.notesDirty &&
        !this.saveSnapshot.notesFailed)
    );
  }
  get needsAttention() {
    return this.stopped && !!this.active;
  }
  async open(id: string, discardPending = false) {
    const blockedCache =
      this.active?.id === id &&
      this.cacheRecovery &&
      !this.cacheRecovery.stored;
    if (blockedCache) discardPending = false;
    const retained = blockedCache ? this.cacheRecovery!.record.documents : [];
    if (this.active?.id === id && !discardPending && !blockedCache) {
      this.panel = false;
      this.emit();
      return;
    }
    if (
      !discardPending &&
      this.active &&
      (!this.connected || this.pending.size || this.buffer.length) &&
      !(blockedCache && !this.pending.size && !this.buffer.length)
    )
      throw new Error(
        "現在の作品の保存を待つか、JSONを保存してから開き直してください。",
      );
    if (
      this.active &&
      !discardPending &&
      !blockedCache &&
      (this.saveSnapshot.notesDirty ||
        this.saveSnapshot.notesFailed ||
        this.noteWrites.size)
    )
      await this.prepareBackup();
    const result = await api<{
      id: string;
      owner: string;
      state: string;
      access: EditAccess;
    }>(`/api/decks/${encodeURIComponent(id)}`);
    // The shared/local text editor is part of the application module graph,
    // so opening a cloud work never depends on a later editor chunk fetch.
    let doc = serverDocument(result.state);
    const cacheKey = `${this.user!.id}/${id}`;
    let legacyLayout = false;
    let recovery: CloudWorkspace["cacheRecovery"];
    let cacheWritable = true;
    try {
      if (discardPending)
        await cacheDocument(cacheKey, Y.encodeStateAsUpdate(doc));
      else {
        const saved = await cachedDocument(cacheKey);
        if (saved) {
          const originalLayout = layoutState(readSharedDeck(doc));
          try {
            const merged = mergeCachedDocument(doc, saved.data);
            doc.destroy();
            doc = merged;
            legacyLayout =
              saved.protocol !== COLLABORATION_PROTOCOL &&
              originalLayout !== layoutState(readSharedDeck(doc));
          } catch {
            try {
              const record = await quarantineDocument(
                cacheKey,
                saved,
                Y.encodeStateAsUpdate(doc),
                retained,
              );
              recovery = { record, stored: true, dismissed: false };
            } catch {
              cacheWritable = false;
              recovery = {
                record: {
                  id: "",
                  created: Date.now(),
                  documents: recoveryDocuments([...retained, saved]),
                },
                stored: false,
                dismissed: false,
              };
            }
          }
        }
      }
      if (!recovery) {
        const record = await cachedRecovery(cacheKey);
        if (record)
          recovery = { record, stored: true, dismissed: !!record.acknowledged };
      }
    } catch {
      cacheWritable = false;
      this.error =
        "端末の一時保存を使えません。授業の終わりにはJSONも保存してください。";
    }
    this.detach();
    this.cacheRecovery = recovery;
    this.active = { id: result.id, owner: result.owner };
    this.access =
      result.owner === this.user?.id
        ? hostAccess()
        : (result.access ?? defaultAccess());
    this.doc = doc;
    this.undoManager = new Y.UndoManager(
      [
        doc.getMap("slides"),
        doc.getMap("sheets"),
        doc.getMap("routes"),
        doc.getText("title"),
      ],
      {
        // Only this browser's UI/Quill edits enter its history. Remote updates
        // arrive with the "server" origin and must never be undoable here.
        trackedOrigins: new Set([LOCAL_CHANGE, QuillBinding]),
        captureTimeout: 400,
      },
    );
    this.undoManager.on("stack-item-added", this.emit);
    this.undoManager.on("stack-item-popped", this.emit);
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      this.permissionDeck = readSharedDeck(doc);
      this.onDeck(this.permissionDeck, false);
      if (cacheWritable)
        void cacheDocument(cacheKey, Y.encodeStateAsUpdate(doc)).catch(() => {
          this.error = "端末に一時保存できません。JSONも保存してください。";
          this.emit();
        });
      if (origin !== "server") {
        this.buffer.push(update);
        clearTimeout(this.flushTimer);
        this.flushTimer = setTimeout(() => this.flush(), this.syncIntervalMs);
      }
      this.emit();
    });
    this.onDeck(readSharedDeck(doc), true);
    const url = new URL(location.href);
    url.searchParams.delete("join");
    url.searchParams.delete("request");
    url.searchParams.set("room", id);
    history.replaceState(null, "", url);
    this.panel = false;
    this.stopped = legacyLayout || !!(recovery && !recovery.stored);
    this.recoveryOnly = legacyLayout;
    this.attempts = 0;
    if (legacyLayout) {
      this.error =
        "旧版の未送信の配置変更を端末から復元しました。自動送信は停止しています。JSONを保存し、作品一覧からクラウドの内容を開き直してください。";
      this.updateStatus();
    } else if (recovery && !recovery.stored) {
      this.error =
        "端末の一時保存を退避できないため、クラウドの保存済み内容を読み取り専用で表示しています。復旧用データを保存し、保護を再試行してください。";
      this.updateStatus();
    } else this.connect();
    void this.refreshComments().catch(() => {});
    this.emit();
  }
  apply(before: Deck, next: Deck) {
    if (!this.doc) return next;
    if (this.stopped)
      throw new Error(
        "共有停止中です。JSONを保存してから作品を開き直してください。",
      );
    assertDeckAccess(before, next, this.access, this.isHost);
    applyDeckChange(this.doc, before, next);
    return {
      ...readSharedDeck(this.doc),
      rowSelections: next.rowSelections,
      linkedRows: next.linkedRows,
      activeSheetId: next.activeSheetId,
    };
  }
  private connect() {
    if (!this.active || !this.doc || this.stopped) return;
    if (!navigator.onLine) {
      this.updateStatus();
      return;
    }
    clearTimeout(this.retry);
    this.clearConnectionTimers();
    const oldSocket = this.socket;
    this.socket = undefined;
    oldSocket?.close();
    this.connected = false;
    this.vector = undefined;
    this.status = "接続中・端末に一時保存";
    this.emit();
    const doc = this.doc;
    const ws = new WebSocket(
      `${location.origin.replace(/^http/, "ws")}/api/decks/${this.active.id}/live`,
    );
    ws.binaryType = "arraybuffer";
    this.socket = ws;
    this.connectionTimer = setTimeout(() => {
      if (this.socket !== ws) return;
      this.error = this.connectionError =
        "接続の応答がないため再接続しています。変更は端末に保持しています。";
      this.reconnect();
    }, 20_000);
    ws.onmessage = (event: MessageEvent) => {
      if (this.socket !== ws) return;
      try {
        if (typeof event.data !== "string") {
          Y.applyUpdate(doc, new Uint8Array(event.data), "server");
          if (!this.connected && this.vector) {
            clearTimeout(this.connectionTimer);
            this.connectionTimer = undefined;
            this.buffer = [];
            this.pending.clear();
            this.connected = true;
            void this.refreshComments().catch(() => {});
            const difference = Y.encodeStateAsUpdate(doc, this.vector);
            if (difference.length > 2) this.buffer.push(difference);
            else this.healthyConnection();
            this.flush();
          }
        } else {
          const message = JSON.parse(event.data);
          if (
            message.type === "follow-state" &&
            isPublicFollowState(message.state)
          ) {
            if (message.state.revision >= this.follow.revision)
              this.follow = message.state;
            const request = this.followRequests.get(message.requestId);
            if (request) {
              clearTimeout(request.timer);
              this.followRequests.delete(message.requestId);
              if (request.action === "start" && message.state.active)
                this.followDriver = message.state.sessionId;
              if (request.action === "stop") this.followDriver = undefined;
              request.resolve();
            }
            if (!this.follow.active) this.followDriver = undefined;
            this.armFollowLiveness();
          }
          if (message.type === "follow-error") {
            this.followError =
              typeof message.message === "string"
                ? message.message
                : "追従を操作できませんでした。";
            const request = this.followRequests.get(message.requestId);
            if (request) {
              clearTimeout(request.timer);
              this.followRequests.delete(message.requestId);
              request.reject(new Error(this.followError));
            }
          }
          if (message.type === "access") {
            this.access = message.access;
            this.undoManager?.clear();
            this.onDeck(readSharedDeck(doc), false);
          }
          if (message.type === "comments")
            void this.refreshComments().catch(() => {});
          if (message.type === "hello") {
            if (message.protocol !== COLLABORATION_PROTOCOL) {
              this.error =
                "サーバーと画面の更新が揃っていません。JSONを保存し、更新後に開き直してください。";
              this.stopped = true;
              this.recoverable = false;
              this.clearConnectionTimers();
              ws.close();
            } else this.vector = fromBase64(message.vector);
          }
          if (
            message.type === "ack" &&
            this.pending.delete(message.id) &&
            !this.pending.size
          ) {
            clearTimeout(this.ackTimer);
            this.ackTimer = undefined;
            this.healthyConnection();
          }
          if (message.type === "presence") {
            this.members = message.members;
            this.scheduleRoster();
          }
          if (message.type === "roster") this.scheduleRoster();
          if (message.type === "error") {
            this.error = message.message;
            if (message.code === "authentication") this.viewingRevoked = true;
            if (
              message.retryable === true &&
              ["rate_limited", "temporarily_unavailable"].includes(message.code)
            ) {
              this.connectionError = this.error;
              const delay = Number.isFinite(message.retryAfterMs)
                ? Math.max(1000, Math.min(60_000, message.retryAfterMs))
                : 1000;
              this.reconnect(delay);
              return;
            }
            this.recoverable = false;
            this.stopped = true;
            this.clearConnectionTimers();
            ws.close();
          }
        }
        this.updateStatus();
      } catch {
        this.error =
          "共有データを読み込めませんでした。JSONを保存して作品を開き直してください。";
        this.stopped = true;
        this.recoverable = false;
        this.clearConnectionTimers();
        ws.close();
        this.emit();
      }
    };
    ws.onclose = (event) => {
      if (this.socket !== ws) return;
      this.clearConnectionTimers();
      this.connected = false;
      this.resetFollow();
      this.members = [];
      if (event.code === 4004 && this.active) {
        const id = this.active.id;
        this.error = "権限の変更に合わせて、クラウドの内容を読み直しています。";
        void this.open(id, true).catch(() => {
          this.stopped = true;
          this.error = "権限を確認して作品を開き直してください。";
          this.emit();
        });
        return;
      }
      if ([4001, 4002, 4003].includes(event.code)) {
        if (event.code === 4001 || event.code === 4003)
          this.viewingRevoked = true;
        this.stopped = true;
        this.recoverable = false;
        this.error ||=
          "共有への接続が終了しました。作品は端末にも一時保存されています。";
      }
      this.updateStatus();
      if (!this.stopped) this.reconnect();
    };
    ws.onerror = () => {};
  }
  private flush() {
    if (
      this.connected &&
      this.socket?.readyState === WebSocket.OPEN &&
      this.buffer.length &&
      !this.stopped
    ) {
      const id = crypto.randomUUID(),
        update = Y.mergeUpdates(this.buffer);
      this.buffer = [];
      this.pending.add(id);
      try {
        this.socket.send(
          JSON.stringify({
            type: "update",
            protocol: COLLABORATION_PROTOCOL,
            id,
            update: toBase64(update),
          }),
        );
        if (this.ackTimer === undefined)
          this.ackTimer = setTimeout(() => {
            this.ackTimer = undefined;
            if (!this.pending.size || this.stopped) return;
            this.error = this.connectionError =
              "保存の応答がないため再接続しています。変更は端末に保持しています。";
            this.reconnect();
          }, 20_000);
      } catch {
        this.error = this.connectionError =
          "送信できなかったため再接続しています。変更は端末に保持しています。";
        this.reconnect();
      }
    }
    this.updateStatus();
  }
  private updateStatus() {
    this.status = this.stopped
      ? "共有停止・JSONを保存してください"
      : !this.connected
        ? "再接続中・端末に一時保存"
        : this.pending.size || this.buffer.length
          ? "クラウドに保存中"
          : "クラウドに保存済み";
    this.emit();
  }
  async upload(file: File, roomId: string) {
    return (
      await api<{ src: string }>(`/api/decks/${roomId}/assets`, {
        method: "POST",
        body: file,
      })
    ).src;
  }
  async signOut() {
    await this.run(async () => {
      if (
        this.active &&
        (!this.connected || this.pending.size || this.buffer.length)
      )
        throw new Error(
          "保存の完了を待つか、先にJSONファイルを保存してください。",
        );
      if (
        this.active &&
        (this.saveSnapshot.notesDirty ||
          this.saveSnapshot.notesFailed ||
          this.noteWrites.size)
      )
        await this.prepareBackup();
      await api("/api/logout", { method: "POST" });
      this.detach();
      this.user = null;
      this.decks = [];
    });
  }
  detach() {
    this.resetFollow();
    const wasActive = !!this.active || !!this.joinRequest;
    clearTimeout(this.joinTimer);
    this.joinRequest = undefined;
    clearTimeout(this.retry);
    clearTimeout(this.flushTimer);
    this.clearConnectionTimers();
    this.retryAt = 0;
    this.recoverable = false;
    this.connectionError = "";
    this.stopped = true;
    const ws = this.socket;
    this.socket = undefined;
    ws?.close();
    this.undoManager?.destroy();
    this.doc?.destroy();
    this.doc = undefined;
    this.permissionDeck = undefined;
    this.recoveryOnly = false;
    this.viewingRevoked = false;
    this.cacheRecovery = undefined;
    this.undoManager = undefined;
    this.active = undefined;
    this.access = defaultAccess();
    this.commentsRequest++;
    this.rosterRequest++;
    clearTimeout(this.rosterTimer);
    this.rowAccounts = {};
    this.accountLabels = emptyAccountLabels();
    this.comments = [];
    this.members = [];
    this.buffer = [];
    this.pending.clear();
    this.vector = undefined;
    this.connected = false;
    this.status = "";
    if (wasActive) {
      const url = new URL(location.href);
      url.searchParams.delete("room");
      url.searchParams.delete("request");
      url.searchParams.delete("join");
      history.replaceState(null, "", url);
    }
    this.emit();
  }
  dispose() {
    this.generation++;
    window.removeEventListener("offline", this.offline);
    window.removeEventListener("online", this.online);
    document.removeEventListener("visibilitychange", this.followLiveness);
    this.detach();
  }
}
