import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ThinkingView } from "./thinkingTools";
import { api } from "./cloud";
import { useDeckPoller } from "./deckPoll";
export type ThinkingContextValue = {
  deckId?: string;
  userId?: string;
  enabled: boolean;
  host?: boolean;
  readOnly?: boolean;
  error: string;
  tools: ThinkingView[];
  refresh: () => Promise<ThinkingView[]>;
  update: (tools: ThinkingView[]) => void;
  /** Run one thinking command and adopt the server's fresh list. */
  command: (
    toolId: string | undefined,
    action: string | undefined,
    body?: Record<string, unknown>,
    method?: "POST" | "DELETE",
  ) => Promise<{ thinking: ThinkingView[]; createdId?: string }>;
};
export const ThinkingContext = createContext<ThinkingContextValue>({
  enabled: false,
  error: "",
  tools: [],
  refresh: async () => [],
  update: () => {},
  command: async () => ({ thinking: [] }),
});
export const useThinking = () => useContext(ThinkingContext);
export function ThinkingProvider({
  deckId,
  userId,
  host,
  blocked,
  pollActive = false,
  children,
}: {
  deckId?: string;
  userId?: string;
  host: boolean;
  blocked: boolean;
  pollActive?: boolean;
  children?: ReactNode;
}) {
  const scope = `${deckId}:${userId}:${host}:${blocked}`;
  return (
    <ThinkingSession
      key={scope}
      {...{ deckId, userId, host, blocked, pollActive }}
    >
      {children}
    </ThinkingSession>
  );
}
function ThinkingSession({
  deckId,
  userId,
  host,
  blocked,
  pollActive,
  children,
}: {
  deckId?: string;
  userId?: string;
  host: boolean;
  blocked: boolean;
  pollActive: boolean;
  children?: ReactNode;
}) {
  const [tools, setTools] = useState<ThinkingView[]>([]);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const generation = useRef(0);
  const enabled = !!deckId && !!userId && !blocked;
  const poller = useDeckPoller();
  function update(data: ThinkingView[]) {
    if (alive.current) {
      generation.current++;
      setTools(data);
    }
  }
  const listVersion = useRef<number | null>(null);
  const toolsRef = useRef<ThinkingView[]>([]);
  toolsRef.current = tools;
  async function refresh() {
    if (!enabled) return [];
    if (poller) {
      await poller.pollNow();
      return toolsRef.current;
    }
    const version = ++generation.current;
    const known = listVersion.current;
    const data = await api<{
      thinking?: ThinkingView[];
      version?: number;
      unchanged?: boolean;
    }>(
      `/api/decks/${deckId}/thinking?caps=board,steps,flow${known !== null ? `&v=${known}` : ""}`,
    );
    if (typeof data.version === "number") listVersion.current = data.version;
    if (data.unchanged) return toolsRef.current;
    const list = data.thinking ?? [];
    if (alive.current && version === generation.current) {
      setTools(list);
      setError("");
    }
    return list;
  }
  async function command(
    toolId: string | undefined,
    action: string | undefined,
    body: Record<string, unknown> = {},
    method: "POST" | "DELETE" = "POST",
  ) {
    const path = `/api/decks/${deckId}/thinking${toolId ? `/${toolId}` : ""}${action ? `/${action}` : ""}?caps=board,steps,flow`;
    const data = await api<{ thinking: ThinkingView[]; createdId?: string }>(
      path,
      method === "DELETE" ? { method } : { method, body: JSON.stringify(body) },
    );
    update(data.thinking);
    return data;
  }
  useEffect(() => {
    alive.current = true;
    if (!enabled || !poller) return;
    const off = poller.register("thinking", {
      guard: generation,
      onData: (p) => {
        if (!alive.current) return;
        const list = (p.thinking ?? []) as ThinkingView[];
        toolsRef.current = list;
        setTools(list);
        setError("");
      },
      onError: (e) => {
        if (alive.current) setError(e.message);
      },
    });
    return () => {
      alive.current = false;
      generation.current++;
      off();
    };
  }, [poller, enabled, deckId, userId]);
  // A thinking surface is live while it is on the displayed slide.
  useEffect(() => {
    poller?.setWant("thinking", pollActive ? 2500 : 20000);
  }, [poller, pollActive]);
  return (
    <ThinkingContext.Provider
      value={{
        deckId,
        userId,
        host,
        enabled,
        error,
        tools,
        refresh,
        update,
        command,
      }}
    >
      {children}
    </ThinkingContext.Provider>
  );
}
