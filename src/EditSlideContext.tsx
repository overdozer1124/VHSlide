import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { EditSlideAnswersMeta, EditSlideDefView } from "./editSlides";
import type { FeedbackRow } from "./feedback";
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
  /** Feedback (§4.3) as this viewer may see it: the host sees every
   * row, a student only their own. Rides the "editfeedback" poll
   * counter, separate from the definition list. */
  feedback: FeedbackRow[];
  /** Snapshot one answer for the follow view (stage 2b). */
  shareFollow: (defId: string, author: string, names: boolean) => Promise<void>;
  /** Take the follow snapshot down. */
  unshareFollow: (defId: string) => Promise<void>;
  /** Publish one answer's snapshot in the response gallery; the
   * source slide rides along so the server can open a gallery for
   * it when none exists yet. */
  shareGallery: (
    defId: string,
    author: string,
    names: boolean,
    slide: Slide,
  ) => Promise<void>;
  /** Remove one answer's gallery snapshot. */
  unshareGallery: (defId: string, author: string) => Promise<void>;
  sendFeedback: (value: {
    targetId: string;
    owner: string;
    text: string;
    stamp: string;
    reopen?: boolean;
  }) => Promise<void>;
  markFeedbackRead: (ids: string[]) => Promise<void>;
  resubmitFeedback: (targetId: string) => Promise<void>;
  cancelFeedbackReopen: (targetId: string, owner: string) => Promise<void>;
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
  feedback: [],
  shareFollow: async () => {},
  unshareFollow: async () => {},
  shareGallery: async () => {},
  unshareGallery: async () => {},
  sendFeedback: async () => {},
  markFeedbackRead: async () => {},
  resubmitFeedback: async () => {},
  cancelFeedbackReopen: async () => {},
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
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const generation = useRef(0);
  const metaGeneration = useRef(0);
  const feedbackGeneration = useRef(0);
  const defsRef = useRef<EditSlideDefView[]>([]);
  defsRef.current = defs;
  const enabled = !!deckId && !!userId && !blocked;
  const poller = useDeckPoller();
  async function answerContent(defId: string, author: string) {
    return api<{ slide: Slide; updated: number }>(
      `/api/decks/${deckId}/edit-slides/${defId}/answers/${encodeURIComponent(author)}`,
    );
  }
  async function feedbackApi(path: string, body: unknown) {
    const data = await api<{ feedback: FeedbackRow[] }>(
      `/api/decks/${deckId}/feedback${path}`,
      { method: "POST", body: JSON.stringify(body) },
    );
    if (alive.current) {
      feedbackGeneration.current++;
      setFeedback(data.feedback);
    }
  }
  async function shareApi(defId: string, action: string, body?: unknown) {
    const data = await api<{ editSlides?: EditSlideDefView[] }>(
      `/api/decks/${deckId}/edit-slides/${defId}/${action}?ecaps=editgroup`,
      body === undefined
        ? { method: "DELETE" }
        : { method: "POST", body: JSON.stringify(body) },
    );
    if (alive.current && data.editSlides) {
      generation.current++;
      defsRef.current = data.editSlides;
      setDefs(data.editSlides);
    }
  }
  async function shareFollow(defId: string, author: string, names: boolean) {
    await shareApi(defId, "share-follow", { author, names });
  }
  async function unshareFollow(defId: string) {
    await shareApi(defId, "share-follow");
  }
  async function shareGallery(
    defId: string,
    author: string,
    names: boolean,
    slide: Slide,
  ) {
    await shareApi(defId, "share-gallery", { author, names, slide });
  }
  async function unshareGallery(defId: string, author: string) {
    await shareApi(defId, "share-remove", { author });
  }
  async function sendFeedback(value: {
    targetId: string;
    owner: string;
    text: string;
    stamp: string;
    reopen?: boolean;
  }) {
    await feedbackApi("", { targetKind: "editslide", ...value });
  }
  async function markFeedbackRead(ids: string[]) {
    if (!ids.length) return;
    await feedbackApi("/read", { ids });
  }
  async function resubmitFeedback(targetId: string) {
    await feedbackApi("/resubmit", { targetId });
  }
  async function cancelFeedbackReopen(targetId: string, owner: string) {
    await feedbackApi("/cancel-reopen", { targetId, owner });
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
      `/api/decks/${deckId}/edit-slides?ecaps=editgroup`,
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
  // Feedback rides its own counter for everyone: the host watches
  // for resubmits, students watch for new comments and send-backs,
  // and neither re-reads the definition list when it moves.
  useEffect(() => {
    if (!enabled || !poller) return;
    const off = poller.register("editfeedback", {
      guard: feedbackGeneration,
      onData: (p) => {
        if (!alive.current) return;
        setFeedback((p.feedback ?? []) as FeedbackRow[]);
      },
      onError: () => {},
    });
    return () => {
      feedbackGeneration.current++;
      off();
    };
  }, [poller, enabled, deckId, userId]);
  useEffect(() => {
    poller?.setWant("editslides", pollActive ? 5000 : 30000);
    if (host) poller?.setWant("editanswers", pollActive ? 5000 : 30000);
    poller?.setWant("editfeedback", pollActive ? 5000 : 30000);
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
        feedback,
        shareFollow,
        unshareFollow,
        shareGallery,
        unshareGallery,
        sendFeedback,
        markFeedbackRead,
        resubmitFeedback,
        cancelFeedbackReopen,
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
    `/api/decks/${ctx.deckId}/edit-slides${path}?ecaps=editgroup`,
    {
      method: init?.method ?? "POST",
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    },
  );
  ctx.update(data.editSlides);
  return data.editSlides;
}
