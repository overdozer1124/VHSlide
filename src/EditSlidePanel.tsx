import { useState } from "react";
import { editSlideApi, useEditSlides } from "./EditSlideContext";
import type { Slide } from "./model";

/** Host management for free-edit slides, as one tab of the form
 * panel: designate the current slide as a base, open/close the
 * intake, and remove a definition (the confirm names how many
 * answers go with it). Results are read in the teacher console. */
export function EditSlidePanel({
  currentSlide,
  slideExists,
}: {
  currentSlide: () => Slide | undefined;
  slideExists: (slideId: string) => boolean;
}) {
  const ctx = useEditSlides();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"single" | "group">("single");
  const slide = currentSlide();
  const mine = ctx.defs.filter((d) => d.source === slide?.id);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!ctx.enabled)
    return <p>クラウドの作品で使えます。</p>;
  if (!ctx.host)
    return <p>生徒の編集用はホストが用意します。</p>;
  return (
    <div className="edit-slide-panel">
      <p>
        いま開いているスライドを土台にして、生徒が自分のスライドを作れるようにします。元のスライドは変わりません。結果は授業コンソールの「生徒のスライド」で見られます。
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {mine.length === 0 && (
        <div className="edit-slide-mode" role="radiogroup" aria-label="作り方">
          <label>
            <input
              type="radio"
              name="edit-slide-mode"
              checked={mode === "single"}
              onChange={() => setMode("single")}
            />
            個人で1枚ずつ
          </label>
          <label>
            <input
              type="radio"
              name="edit-slide-mode"
              checked={mode === "group"}
              onChange={() => setMode("group")}
            />
            班で1枚を共同編集
          </label>
        </div>
      )}
      {mine.length === 0 && (
        <button
          className="button primary"
          disabled={busy || !slide}
          onClick={() =>
            slide &&
            void run(() =>
              editSlideApi(ctx, "", {
                body: { source: slide.id, slide, mode },
              }),
            )
          }
        >
          このスライドの写しを土台にする
        </button>
      )}
      {mine.length === 0 && (
        <button
          className="button outline"
          disabled={busy || !slide}
          onClick={() =>
            slide &&
            void run(() =>
              editSlideApi(ctx, "", {
                body: { source: slide.id, slide, baseKind: "blank", mode },
              }),
            )
          }
        >
          白紙を土台にする
        </button>
      )}
      {mine.map((def) => (
          <div key={def.id} className="edit-slide-def">
            <p>
              {def.mode === "group" ? "班で共同編集" : "個人で1枚ずつ"}
              　土台：{def.baseKind === "blank" ? "白紙" : "スライドの写し"}
              　状態：
              {def.status === "draft"
                ? "下書き"
                : def.status === "open"
                  ? "受付中"
                  : "終了"}
              　回答：{def.answerCount}
              {def.mode === "group" ? "班" : "人"}
              {!slideExists(def.source) &&
                "（元のスライドは削除されています）"}
            </p>
            <div className="edit-slide-actions">
              {def.status !== "open" ? (
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      editSlideApi(ctx, `/${def.id}/status`, {
                        body: { status: "open" },
                      }),
                    )
                  }
                >
                  受付を開始
                </button>
              ) : (
                <button
                  className="button outline"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      editSlideApi(ctx, `/${def.id}/status`, {
                        body: { status: "closed" },
                      }),
                    )
                  }
                >
                  受付を終了
                </button>
              )}
              <button
                className="button outline danger"
                disabled={busy}
                onClick={() => {
                  if (
                    !window.confirm(
                      def.answerCount > 0
                        ? `${def.answerCount}${def.mode === "group" ? "班" : "人"}分の回答も消えます。生徒の編集用を削除しますか？`
                        : "生徒の編集用を削除しますか？",
                    )
                  )
                    return;
                  void run(() =>
                    editSlideApi(ctx, `/${def.id}`, { method: "DELETE" }),
                  );
                }}
              >
                削除
              </button>
            </div>
          </div>
        ))}
      {ctx.defs.length > mine.length && (
        <p className="small">
          ほかのスライドにも生徒の編集用があります（このタブではいまのスライドの分だけを扱います）。
        </p>
      )}
    </div>
  );
}
