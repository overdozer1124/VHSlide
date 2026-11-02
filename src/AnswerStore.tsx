import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api } from "./cloud";
type Kind = "worksheet" | "survey";
export type AnswerPatch = Record<string, unknown>;
type Entry = {
  pending: AnswerPatch;
  latest: AnswerPatch;
  running: boolean;
  error: string;
  composing: boolean;
  timer?: ReturnType<typeof setTimeout>;
  attempt: number;
  immediate: boolean;
};
type Saved = { kind: Kind; data: any; version: number };
const Context = createContext({
  enabled: false,
  draft: (_kind: Kind, _id: string): AnswerPatch => ({}),
  change: (
    _kind: Kind,
    _id: string,
    _patch: AnswerPatch,
    _immediate = false,
  ) => {},
  flush: (_kind: Kind, _id: string) => {},
  compose: (_kind: Kind, _id: string, _active: boolean) => {},
  reconcile: (_kind: Kind, _ids: string[]) => {},
  status: (_kind: Kind, _id: string) => ({
    saving: false,
    dirty: false,
    error: "",
  }),
  saved: undefined as Saved | undefined,
});
export const useAnswers = () => useContext(Context);
export function AnswerProvider({
  deckId,
  userId,
  enabled,
  children,
}: {
  deckId?: string;
  userId?: string;
  enabled: boolean;
  children: ReactNode;
}) {
  return (
    <AnswerSession
      key={`${deckId}:${userId}:${enabled}`}
      {...{ deckId, userId, enabled }}
    >
      {children}
    </AnswerSession>
  );
}
function AnswerSession({
  deckId,
  userId,
  enabled,
  children,
}: {
  deckId?: string;
  userId?: string;
  enabled: boolean;
  children: ReactNode;
}) {
  const entries = useRef(new Map<string, Entry>());
  const alive = useRef(true);
  const version = useRef(0);
  const [, render] = useState(0);
  const [saved, setSaved] = useState<Saved>();
  const storageKey = `vhslide-answer-drafts:${deckId}:${userId}`;
  const active = enabled && !!deckId && !!userId;
  const key = (kind: Kind, id: string) => `${kind}/${id}`;
  function entry(kind: Kind, id: string) {
    const k = key(kind, id);
    let value = entries.current.get(k);
    if (!value) {
      value = {
        pending: {},
        latest: {},
        running: false,
        error: "",
        composing: false,
        attempt: 0,
        immediate: false,
      };
      entries.current.set(k, value);
    }
    return value;
  }
  function persist() {
    try {
      const data = Object.fromEntries(
        [...entries.current]
          .filter(([, e]) => Object.keys(e.pending).length)
          .map(([k, e]) => [k, e.pending]),
      );
      if (Object.keys(data).length)
        localStorage.setItem(storageKey, JSON.stringify(data));
      else localStorage.removeItem(storageKey);
    } catch {
      /* Server saving remains available when local storage is full. */
    }
  }
  function notify() {
    if (alive.current) render((n) => n + 1);
  }
  function schedule(kind: Kind, id: string, delay: number) {
    const e = entry(kind, id);
    clearTimeout(e.timer);
    if (active && !e.composing)
      e.timer = setTimeout(() => void send(kind, id), delay);
  }
  async function send(kind: Kind, id: string) {
    const e = entry(kind, id);
    clearTimeout(e.timer);
    if (
      !active ||
      !alive.current ||
      e.running ||
      e.composing ||
      !Object.keys(e.pending).length
    )
      return;
    const patch = structuredClone(e.pending);
    e.running = true;
    e.error = "";
    e.immediate = false;
    notify();
    try {
      const body =
        kind === "worksheet"
          ? { values: patch, patch: true }
          : {
              ...patch,
              ...(typeof patch.text === "string" &&
              !patch.text.trim() &&
              Array.isArray(patch.choices) &&
              !patch.choices.length
                ? { clear: true, text: "" }
                : {}),
            };
      const data = await api<any>(
        `/api/decks/${deckId}/${kind === "worksheet" ? "worksheets" : "surveys"}/${id}/answer`,
        { method: "POST", body: JSON.stringify(body) },
      );
      if (!alive.current) return;
      for (const k of Object.keys(patch))
        if (JSON.stringify(e.pending[k]) === JSON.stringify(patch[k]))
          delete e.pending[k];
      e.attempt = 0;
      setSaved({ kind, data, version: ++version.current });
    } catch (error) {
      if (!alive.current) return;
      e.error = (error as Error).message;
      e.attempt++;
      const status = (error as { status?: number }).status;
      if (!status || status === 429 || status >= 500)
        schedule(kind, id, Math.min(15000, 2000 * e.attempt));
    } finally {
      e.running = false;
      persist();
      notify();
      if (alive.current && Object.keys(e.pending).length && !e.error)
        schedule(kind, id, e.immediate ? 0 : 1000);
    }
  }
  function change(
    kind: Kind,
    id: string,
    patch: AnswerPatch,
    immediate = false,
  ) {
    if (!active) return;
    const e = entry(kind, id);
    e.pending = { ...e.pending, ...patch };
    e.latest = { ...e.latest, ...patch };
    e.error = "";
    e.immediate = immediate;
    persist();
    notify();
    schedule(kind, id, immediate ? 0 : 1000);
  }
  function flush(kind: Kind, id: string) {
    const e = entry(kind, id);
    e.immediate = true;
    void send(kind, id);
  }
  function compose(kind: Kind, id: string, on: boolean) {
    const e = entry(kind, id);
    e.composing = on;
    if (on) clearTimeout(e.timer);
    else schedule(kind, id, 1000);
  }
  function reconcile(kind: Kind, ids: string[]) {
    let changed = false;
    for (const id of ids) {
      const e = entries.current.get(key(kind, id));
      if (
        e &&
        !e.running &&
        !Object.keys(e.pending).length &&
        Object.keys(e.latest).length
      ) {
        e.latest = {};
        changed = true;
      }
    }
    if (changed) notify();
  }
  useEffect(() => {
    alive.current = true;
    if (active) {
      try {
        const cached = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
        for (const [k, v] of Object.entries(cached)) {
          const [kind, id] = k.split("/");
          if (
            ["worksheet", "survey"].includes(kind) &&
            /^[a-f0-9-]{36}$/.test(id) &&
            v &&
            typeof v === "object" &&
            !Array.isArray(v)
          ) {
            const e = entry(kind as Kind, id);
            e.pending = v as AnswerPatch;
            e.latest = { ...e.pending };
            schedule(kind as Kind, id, 1000);
          }
        }
        notify();
      } catch {
        /* A malformed local draft must not prevent opening the work. */
      }
    }
    const online = () => {
      for (const k of entries.current.keys()) {
        const [kind, id] = k.split("/");
        schedule(kind as Kind, id, 0);
      }
    };
    window.addEventListener("online", online);
    return () => {
      alive.current = false;
      for (const e of entries.current.values()) clearTimeout(e.timer);
      window.removeEventListener("online", online);
    };
  }, [active, storageKey]);
  const pending = [...entries.current.values()];
  const saving = pending.some((e) => e.running);
  const dirty = pending.some((e) => Object.keys(e.pending).length);
  const error = pending.find((e) => e.error)?.error;
  return (
    <Context.Provider
      value={{
        enabled: active,
        draft: (kind, id) => entries.current.get(key(kind, id))?.latest ?? {},
        change,
        flush,
        compose,
        reconcile,
        status: (kind, id) => {
          const e = entries.current.get(key(kind, id));
          return {
            saving: !!e?.running,
            dirty: !!e && !!Object.keys(e.pending).length,
            error: e?.error ?? "",
          };
        },
        saved,
      }}
    >
      {children}
      {active && (saving || dirty || saved) && (
        <div
          className={`answer-save-status ${error ? "error" : ""}`}
          role="status"
          aria-label="回答の保存状態"
        >
          {error
            ? `未保存：${error}`
            : saving
              ? "回答を保存中…"
              : dirty
                ? "回答を自動保存します…"
                : "回答は保存済みです"}
          {error && (
            <button
              onClick={() => {
                for (const k of entries.current.keys()) {
                  const [kind, id] = k.split("/");
                  flush(kind as Kind, id);
                }
              }}
            >
              再試行
            </button>
          )}
        </div>
      )}
    </Context.Provider>
  );
}
