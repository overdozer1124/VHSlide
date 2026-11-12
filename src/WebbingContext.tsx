import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { WebbingView } from "./webbing";
import { api } from "./cloud";
import { usePageVisible } from "./usePageVisible";
export type WebbingContextValue = {
  deckId?: string;
  userId?: string;
  enabled: boolean;
  host?: boolean;
  readOnly?: boolean;
  error: string;
  maps: WebbingView[];
  refresh: () => Promise<WebbingView[]>;
  update: (maps: WebbingView[]) => void;
  /** Run one webbing command and adopt the server's fresh list. */
  command: (
    mapId: string | undefined,
    action: string | undefined,
    body?: Record<string, unknown>,
    method?: "POST" | "DELETE",
  ) => Promise<{ webbing: WebbingView[]; createdId?: string }>;
};
export const WebbingContext = createContext<WebbingContextValue>({
  enabled: false,
  error: "",
  maps: [],
  refresh: async () => [],
  update: () => {},
  command: async () => ({ webbing: [] }),
});
export const useWebbing = () => useContext(WebbingContext);
export function WebbingProvider({
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
    <WebbingSession
      key={scope}
      {...{ deckId, userId, host, blocked, pollActive }}
    >
      {children}
    </WebbingSession>
  );
}
function WebbingSession({
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
  const [maps, setMaps] = useState<WebbingView[]>([]);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const generation = useRef(0);
  const enabled = !!deckId && !!userId && !blocked;
  const visible = usePageVisible();
  function update(data: WebbingView[]) {
    if (alive.current) {
      generation.current++;
      setMaps(data);
    }
  }
  async function refresh() {
    if (!enabled) return [];
    const version = ++generation.current;
    const data = await api<{ webbing: WebbingView[] }>(
      `/api/decks/${deckId}/webbing`,
    );
    if (alive.current && version === generation.current) {
      setMaps(data.webbing);
      setError("");
    }
    return data.webbing;
  }
  async function command(
    mapId: string | undefined,
    action: string | undefined,
    body: Record<string, unknown> = {},
    method: "POST" | "DELETE" = "POST",
  ) {
    const path = `/api/decks/${deckId}/webbing${mapId ? `/${mapId}` : ""}${action ? `/${action}` : ""}`;
    const data = await api<{ webbing: WebbingView[]; createdId?: string }>(
      path,
      method === "DELETE" ? { method } : { method, body: JSON.stringify(body) },
    );
    update(data.webbing);
    return data;
  }
  useEffect(() => {
    alive.current = true;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const version = generation.current + 1;
      try {
        await refresh();
      } catch (e) {
        if (alive.current && version === generation.current)
          setError((e as Error).message);
      }
      // A shared map is a live surface: poll briskly while one is on the
      // displayed slide, gently otherwise.
      if (!stopped) timer = setTimeout(tick, pollActive ? 2500 : 20000);
    };
    if (enabled && visible) void tick();
    return () => {
      stopped = true;
      alive.current = false;
      generation.current++;
      clearTimeout(timer);
    };
  }, [enabled, deckId, userId, visible, pollActive]);
  return (
    <WebbingContext.Provider
      value={{
        deckId,
        userId,
        host,
        enabled,
        error,
        maps,
        refresh,
        update,
        command,
      }}
    >
      {children}
    </WebbingContext.Provider>
  );
}
