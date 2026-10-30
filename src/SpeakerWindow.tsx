import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUp, ArrowDown } from "lucide-react";
import { Canvas } from "./Canvas";
import { useFitCanvas } from "./useFitCanvas";
import type { Slide } from "./model";
import { readSpeakerState } from "./speakerChannel";
import type { SpeakerState } from "./speakerChannel";
export function SpeakerWindow({ session }: { session: string }) {
  const [state, setState] = useState<SpeakerState>(),
    [status, setStatus] = useState("発表画面との接続を待っています…"),
    [size, setSize] = useState(24);
  const channel = useRef<BroadcastChannel | null>(null);
  const receivedRevision = useRef(-1);
  useEffect(() => {
    document.title = "スピーカーノート — VHSlide";
    window.opener = null;
    if (typeof BroadcastChannel === "undefined") {
      setStatus("このブラウザでは発表者画面を利用できません。");
      return;
    }
    const c = new BroadcastChannel(`vhslide-speaker-${session}`);
    channel.current = c;
    let last = Date.now();
    c.onmessage = (event) => {
      const message = event.data;
      if (message?.type === "state") {
        const next = readSpeakerState(message.state);
        const revision = message.revision;
        if (
          next &&
          (revision === undefined ||
            (Number.isSafeInteger(revision) &&
              revision >= receivedRevision.current))
        ) {
          receivedRevision.current = revision ?? -1;
          last = Date.now();
          setState(next);
          setStatus("");
        }
      }
      if (message?.type === "alive") {
        last = Date.now();
        if (message.revision !== receivedRevision.current)
          c.postMessage({ type: "ready", revision: receivedRevision.current });
      }
      if (event.data?.type === "ended") {
        last = Infinity;
        setState(undefined);
        setStatus("発表が終了しました。");
      }
    };
    c.postMessage({ type: "ready", revision: receivedRevision.current });
    const timer = setInterval(() => {
      c.postMessage({ type: "ready", revision: receivedRevision.current });
      if (Date.now() - last > 15000) {
        receivedRevision.current = -1;
        setState(undefined);
        setStatus(
          "発表画面との接続が切れています。発表画面から開き直してください。",
        );
      }
    }, 2000);
    return () => {
      clearInterval(timer);
      c.close();
      channel.current = null;
    };
  }, [session]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const steps: Record<
        string,
        [number, number, "left" | "right" | "up" | "down"]
      > = {
        ArrowLeft: [-1, 0, "left"],
        ArrowRight: [1, 0, "right"],
        ArrowUp: [0, -1, "up"],
        ArrowDown: [0, 1, "down"],
      };
      const step = steps[event.key];
      if (step && state) {
        event.preventDefault();
        if (state.available[step[2]]) navigate(step[0], step[1]);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [state]);
  function navigate(dx: number, dy: number) {
    channel.current?.postMessage({ type: "navigate", dx, dy });
  }
  return (
    <main className="speaker-window">
      <header>
        <div>
          <h1>スピーカーノート</h1>
          <p>
            画面共有・投影には、発表スライドのウィンドウを指定してください。
          </p>
        </div>
        <button className="button" onClick={() => window.close()}>
          閉じる
        </button>
      </header>
      {status ? (
        <p role="status" className="speaker-connection">
          {status}
        </p>
      ) : (
        state && (
          <>
            <section className="speaker-current">
              <span>{state.title}</span>
              <h2>
                {state.position}　{state.slideTitle}
              </h2>
            </section>
            <div className="speaker-actions">
              <div role="group" aria-label="発表ページの移動">
                {(
                  [
                    {
                      label: "左へ",
                      key: "left",
                      dx: -1,
                      dy: 0,
                      Icon: ArrowLeft,
                    },
                    {
                      label: "右へ",
                      key: "right",
                      dx: 1,
                      dy: 0,
                      Icon: ArrowRight,
                    },
                    { label: "上へ", key: "up", dx: 0, dy: -1, Icon: ArrowUp },
                    {
                      label: "下へ",
                      key: "down",
                      dx: 0,
                      dy: 1,
                      Icon: ArrowDown,
                    },
                  ] as const
                ).map(({ label, key, dx, dy, Icon }) => (
                  <button
                    className="button"
                    key={key}
                    aria-label={label}
                    disabled={!state.available[key]}
                    onClick={() => navigate(dx, dy)}
                  >
                    <Icon size={20} />
                    {label}
                  </button>
                ))}
              </div>
              <div role="group" aria-label="ノートの文字サイズ">
                <button
                  className="button"
                  aria-label="ノートの文字を小さく"
                  disabled={size <= 16}
                  onClick={() => setSize((s) => s - 2)}
                >
                  A−
                </button>
                <button
                  className="button"
                  aria-label="ノートの文字を大きく"
                  disabled={size >= 40}
                  onClick={() => setSize((s) => s + 2)}
                >
                  A＋
                </button>
              </div>
            </div>
            <div className="speaker-content-grid">
              {state.preview ? (
                <SpeakerSlidePreview slide={state.preview} />
              ) : (
                <section
                  className="speaker-slide-preview"
                  aria-label="発表中のスライド"
                >
                  <h2>投影中のスライド</h2>
                  <p>発表画面を更新すると、スライドも表示できます。</p>
                </section>
              )}
              <section className="speaker-notes-pane">
                <h2>発表メモ</h2>
                <div
                  role="region"
                  className="speaker-notes-content"
                  aria-label="現在のスピーカーノート"
                  style={{ fontSize: size }}
                >
                  {state.notes || "このスライドにノートはありません。"}
                </div>
              </section>
            </div>
          </>
        )
      )}
    </main>
  );
}

function SpeakerSlidePreview({
  slide,
}: {
  slide: Omit<Slide, "speakerNotes">;
}) {
  const frame = useRef<HTMLDivElement>(null),
    zoom = useFitCanvas(frame, 0, 0);
  return (
    <section className="speaker-slide-preview" aria-label="発表中のスライド">
      <h2>投影中のスライド</h2>
      <div
        ref={frame}
        className="speaker-slide-frame"
        data-preview-slide={slide.id}
      >
        <Canvas slide={slide} zoom={zoom} />
      </div>
    </section>
  );
}
