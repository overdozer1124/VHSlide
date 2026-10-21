import * as Y from "yjs";
import { QuillBinding } from "y-quill";
import type { Deck } from "./model";
import { parseDeck, serializeDeck } from "./model";
import { cacheDocument, cachedDocument } from "./cloudCache";
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
  available = false;
  clientId = "";
  user: CloudUser | null = null;
  decks: CloudDeck[] = [];
  active?: { id: string; owner: string };
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
  private emit = () => this.onState();
  private offline = () => {
    clearTimeout(this.retry);
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
    this.connected = false;
    this.members = [];
    if (this.active) this.updateStatus();
  };
  private online = () => {
    clearTimeout(this.retry);
    if (this.active && !this.stopped) this.connect();
  };
  async initialize() {
    window.addEventListener("offline", this.offline);
    window.addEventListener("online", this.online);
    const generation = ++this.generation;
    try {
      const configResponse = await fetch("./api/config");
      if (!configResponse.ok) return;
      const config = await configResponse.json();
      if (generation !== this.generation) return;
      this.available = true;
      this.clientId = config.clientId || "";
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
      if (params.has("join") || params.has("room")) {
        this.panel = true;
        if (this.user) await this.openLocation();
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
      const result = await api<{ id: string }>(
        `/api/invites/${encodeURIComponent(params.get("join")!)}/accept`,
        { method: "POST" },
      );
      await this.open(result.id);
      await this.refresh();
    } else if (params.has("room")) await this.open(params.get("room")!);
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
  get needsAttention() {
    return this.stopped && !!this.active;
  }
  async open(id: string, discardPending = false) {
    if (this.active?.id === id && !discardPending) {
      this.panel = false;
      this.emit();
      return;
    }
    if (
      !discardPending &&
      this.active &&
      (!this.connected || this.pending.size || this.buffer.length)
    )
      throw new Error(
        "現在の作品の保存を待つか、JSONを保存してから開き直してください。",
      );
    const result = await api<{ id: string; owner: string; state: string }>(
      `/api/decks/${encodeURIComponent(id)}`,
    );
    // Load the text editor before declaring the workspace ready, so its first
    // use also works if the connection drops immediately after opening a work.
    await import("./CloudText");
    const doc = new Y.Doc();
    Y.applyUpdate(doc, fromBase64(result.state), "server");
    const cacheKey = `${this.user!.id}/${id}`;
    try {
      if (discardPending)
        await cacheDocument(cacheKey, Y.encodeStateAsUpdate(doc));
      else {
        const saved = await cachedDocument(cacheKey);
        if (saved) Y.applyUpdate(doc, saved, "server");
      }
    } catch {
      this.error =
        "端末の一時保存を使えません。授業の終わりにはJSONも保存してください。";
    }
    parseDeck(JSON.stringify(readSharedDeck(doc)));
    this.detach();
    this.active = { id: result.id, owner: result.owner };
    this.doc = doc;
    this.undoManager = new Y.UndoManager(
      [doc.getMap("slides"), doc.getText("title")],
      {
        trackedOrigins: new Set([LOCAL_CHANGE, QuillBinding]),
        captureTimeout: 400,
      },
    );
    this.undoManager.on("stack-item-added", this.emit);
    this.undoManager.on("stack-item-popped", this.emit);
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      this.onDeck(readSharedDeck(doc), false);
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
    url.searchParams.set("room", id);
    history.replaceState(null, "", url);
    this.panel = false;
    this.stopped = false;
    this.attempts = 0;
    this.connect();
    this.emit();
  }
  apply(before: Deck, next: Deck) {
    if (!this.doc) return next;
    applyDeckChange(this.doc, before, next);
    return {
      ...readSharedDeck(this.doc),
      rowSelections: next.rowSelections,
      linkedRows: next.linkedRows,
    };
  }
  private connect() {
    if (!this.active || !this.doc || this.stopped) return;
    if (!navigator.onLine) {
      this.updateStatus();
      return;
    }
    this.status = "接続中・端末に一時保存";
    this.emit();
    const doc = this.doc;
    const ws = new WebSocket(
      `${location.origin.replace(/^http/, "ws")}/api/decks/${this.active.id}/live`,
    );
    ws.binaryType = "arraybuffer";
    this.socket = ws;
    ws.onmessage = (event: MessageEvent) => {
      if (this.socket !== ws) return;
      try {
        if (typeof event.data !== "string") {
          Y.applyUpdate(doc, new Uint8Array(event.data), "server");
          if (!this.connected && this.vector) {
            this.buffer = [];
            this.pending.clear();
            this.connected = true;
            this.attempts = 0;
            const difference = Y.encodeStateAsUpdate(doc, this.vector);
            if (difference.length > 2) this.buffer.push(difference);
            this.flush();
          }
        } else {
          const message = JSON.parse(event.data);
          if (message.type === "hello")
            this.vector = fromBase64(message.vector);
          if (message.type === "ack") this.pending.delete(message.id);
          if (message.type === "presence") this.members = message.members;
          if (message.type === "error") {
            this.error = message.message;
            this.stopped = true;
          }
        }
        this.updateStatus();
      } catch {
        this.error =
          "共有データを読み込めませんでした。JSONを保存して作品を開き直してください。";
        this.stopped = true;
        ws.close();
        this.emit();
      }
    };
    ws.onclose = (event) => {
      if (this.socket !== ws) return;
      this.connected = false;
      this.members = [];
      if ([4001, 4002, 4003].includes(event.code)) {
        this.stopped = true;
        this.error ||=
          "共有への接続が終了しました。作品は端末にも一時保存されています。";
      }
      this.updateStatus();
      if (!this.stopped)
        this.retry = setTimeout(
          () => this.connect(),
          Math.min(30_000, 1000 * 2 ** this.attempts++),
        );
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
      this.socket.send(
        JSON.stringify({ type: "update", id, update: toBase64(update) }),
      );
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
      await api("/api/logout", { method: "POST" });
      this.detach();
      this.user = null;
      this.decks = [];
    });
  }
  detach() {
    const wasActive = !!this.active;
    clearTimeout(this.retry);
    clearTimeout(this.flushTimer);
    this.stopped = true;
    const ws = this.socket;
    this.socket = undefined;
    ws?.close();
    this.undoManager?.destroy();
    this.doc?.destroy();
    this.doc = undefined;
    this.undoManager = undefined;
    this.active = undefined;
    this.members = [];
    this.buffer = [];
    this.pending.clear();
    this.vector = undefined;
    this.connected = false;
    this.status = "";
    if (wasActive) {
      const url = new URL(location.href);
      url.searchParams.delete("room");
      history.replaceState(null, "", url);
    }
    this.emit();
  }
  dispose() {
    this.generation++;
    window.removeEventListener("offline", this.offline);
    window.removeEventListener("online", this.online);
    this.detach();
  }
}
