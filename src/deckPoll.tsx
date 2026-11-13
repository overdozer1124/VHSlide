import { createContext, useContext, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { api } from "./cloud";
import { usePageVisible } from "./usePageVisible";

/** One shared polling loop for a deck's live features (worksheets,
 * webbing maps, groups). Each feature registers a sink and a desired
 * interval; the poller runs a single timer at the fastest requested
 * interval and asks the server, in ONE request, for only the features
 * whose change counter moved. That keeps the cloud request count at
 * one per tick instead of one per feature, while unchanged features
 * still cost the server almost nothing (see featureVersions.ts). */
export type PollFeature = "worksheets" | "webbing" | "groups";
const PARAM: Record<PollFeature, string> = {
  worksheets: "wv",
  webbing: "mv",
  groups: "gv",
};
type Sink = {
  onData: (payload: any) => void;
  onError: (error: Error) => void;
  /** Sessions bump this when they adopt fresher data from a command;
   * a poll response fetched before the bump is then dropped instead
   * of overwriting the newer state. */
  guard?: { current: unknown };
};

export class DeckPoller {
  readonly deckId: string;
  private versions: Record<PollFeature, number | null> = {
    worksheets: null,
    webbing: null,
    groups: null,
  };
  private sinks = new Map<PollFeature, Sink>();
  private wants = new Map<PollFeature, number>();
  private timer?: ReturnType<typeof setTimeout>;
  private inflight: Promise<void> | undefined;
  private running = false;

  constructor(deckId: string) {
    this.deckId = deckId;
  }

  register(feature: PollFeature, sink: Sink): () => void {
    this.sinks.set(feature, sink);
    if (this.running) {
      void this.pollNow();
      this.schedule();
    }
    return () => {
      this.sinks.delete(feature);
      this.wants.delete(feature);
      this.schedule();
    };
  }

  setWant(feature: PollFeature, ms: number): void {
    if (this.wants.get(feature) === ms) return;
    this.wants.set(feature, ms);
    this.schedule();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.pollNow();
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.running || this.sinks.size === 0) return;
    const ms = Math.min(30000, ...this.wants.values());
    this.timer = setTimeout(() => {
      void this.pollNow().then(() => this.schedule());
    }, ms);
  }

  /** Single-flight: concurrent callers share one request. Never
   * rejects; failures are fanned out to the sinks' onError. */
  pollNow(): Promise<void> {
    if (this.inflight) return this.inflight;
    const features = [...this.sinks.keys()];
    if (features.length === 0) return Promise.resolve();
    const query = features
      .map((f) => `${PARAM[f]}=${this.versions[f] ?? ""}`)
      .join("&");
    const guards = new Map(
      features.map((f) => [f, this.sinks.get(f)?.guard?.current]),
    );
    const fresh = (f: PollFeature) =>
      guards.get(f) === this.sinks.get(f)?.guard?.current;
    this.inflight = (async () => {
      try {
        const data = await api<Partial<Record<PollFeature, any>>>(
          `/api/decks/${this.deckId}/poll?${query}`,
        );
        for (const f of features) {
          const payload = data[f];
          if (!payload || !fresh(f)) continue;
          if (typeof payload.version === "number")
            this.versions[f] = payload.version;
          this.sinks.get(f)?.onData(payload);
        }
      } catch (e) {
        const error = e as Error;
        for (const f of features)
          if (fresh(f)) this.sinks.get(f)?.onError(error);
      } finally {
        this.inflight = undefined;
      }
    })();
    return this.inflight;
  }
}

const DeckPollContext = createContext<DeckPoller | null>(null);
export const useDeckPoller = () => useContext(DeckPollContext);

export function DeckPollProvider({
  deckId,
  userId,
  blocked,
  children,
}: {
  deckId?: string;
  userId?: string;
  blocked: boolean;
  children?: ReactNode;
}) {
  const enabled = !!deckId && !!userId && !blocked;
  const visible = usePageVisible();
  const ref = useRef<DeckPoller | null>(null);
  if (deckId && ref.current?.deckId !== deckId)
    ref.current = new DeckPoller(deckId);
  if (!deckId) ref.current = null;
  const poller = enabled ? ref.current : null;
  useEffect(() => {
    if (!poller) return;
    if (visible) poller.start();
    else poller.stop();
    return () => poller.stop();
  }, [poller, visible]);
  return (
    <DeckPollContext.Provider value={poller}>
      {children}
    </DeckPollContext.Provider>
  );
}
