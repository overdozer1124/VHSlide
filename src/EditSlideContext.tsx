import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { EditSlideAnswersMeta, EditSlideDefView } from "./editSlides";
import type { Slide } from "./model";
import { api } from "./cloud";
import { useDeckPoller } from "./deckPoll";

export type EditSlideContextValue = {
  deckId?: string;
  userId?: string;
  enabled: boolean;
  host?: boolean;
  error: string;
  defs: EditSlideDefView[];
  /** Host only: who answered each definition (no content). */
  answersMeta: EditSlideAnswersMeta[];
  /** Fetch one answer's slide on demand (console thumbnails). */
  answerContent: (
    defId: string,
    author: string,
  ) => Promise<{ slide: Slide; updated: number }>;
  refresh: () => Promise<EditSlideDefView[]>;
  update: (defs: EditSlideDefView[]) => void;
};
export const EditSlideContext = createContext<EditSlideContextValue>({
  enabled: false,
  error: "",
  defs: [],
  answersMeta: [],
  answerContent: async () => {
    throw new Error("not ready");
  },
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
  const [answersMeta, setAnswersMeta] = useState<EditSlideAnswersMeta[]>([]);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const generation = useRef(0);
  const metaGeneration = useRef(0);
  const defsRef = useRef<EditSlideDefView[]>([]);
  defsRef.current = defs;
  const enabled = !!deckId && !!userId && !blocked;
  const poller = useDeckPoller();
  async function answerContent(defId: string, author: string) {
    return api<{ slide: Slide; updated: number }>(
      `/api/decks/${deckId}/edit-slides/${defId}/answers/${encodeURIComponent(author)}`,
    );
  }
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
  // The answers overview rides its own poll counter and is only
  // registered for the host: student saves bump that counter alone,
  // and students never receive (or trigger) the class-wide list.
  useEffect(() => {
    if (!enabled || !poller || !host) return;
    const off = poller.register("editanswers", {
      guard: metaGeneration,
      onData: (p) => {
        if (!alive.current) return;
        setAnswersMeta((p.editAnswers ?? []) as EditSlideAnswersMeta[]);
      },
      onError: () => {},
    });
    return () => {
      metaGeneration.current++;
      off();
    };
  }, [poller, enabled, host, deckId, userId]);
  useEffect(() => {
    poller?.setWant("editslides", pollActive ? 5000 : 30000);
    if (host) poller?.setWant("editanswers", pollActive ? 5000 : 30000);
  }, [poller, pollActive, host]);
  return (
    <EditSlideContext.Provider
      value={{
        deckId,
        userId,
        host,
        enabled,
        error,
        defs,
        answersMeta,
        answerContent,
        refresh,
        update,
      }}
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
