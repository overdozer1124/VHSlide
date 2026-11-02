import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { WorksheetView } from "./worksheets";
import { api } from "./cloud";
import { WorksheetPanel } from "./WorksheetPanel";
export type WorksheetContextValue = {
  deckId?: string;
  userId?: string;
  enabled: boolean;
  sheets: WorksheetView[];
  refresh: () => Promise<WorksheetView[]>;
  update: (sheets: WorksheetView[]) => void;
};
const Context = createContext<WorksheetContextValue>({
  enabled: false,
  sheets: [],
  refresh: async () => [],
  update: () => {},
});
export const useWorksheets = () => useContext(Context);
export function WorksheetProvider({
  deckId,
  userId,
  host,
  blocked,
  presenting,
  onEmbed,
  children,
}: {
  deckId?: string;
  userId?: string;
  host: boolean;
  blocked: boolean;
  presenting: boolean;
  onEmbed: (sheet: WorksheetView) => void;
  children?: ReactNode;
}) {
  const scope = `${deckId}:${userId}:${host}:${blocked}`;
  return (
    <WorksheetSession
      key={scope}
      {...{ deckId, userId, host, blocked, presenting, onEmbed }}
    >
      {children}
    </WorksheetSession>
  );
}
function WorksheetSession({
  deckId,
  userId,
  host,
  blocked,
  presenting,
  onEmbed,
  children,
}: {
  deckId?: string;
  userId?: string;
  host: boolean;
  blocked: boolean;
  presenting: boolean;
  onEmbed: (sheet: WorksheetView) => void;
  children?: ReactNode;
}) {
  const [sheets, setSheets] = useState<WorksheetView[]>([]);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const generation = useRef(0);
  const enabled = !!deckId && !!userId && !blocked;
  function update(data: WorksheetView[]) {
    if (alive.current) {
      generation.current++;
      setSheets(data);
    }
  }
  async function refresh() {
    if (!enabled) return [];
    const version = ++generation.current;
    const data = await api<{ worksheets: WorksheetView[] }>(
      `/api/decks/${deckId}/worksheets`,
    );
    if (alive.current && version === generation.current) {
      setSheets(data.worksheets);
      setError("");
    }
    return data.worksheets;
  }
  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        await refresh();
      } catch (e) {
        if (alive.current) {
          setSheets([]);
          setError((e as Error).message);
        }
      }
      if (alive.current) timer = setTimeout(tick, 5000);
    };
    if (enabled) void tick();
    return () => {
      alive.current = false;
      clearTimeout(timer);
    };
  }, [enabled, deckId, userId]);
  return (
    <Context.Provider
      value={{ deckId, userId, enabled, sheets, refresh, update }}
    >
      {children}
      <WorksheetPanel {...{ host, presenting, onEmbed, error }} />
    </Context.Provider>
  );
}
