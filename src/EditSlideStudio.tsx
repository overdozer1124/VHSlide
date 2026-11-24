import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  ImagePlus,
  Pencil,
  Shapes,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { api } from "./cloud";
import { Canvas } from "./Canvas";
import type { EditSlideDefView } from "./editSlides";
import { useEditSlides } from "./EditSlideContext";
import { emptyInkImage } from "./InkObject";
import type { Element, Slide } from "./model";

/** The one-slide studio: a student edits their own copy of the
 * teacher's base slide. The full Editor is bound to the shared
 * workbook, so this reuses only the Canvas surface plus a small
 * toolbar (text, shapes, photos, hand-drawing, order, background).
 * Saves are automatic, at most one per ~2.5 seconds, and carry the
 * last seen updated stamp; a 409 means someone (the same student in
 * another tab) saved first, so the newest copy is reloaded. */
export function EditSlideStudio({
  def,
  onClose,
}: {
  def: EditSlideDefView;
  onClose: () => void;
}) {
  const ctx = useEditSlides();
  const feedback = ctx.feedback.filter(
    (f) => f.targetKind === "editslide" && f.targetId === def.id,
  );
  const reopenActive = feedback.some((f) => f.reopen === 1);
  const [slide, setSlide] = useState<Slide>(
    () => def.mine?.slide ?? structuredClone(def.base),
  );
  const [selected, setSelected] = useState<string | undefined>();
  const [selectedInk, setSelectedInk] = useState<number | undefined>();
  const [state, setState] = useState<"saved" | "dirty" | "saving" | "error">(
    "saved",
  );
  const [message, setMessage] = useState("");
  const baseUpdated = useRef(def.mine?.updated ?? 0);
  const slideRef = useRef(slide);
  slideRef.current = slide;
  const dirty = useRef(false);
  const saving = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function save() {
    if (saving.current || !dirty.current) return;
    saving.current = true;
    setState("saving");
    try {
      const data = await api<{ editSlides: EditSlideDefView[] }>(
        `/api/decks/${ctx.deckId}/edit-slides/${def.id}/answer`,
        {
          method: "POST",
          body: JSON.stringify({
            slide: slideRef.current,
            baseUpdated: baseUpdated.current,
          }),
        },
      );
      const mine = data.editSlides.find((d) => d.id === def.id)?.mine;
      if (mine) baseUpdated.current = mine.updated;
      dirty.current = false;
      ctx.update(data.editSlides);
      setState("saved");
      setMessage("");
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 409) {
        // Reload the newest copy rather than overwriting it.
        const list = await ctx.refresh();
        const fresh = list.find((d) => d.id === def.id);
        if (fresh?.mine) {
          baseUpdated.current = fresh.mine.updated;
          setSlide(fresh.mine.slide);
          dirty.current = false;
          setState("saved");
          setMessage(
            "ほかの画面で保存されたため、最新の状態を読み直しました。",
          );
        } else setState("error");
      } else {
        setState("error");
        setMessage(err.message);
      }
    } finally {
      saving.current = false;
    }
  }
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const timer = setInterval(() => void saveRef.current(), 2500);
    return () => {
      clearInterval(timer);
      void saveRef.current();
    };
  }, []);

  function change(next: Slide) {
    setSlide(next);
    dirty.current = true;
    setState("dirty");
  }
  function onChange(e: Element) {
    change({
      ...slideRef.current,
      elements: slideRef.current.elements.map((x) =>
        x.id === e.id ? e : x,
      ),
    });
  }
  function onChangeMany(elements: Element[]) {
    const byId = new Map(elements.map((e) => [e.id, e]));
    change({
      ...slideRef.current,
      elements: slideRef.current.elements.map((x) => byId.get(x.id) ?? x),
    });
  }
  function add(element: Element) {
    if (slideRef.current.elements.length >= 200) return;
    change({ ...slideRef.current, elements: [...slideRef.current.elements, element] });
    setSelected(element.id);
  }
  const selectedElement = slide.elements.find((e) => e.id === selected);
  function moveSelection(delta: number) {
    if (!selected) return;
    const elements = [...slideRef.current.elements];
    const at = elements.findIndex((e) => e.id === selected);
    const to = at + delta;
    if (at < 0 || to < 0 || to >= elements.length) return;
    const [item] = elements.splice(at, 1);
    elements.splice(to, 0, item);
    change({ ...slideRef.current, elements });
  }

  return (
    <div className="edit-studio-overlay">
      <section
        className="edit-studio"
        role="dialog"
        aria-modal="true"
        aria-label="自分のスライドを作る"
      >
        <header>
          <h2>自分のスライドを作る</h2>
          <span className="edit-studio-state" role="status">
            {state === "saving"
              ? "保存中…"
              : state === "dirty"
                ? "未保存"
                : state === "error"
                  ? "保存できませんでした"
                  : "保存しました"}
          </span>
          <button
            className="button outline"
            aria-label="閉じる"
            onClick={() => {
              void saveRef.current();
              onClose();
            }}
          >
            <X size={18} />
          </button>
        </header>
        {message && (
          <p className="edit-studio-message" role="status">
            {message}
          </p>
        )}
        {feedback.length > 0 && (
          <div className="edit-studio-feedback">
            {feedback.slice(0, 3).map((f) => (
              <p key={f.id}>
                {f.stamp && <span className="stamp">{f.stamp}</span>}
                {f.text}
              </p>
            ))}
            {reopenActive && (
              <button
                className="button primary"
                onClick={() => {
                  void (async () => {
                    await saveRef.current();
                    try {
                      await ctx.resubmitFeedback(def.id);
                      onClose();
                    } catch (e) {
                      setState("error");
                      setMessage((e as Error).message);
                    }
                  })();
                }}
              >
                出し直す
              </button>
            )}
          </div>
        )}
        <div className="edit-studio-tools">
          <button
            className="tool-button"
            onClick={() =>
              add({
                id: crypto.randomUUID(),
                type: "text",
                x: 120,
                y: 120,
                w: 480,
                h: 80,
                text: "文字を入力",
                fontSize: 32,
                color: "#173d38",
              })
            }
          >
            <Type size={18} /> 文字
          </button>
          <button
            className="tool-button"
            onClick={() =>
              add({
                id: crypto.randomUUID(),
                type: "shape",
                shape: "rect",
                x: 120,
                y: 120,
                w: 240,
                h: 160,
                fill: "#dbeafe",
                stroke: "#587d59",
              })
            }
          >
            <Shapes size={18} /> 四角
          </button>
          <button
            className="tool-button"
            onClick={() =>
              add({
                id: crypto.randomUUID(),
                type: "shape",
                shape: "circle",
                x: 120,
                y: 120,
                w: 180,
                h: 180,
                fill: "#fde68a",
                stroke: "#587d59",
              })
            }
          >
            <Shapes size={18} /> 丸
          </button>
          <button
            className="tool-button"
            onClick={() => fileInput.current?.click()}
          >
            <ImagePlus size={18} /> 写真
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            hidden
            aria-label="写真のファイル"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try {
                const { src } = await api<{ src: string }>(
                  `/api/decks/${ctx.deckId}/edit-slides/${def.id}/answer-assets`,
                  { method: "POST", body: file },
                );
                add({
                  id: crypto.randomUUID(),
                  type: "image",
                  x: 160,
                  y: 100,
                  w: 320,
                  h: 240,
                  src,
                });
              } catch (err) {
                setState("error");
                setMessage((err as Error).message);
              }
            }}
          />
          <button
            className="tool-button"
            onClick={() =>
              add({
                id: crypto.randomUUID(),
                type: "image",
                src: emptyInkImage,
                drawing: [],
                x: 100,
                y: 100,
                w: 480,
                h: 270,
                stroke: "#173d38",
                strokeWidth: 5,
              })
            }
          >
            <Pencil size={18} /> 手描き
          </button>
          <span className="small-divider" aria-hidden="true" />
          <button
            className="tool-button"
            disabled={!selected}
            onClick={() => moveSelection(1)}
          >
            <ArrowUp size={18} /> 前へ
          </button>
          <button
            className="tool-button"
            disabled={!selected}
            onClick={() => moveSelection(-1)}
          >
            <ArrowDown size={18} /> 後ろへ
          </button>
          <button
            className="tool-button"
            disabled={!selectedElement}
            onClick={() => {
              if (!selectedElement) return;
              add({
                ...selectedElement,
                id: crypto.randomUUID(),
                x: Math.min(selectedElement.x + 24, 700),
                y: Math.min(selectedElement.y + 24, 380),
              });
            }}
          >
            <Copy size={18} /> 複製
          </button>
          <button
            className="tool-button"
            disabled={!selected}
            onClick={() => {
              change({
                ...slideRef.current,
                elements: slideRef.current.elements.filter(
                  (e) => e.id !== selected,
                ),
              });
              setSelected(undefined);
            }}
          >
            <Trash2 size={18} /> 削除
          </button>
          <label className="edit-studio-bg">
            背景
            <input
              type="color"
              value={slide.background}
              onChange={(e) =>
                change({ ...slideRef.current, background: e.target.value })
              }
            />
          </label>
        </div>
        <div className="edit-studio-canvas">
          <Canvas
            slide={slide}
            editable
            selected={selected}
            onSelect={(id) => setSelected(id)}
            selectedInkIndex={selectedInk}
            onSelectInk={setSelectedInk}
            onChange={onChange}
            onChangeMany={onChangeMany}
          />
        </div>
        <p className="edit-studio-note">
          保存は自動です。写真は自分のスライドにだけ使え、見られるのは先生と自分だけです。
        </p>
      </section>
    </div>
  );
}
