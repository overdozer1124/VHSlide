import { useAnswers } from "./AnswerStore";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { WorksheetView } from "./worksheets";
import { api } from "./cloud";
export type WorksheetContextValue = {
  deckId?: string;
  userId?: string;
  enabled: boolean;
  host?: boolean;
  readOnly?: boolean;
  error: string;
  sheets: WorksheetView[];
  refresh: () => Promise<WorksheetView[]>;
  update: (sheets: WorksheetView[]) => void;
};
export const WorksheetContext = createContext<WorksheetContextValue>({
  enabled: false,
  error: "",
  sheets: [],
  refresh: async () => [],
  update: () => {},
});
export const useWorksheets = () => useContext(WorksheetContext);
export function WorksheetProvider({
  deckId,
  userId,
  host,
  blocked,
  children,
}: {
  deckId?: string;
  userId?: string;
  host: boolean;
  blocked: boolean;
  children?: ReactNode;
}) {
  const scope = `${deckId}:${userId}:${host}:${blocked}`;
  return (
    <WorksheetSession key={scope} {...{ deckId, userId, host, blocked }}>
      {children}
    </WorksheetSession>
  );
}
function WorksheetSession({
  deckId,
  userId,
  host,
  blocked,
  children,
}: {
  deckId?: string;
  userId?: string;
  host: boolean;
  blocked: boolean;
  children?: ReactNode;
}) {
  const [sheets, setSheets] = useState<WorksheetView[]>([]);
  const answers = useAnswers();
  useEffect(() => {
    if (answers.saved?.kind === "worksheet")
      update(answers.saved.data.worksheets);
  }, [answers.saved]);
  useEffect(() => {
    answers.reconcile(
      "worksheet",
      sheets.map((s) => s.id),
    );
  }, [sheets]);

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
      const version = generation.current + 1;
      try {
        await refresh();
      } catch (e) {
        if (alive.current && version === generation.current) {
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
    <WorksheetContext.Provider
      value={{ deckId, userId, host, enabled, error, sheets, refresh, update }}
    >
      {children}
    </WorksheetContext.Provider>
  );
}
