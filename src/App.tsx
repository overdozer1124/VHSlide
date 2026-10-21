import { useEffect, useRef, useState } from "react";
import {
  Check,
  CircleHelp,
  Download,
  LayoutGrid,
  Plus,
  Presentation,
  Redo2,
  Type,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import type { Deck, Element, Shape, Slide, GridMove } from "./model";
import {
  blank,
  bounds,
  H,
  MAX_FILE_BYTES,
  insert,
  neighbor,
  parseDeck,
  removeSlide,
  sample,
  serializeDeck,
  swap,
  uid,
  W,
} from "./model";
import { MapView } from "./MapView";
import { Editor } from "./Editor";
import { PresentationView } from "./PresentationView";
const KEY = "vhslide-deck-v1";
function initial(): { deck: Deck; error?: string } {
  try {
    const saved = localStorage.getItem(KEY);
    return { deck: saved ? parseDeck(saved) : sample() };
  } catch {
    return {
      deck: sample(),
      error:
        "保存データを読み込めませんでした。元のデータは上書きせず、サンプルを表示しています。",
    };
  }
}
export default function App() {
  const [boot] = useState(initial);
  const [deck, setDeck] = useState(boot.deck);
  const [past, setPast] = useState<Deck[]>([]),
    [future, setFuture] = useState<Deck[]>([]);
  const [view, setView] = useState<"map" | "editor" | "present">("map");
  const [activeId, setActiveId] = useState(deck.slides[0].id),
    [selected, setSelected] = useState<string>();
  const [notice, setNotice] = useState(boot.error ?? "");
  const [saveStatus, setSaveStatus] = useState("この端末に自動保存");
  const [protectSaved, setProtectSaved] = useState(!!boot.error);
  const [help, setHelp] = useState(false);
  const [moving, setMoving] = useState<GridMove>();
  const [direction, setDirection] = useState("right");
  const jsonRef = useRef<HTMLInputElement>(null),
    imageRef = useRef<HTMLInputElement>(null);
  const slide = deck.slides.find((s) => s.id === activeId) ?? deck.slides[0];
  const latestDeck = useRef(deck);
  latestDeck.current = deck;
  const latestSlideId = useRef(slide.id);
  latestSlideId.current = slide.id;
  function commit(next: Deck) {
    try {
      serializeDeck(next);
    } catch (error) {
      notify((error as Error).message);
      return;
    }
    const previous = latestDeck.current;
    setPast((p) => [...p.slice(-39), previous]);
    latestDeck.current = next;
    setFuture([]);
    setDeck(next);
  }
  function undo() {
    if (!past.length) return;
    setFuture((f) => [deck, ...f]);
    setDeck(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
  }
  function redo() {
    if (!future.length) return;
    setPast((p) => [...p, deck]);
    setDeck(future[0]);
    setFuture((f) => f.slice(1));
  }
  function updateSlide(patch: Partial<Slide>) {
    commit({
      ...deck,
      slides: deck.slides.map((s) =>
        s.id === slide.id ? { ...s, ...patch } : s,
      ),
    });
  }
  function updateElement(patch: Partial<Element>) {
    updateSlide({
      elements: slide.elements.map((e) =>
        e.id === selected ? { ...e, ...patch } : e,
      ),
    });
  }
  function notify(message: string) {
    setNotice(message);
  }
  useEffect(() => {
    if (protectSaved) {
      setSaveStatus("自動保存を保留中");
      return;
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(deck));
      setSaveStatus("この端末に保存済み");
    } catch {
      setSaveStatus("端末の保存容量が不足");
      setNotice(
        "自動保存できません。画像を減らすか、JSONファイルを保存してください。",
      );
    }
  }, [deck, protectSaved]);
  useEffect(() => {
    if (!notice || protectSaved) return;
    const id = setTimeout(() => setNotice(""), 6500);
    return () => clearTimeout(id);
  }, [notice, protectSaved]);
  function go(dx: number, dy: number) {
    const next = neighbor(deck, slide, dx, dy);
    if (next) {
      setDirection(dx > 0 ? "right" : dx < 0 ? "left" : dy > 0 ? "down" : "up");
      setActiveId(next.id);
    }
  }
  function exitPresent() {
    if (document.fullscreenElement)
      void document.exitFullscreen().catch(() => {});
    setView("map");
  }
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement).closest(
          "input,textarea,select,[contenteditable]",
        )
      )
        return;
      if (view === "present") {
        const steps: Record<string, number[]> = {
          ArrowRight: [1, 0],
          ArrowLeft: [-1, 0],
          ArrowDown: [0, 1],
          ArrowUp: [0, -1],
        };
        if (steps[event.key]) {
          event.preventDefault();
          go(steps[event.key][0], steps[event.key][1]);
        }
        if (event.key === "Escape") exitPresent();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
      if (
        view === "editor" &&
        selected &&
        ["Delete", "Backspace"].includes(event.key)
      ) {
        event.preventDefault();
        updateSlide({
          elements: slide.elements.filter((e) => e.id !== selected),
        });
        setSelected(undefined);
      }
      if (event.key === "Escape") {
        setSelected(undefined);
        setMoving(undefined);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      if (
        view !== "editor" ||
        (e.target as HTMLElement).closest("input,textarea")
      )
        return;
      const file = Array.from(e.clipboardData?.items ?? [])
        .find((i) => i.type.startsWith("image/"))
        ?.getAsFile();
      if (file) {
        e.preventDefault();
        void addImage(file);
      }
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  });
  function addElement(type: "text" | "shape", shape: Shape = "rect") {
    if (slide.elements.length >= 200)
      return notify("1ページの要素は200個までです。");
    const e: Element =
      type === "text"
        ? {
            id: uid(),
            type,
            x: 96,
            y: 180,
            w: 700,
            h: 140,
            text: "ここにことばを入力",
            fontSize: 40,
            bold: false,
            color: "#173d38",
          }
        : {
            id: uid(),
            type,
            shape,
            x: 320,
            y: 160,
            w: 260,
            h: 180,
            fill: "#b8d394",
            stroke: "#173d38",
          };
    updateSlide({ elements: [...slide.elements, e] });
    setSelected(e.id);
  }
  async function addImage(file: File) {
    const targetId = slide.id;
    try {
      if (
        !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
          file.type,
        )
      )
        throw new Error("PNG・JPEG・WebP・GIFの画像を選んでください。");
      if (file.size > 6_000_000) throw new Error("画像は6MBまでです。");
      if (slide.elements.length >= 200)
        throw new Error("1ページの要素は200個までです。");
      const src = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const img = new Image();
      img.src = src;
      await img.decode();
      const ratio = Math.min(
        600 / img.naturalWidth,
        360 / img.naturalHeight,
        1,
      );
      const w = Math.max(20, img.naturalWidth * ratio),
        h = Math.max(20, img.naturalHeight * ratio);
      const e: Element = {
        id: uid(),
        type: "image",
        src,
        x: (W - w) / 2,
        y: (H - h) / 2,
        w,
        h,
      };
      // File decoding is asynchronous: preserve edits and page navigation made in the meantime.
      const current = latestDeck.current;
      const target = current.slides.find((s) => s.id === targetId);
      if (!target) throw new Error("追加先のページが削除されました。");
      if (target.elements.length >= 200)
        throw new Error("1ページの要素は200個までです。");
      commit({
        ...current,
        slides: current.slides.map((s) =>
          s.id === targetId ? { ...s, elements: [...s.elements, e] } : s,
        ),
      });
      if (latestSlideId.current === targetId) setSelected(e.id);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "画像を読み込めませんでした。",
      );
    }
  }
  async function openFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > MAX_FILE_BYTES)
        throw new Error("ファイルは25MBまでです。");
      const next = parseDeck(await file.text());
      commit(next);
      setProtectSaved(false);
      setActiveId(next.slides[0].id);
      setView("map");
      setMoving(undefined);
      notify("ファイルを開きました。前の作品へは「もとに戻す」で戻れます。");
    } catch (error) {
      notify(error instanceof Error ? error.message : "読み込めませんでした。");
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([serializeDeck(deck)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${deck.title.replace(/[\\/:*?"<>|]/g, "_") || "VHSlide"}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("JSONファイルを保存しました。");
  }
  function add(at: Slide, dir: "right" | "down") {
    try {
      const next = insert(deck, at, dir);
      if (bounds(next).cols > 100 || bounds(next).rows > 100)
        throw new Error("縦・横は100マスまでです。");
      commit(next);
    } catch (e) {
      notify((e as Error).message);
    }
  }
  function dropAt(x: number, y: number, source = moving) {
    if (!source) return;
    if (
      source.mode === "slide" &&
      source.x === 0 &&
      source.y === 0 &&
      !deck.slides.some((s) => s.x === x && s.y === y)
    ) {
      notify("はじめのページは、ほかのページと入れかえてください。");
      setMoving(undefined);
      return;
    }
    // Moving an empty row/column into the origin would leave no starting slide.
    const next = swap(deck, source.mode, source, { x, y });
    if (!next.slides.some((s) => s.x === 0 && s.y === 0)) {
      notify("はじめのマスにページが残る場所を選んでください。");
      setMoving(undefined);
      return;
    }
    commit(next);
    setMoving(undefined);
  }
  function startPresent() {
    setActiveId(deck.slides.find((s) => s.x === 0 && s.y === 0)!.id);
    setDirection("right");
    setView("present");
    void document.documentElement.requestFullscreen?.().catch(() => {});
  }
  const iconSize = 17;
  return (
    <div className="app-shell">
      <input
        ref={jsonRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          void openFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={imageRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={(e) => {
          if (e.target.files?.[0]) void addImage(e.target.files[0]);
          e.target.value = "";
        }}
      />
      {view !== "present" && (
        <>
          <header className="app-header">
            <a
              className="brand"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setView("map");
              }}
              aria-label="VHSlide 全体マップ"
            >
              <span className="brand-icon">
                <LayoutGrid size={22} />
              </span>
              VH<span>Slide</span>
              <span className="beta">BETA</span>
            </a>
            <span className="header-divider" />
            <input
              className="deck-title"
              aria-label="作品のタイトル"
              maxLength={200}
              value={deck.title}
              onChange={(e) => commit({ ...deck, title: e.target.value })}
            />
            <span className="save-state">
              <Check size={14} />
              {saveStatus}
            </span>
            <div className="header-actions">
              <button
                className="quiet new-deck"
                onClick={() => {
                  const next: Deck = {
                    version: 1,
                    title: "あたらしい作品",
                    slides: [blank(0, 0)],
                  };
                  commit(next);
                  setActiveId(next.slides[0].id);
                  setSelected(undefined);
                  setView("map");
                  notify(
                    "白紙の作品を作りました。前の作品は「もとに戻す」で戻せます。",
                  );
                }}
              >
                <Plus size={iconSize} />
                <span>新しく</span>
              </button>
              <button
                className="quiet"
                onClick={() => jsonRef.current?.click()}
              >
                <Upload size={iconSize} />
                <span>開く</span>
              </button>
              <button className="button outline" onClick={download}>
                <Download size={iconSize} />
                <span>保存</span>
              </button>
              <button className="button primary" onClick={startPresent}>
                <Presentation size={iconSize} />
                <span>発表する</span>
              </button>
            </div>
          </header>
          <nav className="view-bar">
            <div className="view-tabs">
              <button
                className={view === "map" ? "active" : ""}
                onClick={() => setView("map")}
              >
                <LayoutGrid size={16} />
                全体マップ
              </button>
              <button
                className={view === "editor" ? "active" : ""}
                onClick={() => {
                  setView("editor");
                  setSelected(undefined);
                }}
              >
                <Type size={16} />
                ページを編集
              </button>
            </div>
            <div className="history">
              <button
                className="icon-button"
                aria-label="もとに戻す"
                title="もとに戻す (Ctrl+Z)"
                disabled={!past.length}
                onClick={undo}
              >
                <Undo2 size={18} />
              </button>
              <button
                className="icon-button"
                aria-label="やり直す"
                disabled={!future.length}
                onClick={redo}
              >
                <Redo2 size={18} />
              </button>
              <span className="small-divider" />
              <button className="quiet" onClick={() => setHelp((h) => !h)}>
                <CircleHelp size={17} />
                <span>使い方</span>
              </button>
            </div>
          </nav>
        </>
      )}
      {help && view !== "present" && (
        <aside className="help-panel">
          <div>
            <strong>よこに話題を、たてに発見を。</strong>
            <p>
              カードを押すと編集できます。右の＋で次の話題、下の＋で詳しいページを追加。
              <br />
              並べ替えはドラッグ、または「移動」→移動先をタップ。発表中は矢印キー・スワイプでも進めます。
            </p>
            <small>
              データはこのブラウザに保存されます。授業の終わりにはJSONファイルも保存しましょう。
            </small>
          </div>
          <button
            className="icon-button"
            aria-label="使い方を閉じる"
            onClick={() => setHelp(false)}
          >
            <X size={18} />
          </button>
        </aside>
      )}
      {view === "map" && (
        <MapView
          deck={deck}
          activeId={activeId}
          moving={moving}
          onMove={setMoving}
          dropAt={dropAt}
          add={add}
          onEdit={(id) => {
            setActiveId(id);
            setSelected(undefined);
            setView("editor");
          }}
          onDelete={(id) => {
            commit(removeSlide(deck, id));
            notify("ページを削除しました。「もとに戻す」で戻せます。");
          }}
          onAddCell={(x, y) => {
            if (deck.slides.length < 100)
              commit({ ...deck, slides: [...deck.slides, blank(x, y)] });
            else notify("ページは100枚までです。");
          }}
          onHelp={() => setHelp(true)}
        />
      )}
      {view === "editor" && (
        <Editor
          deck={deck}
          slide={slide}
          selected={selected}
          setSelected={setSelected}
          updateSlide={updateSlide}
          updateElement={updateElement}
          addElement={addElement}
          onBack={() => setView("map")}
          onImagePicker={() => imageRef.current?.click()}
          onFileDrop={(file) => {
            void addImage(file);
          }}
          onSelectSlide={(id) => {
            setActiveId(id);
            setSelected(undefined);
          }}
        />
      )}
      {view === "present" && (
        <PresentationView
          deck={deck}
          slide={slide}
          direction={direction}
          go={go}
          exitPresent={exitPresent}
        />
      )}
      {notice && (
        <div role="status" className="toast">
          {notice}
          <button aria-label="通知を閉じる" onClick={() => setNotice("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {protectSaved && view !== "present" && (
        <div className="recovery-banner">
          元データを保持しています。
          <button
            onClick={() => {
              setProtectSaved(false);
              notify("現在の作品で自動保存を再開しました。");
            }}
          >
            現在の作品で自動保存を再開
          </button>
        </div>
      )}
    </div>
  );
}
