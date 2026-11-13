import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { WebbingView } from "./webbing";
import { api } from "./cloud";
import { useDeckPoller } from "./deckPoll";
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
  const poller = useDeckPoller();
  function update(data: WebbingView[]) {
    if (alive.current) {
      generation.current++;
      setMaps(data);
    }
  }
  const listVersion = useRef<number | null>(null);
  const mapsRef = useRef<WebbingView[]>([]);
  mapsRef.current = maps;
  async function refresh() {
    if (!enabled) return [];
    if (poller) {
      await poller.pollNow();
      return mapsRef.current;
    }
    const version = ++generation.current;
    const known = listVersion.current;
    const data = await api<{
      webbing?: WebbingView[];
      version?: number;
      unchanged?: boolean;
    }>(`/api/decks/${deckId}/webbing${known !== null ? `?v=${known}` : ""}`);
    if (typeof data.version === "number") listVersion.current = data.version;
    if (data.unchanged) return mapsRef.current;
    const list = data.webbing ?? [];
    if (alive.current && version === generation.current) {
      setMaps(list);
      setError("");
    }
    return list;
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
    if (!enabled || !poller) return;
    const off = poller.register("webbing", {
      guard: generation,
      onData: (p) => {
        if (!alive.current) return;
        const list = (p.webbing ?? []) as WebbingView[];
        mapsRef.current = list;
        setMaps(list);
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
  // A shared map is a live surface: poll briskly while one is on the
  // displayed slide, gently otherwise.
  useEffect(() => {
    poller?.setWant("webbing", pollActive ? 2500 : 20000);
  }, [poller, pollActive]);
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
