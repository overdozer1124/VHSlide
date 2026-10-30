import { useEffect, useRef, useState } from "react";
import type { SpeakerState } from "./speakerChannel";
export type SpeakerLaunch = {
  session: string;
  popup: Window | null;
  error: string;
};
/** Open synchronously in the user's click, before React mounts the presentation. */
export function prepareSpeakerWindow(
  session: string = crypto.randomUUID(),
): SpeakerLaunch {
  if (typeof BroadcastChannel === "undefined")
    return {
      session,
      popup: null,
      error: "このブラウザでは発表者画面を利用できません。",
    };
  const url = new URL("/", location.origin);
  url.searchParams.set("speaker", session);
  let popup: Window | null = null;
  try {
    popup = window.open(
      url.toString(),
      `vhslide-speaker-${session}`,
      "popup,width=1100,height=780",
    );
  } catch {
    /* Treat browser refusal like a blocked popup. */
  }
  if (popup) {
    popup.opener = null;
    popup.focus();
  }
  return {
    session,
    popup,
    error: popup
      ? ""
      : "発表者画面を開けませんでした。ブラウザのポップアップを許可して、発表画面の「発表者用ノートを開く」からもう一度お試しください。",
  };
}
export function useSpeakerWindow(
  state: SpeakerState,
  go: (dx: number, dy: number) => void,
  initial?: SpeakerLaunch,
) {
  const [session] = useState(() => initial?.session ?? crypto.randomUUID());
  const revision = useRef(0);
  const channel = useRef<BroadcastChannel | null>(null),
    popup = useRef<Window | null>(initial?.popup ?? null),
    latest = useRef({ state, go });
  latest.current = { state, go };
  const [error, setError] = useState(initial?.error ?? "");
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    clearTimeout(closeTimer.current);
    if (typeof BroadcastChannel === "undefined") return;
    const c = new BroadcastChannel(`vhslide-speaker-${session}`);
    channel.current = c;
    const send = () =>
      c.postMessage({
        type: "state",
        revision: revision.current,
        state: latest.current.state,
      });
    c.onmessage = (event) => {
      const v = event.data;
      if (v?.type === "ready" && v.revision !== revision.current) send();
      if (
        v?.type === "navigate" &&
        Number.isInteger(v.dx) &&
        Number.isInteger(v.dy) &&
        Math.abs(v.dx) + Math.abs(v.dy) === 1
      ) {
        const key =
          v.dx < 0 ? "left" : v.dx > 0 ? "right" : v.dy < 0 ? "up" : "down";
        if (latest.current.state.available[key]) latest.current.go(v.dx, v.dy);
      }
    };
    const end = () => c.postMessage({ type: "ended" });
    const timer = setInterval(
      () => c.postMessage({ type: "alive", revision: revision.current }),
      2000,
    );
    window.addEventListener("pagehide", end);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", end);
      end();
      c.close();
      channel.current = null;
      // React StrictMode replays effects; only a real unmount should close the window.
      closeTimer.current = setTimeout(() => popup.current?.close(), 0);
    };
  }, [session]);
  useEffect(() => {
    revision.current++;
    channel.current?.postMessage({
      type: "state",
      revision: revision.current,
      state,
    });
  }, [state]);
  function open() {
    if (!channel.current) {
      setError("このブラウザでは発表者画面を利用できません。");
      return;
    }
    if (popup.current && !popup.current.closed) {
      popup.current.focus();
      return;
    }
    const launch = prepareSpeakerWindow(session);
    popup.current = launch.popup;
    setError(launch.error);
  }
  return { open, error };
}
