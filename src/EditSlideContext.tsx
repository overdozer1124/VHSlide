import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { EditSlideDefView } from "./editSlides";
import { api } from "./cloud";
import { useDeckPoller } from "./deckPoll";

export type EditSlideContextValue = {
  deckId?: string;
  userId?: string;
  enabled: boolean;
  host?: boolean;
  error: string;
  defs: EditSlideDefView[];
  refresh: () => Promise<EditSlideDefView[]>;
  update: (defs: EditSlideDefView[]) => void;
};
export const EditSlideContext = createContext<EditSlideContextValue>({
  enabled: false,
  error: "",
  defs: [],
  refresh: async () => [],
  update: () => {},
});
export const useEditSlides = () => useContext(EditSlideContext);

export function EditSlideProvider({
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
    <EditSlideSession
      key={scope}
      {...{ deckId, userId, host, blocked, pollActive }}
    >
      {children}
    </EditSlideSession>
  );
}

function EditSlideSession({
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
  const [defs, setDefs] = useState<EditSlideDefView[]>([]);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const generation = useRef(0);
  const defsRef = useRef<EditSlideDefView[]>([]);
  defsRef.current = defs;
  const enabled = !!deckId && !!userId && !blocked;
  const poller = useDeckPoller();
  function update(data: EditSlideDefView[]) {
    if (alive.current) {
      generation.current++;
      setDefs(data);
    }
  }
  async function refresh() {
    if (!enabled) return [];
    if (poller) {
      await poller.pollNow();
      return defsRef.current;
    }
    const version = ++generation.current;
    const data = await api<{ editSlides?: EditSlideDefView[] }>(
      `/api/decks/${deckId}/edit-slides`,
    );
    const list = data.editSlides ?? [];
    if (alive.current && version === generation.current) {
      setDefs(list);
      setError("");
    }
    return list;
  }
  useEffect(() => {
    alive.current = true;
    if (!enabled || !poller) return;
    const off = poller.register("editslides", {
      guard: generation,
      onData: (p) => {
        if (!alive.current) return;
        const list = (p.editSlides ?? []) as EditSlideDefView[];
        defsRef.current = list;
        setDefs(list);
        setError("");
      },
      onError: (e) => {
        if (!alive.current) return;
        defsRef.current = [];
        setDefs([]);
        setError(e.message);
      },
    });
    return () => {
      alive.current = false;
      generation.current++;
      off();
    };
  }, [poller, enabled, deckId, userId]);
  useEffect(() => {
    poller?.setWant("editslides", pollActive ? 5000 : 30000);
  }, [poller, pollActive]);
  return (
    <EditSlideContext.Provider
      value={{ deckId, userId, host, enabled, error, defs, refresh, update }}
    >
      {children}
    </EditSlideContext.Provider>
  );
}

/** Run one edit-slide command and adopt the returned list. */
export async function editSlideApi(
  ctx: EditSlideContextValue,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<EditSlideDefView[]> {
  const data = await api<{ editSlides: EditSlideDefView[] }>(
    `/api/decks/${ctx.deckId}/edit-slides${path}`,
    {
      method: init?.method ?? "POST",
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    },
  );
  ctx.update(data.editSlides);
  return data.editSlides;
}
