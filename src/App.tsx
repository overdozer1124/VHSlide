import { useEffect, useRef, useState, useMemo } from "react";
import { flushSync } from "react-dom";
import { WorkspaceTransition } from "./WorkspaceTransition";
import type { WorkspaceFlight } from "./WorkspaceTransition";
import {
  Check,
  Cloud,
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
  MAX_SLIDES,
  insert,
  insertGridLine,
  duplicateSlide,
  duplicateRowGroup,
  editorNeighbor,
  rememberRowPage,
  swapRowGroups,
  insertMovedRowGroup,
  movePage,
  insertMovedPage,
  neighbor,
  parseDeck,
  removeSlide,
  removeRowGroup,
  rowPage,
  sample,
  serializeDeck,
  swap,
  uid,
  W,
} from "./model";
import { MapView } from "./MapView";
import { closestZoom, useWorkspacePreferences } from "./workspacePreferences";
import { Editor } from "./Editor";
import { PresentationView } from "./PresentationView";
import { ThumbnailMenu } from "./ThumbnailMenu";
import type {
  ThumbnailAction,
  ThumbnailMenuState,
  OpenThumbnailMenu,
} from "./ThumbnailMenu";
import { CloudWorkspace, portableDeck } from "./cloud";
import { CloudPanel } from "./CloudPanel";
import { CloudDocument } from "./CloudContext";
import {
  activeSheet,
  sheetList,
  sheetDeck,
  mergeSheet,
  changeSheet,
} from "./workbook";
import { SheetTabs } from "./SheetTabs";
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
  const [workbook, setWorkbookState] = useState(boot.deck);
  const latestWorkbook = useRef(workbook);
  latestWorkbook.current = workbook;
  function setWorkbook(next: Deck) {
    latestWorkbook.current = next;
    setWorkbookState(next);
  }
  const deck = useMemo(() => sheetDeck(workbook), [workbook]);
  function setDeck(next: Deck) {
    setWorkbook(mergeSheet(latestWorkbook.current, next));
  }
  const [cloud] = useState(() => new CloudWorkspace());
  const [, cloudChanged] = useState(0);
  const [past, setPast] = useState<Deck[]>([]),
    [future, setFuture] = useState<Deck[]>([]);
  const [view, setView] = useState<"map" | "editor" | "present">("map");
  const [activeId, setActiveId] = useState(deck.slides[0].id),
    [selected, setSelected] = useState<string>();
  const [notice, setNotice] = useState(boot.error ?? "");
  const [saveStatus, setSaveStatus] = useState("この端末に自動保存");
  const [protectSaved, setProtectSaved] = useState(!!boot.error);
  const [help, setHelp] = useState(false);
  const [preferences, setPreferences] = useWorkspacePreferences();
  const [mapScale, setMapScale] = useState(
    () => closestZoom(preferences.zoomSteps) / 100,
  );
  const [flight, setFlight] = useState<WorkspaceFlight>();
  const [moving, setMoving] = useState<GridMove>();
  const [thumbnailMenu, setThumbnailMenu] = useState<ThumbnailMenuState>();
  const [direction, setDirection] = useState("right");
  const jsonRef = useRef<HTMLInputElement>(null),
    imageRef = useRef<HTMLInputElement>(null);
  const slide = deck.slides.find((s) => s.id === activeId) ?? deck.slides[0];
  const latestDeck = useRef(deck);
  latestDeck.current = deck;
  const latestSlideId = useRef(slide.id);
  latestSlideId.current = slide.id;
  cloud.onState = () => cloudChanged((revision) => revision + 1);
  cloud.onDeck = (shared, reset) => {
    let preferences: Partial<Deck> = latestWorkbook.current;
    if (reset) {
      try {
        preferences = parseDeck(
          localStorage.getItem(`vhslide-cloud-deck:${cloud.active!.id}`) ?? "",
        );
      } catch {
        preferences = {};
      }
      setPast([]);
      setFuture([]);
      setSelected(undefined);
      setView("map");
      setActiveId(shared.slides[0].id);
    }
    const next = {
      ...shared,
      rowSelections: preferences.rowSelections,
      linkedRows: preferences.linkedRows,
      activeSheetId: preferences.activeSheetId,
    };
    setWorkbook(next);
  };
  useEffect(() => {
    cloud.onState = () => cloudChanged((revision) => revision + 1);
    void cloud.initialize();
    return () => {
      cloud.onState = () => {};
      cloud.dispose();
    };
  }, [cloud]);
  function returnToLocal() {
    cloud.detach();
    const next = initial().deck;
    setWorkbook(next);
    setPast([]);
    setFuture([]);
    setActiveId(next.slides[0].id);
    setSelected(undefined);
    setView("map");
    cloud.panel = false;
    cloud.onState();
  }
  function commitWorkbook(next: Deck, before = latestWorkbook.current) {
    try {
      const previous = latestWorkbook.current;
      if (next.slides.length > MAX_SLIDES)
        throw new Error(`作品全体で${MAX_SLIDES}ページまでです。`);
      serializeDeck(next);
      if (cloud.doc) next = cloud.apply(before, next);
      else setPast((p) => [...p.slice(-39), previous]);
      setFuture([]);
      setWorkbook(next);
      latestDeck.current = sheetDeck(next);
      return true;
    } catch (error) {
      notify((error as Error).message);
      return false;
    }
  }
  function commit(next: Deck, basedOn = deck) {
    try {
      return commitWorkbook(
        mergeSheet(latestWorkbook.current, next),
        mergeSheet(latestWorkbook.current, basedOn),
      );
    } catch (error) {
      notify((error as Error).message);
      return false;
    }
  }
  function selectSheet(id: string) {
    const next = { ...latestWorkbook.current, activeSheetId: id };
    setWorkbook(next);
    setActiveId(sheetDeck(next).slides[0].id);
    setSelected(undefined);
    setMoving(undefined);
    setThumbnailMenu(undefined);
    setFlight(undefined);
  }
  function sheetAction(
    action: Parameters<typeof changeSheet>[1],
    id: string,
    name?: string,
  ) {
    try {
      const next = changeSheet(latestWorkbook.current, action, id, name);
      if (commitWorkbook(next)) {
        setActiveId(sheetDeck(next).slides[0].id);
        setSelected(undefined);
        setMoving(undefined);
        setFlight(undefined);
      }
    } catch (error) {
      notify((error as Error).message);
    }
  }
  const editorNavigationActive = useRef(false);
  function selectEditorPage(id: string) {
    editorNavigationActive.current = true;
    const next = latestDeck.current.linkedRows
      ? latestDeck.current
      : rememberRowPage(latestDeck.current, id);
    latestDeck.current = next;
    setDeck(next);
    setActiveId(id);
    setSelected(undefined);
  }
  function switchWorkspace(
    destination: "map" | "editor",
    id = slide.id,
    from?: DOMRect,
  ) {
    const target = deck.slides.find((page) => page.id === id);
    const source =
      from ??
      (view === "map"
        ? document.querySelector(
            `[data-page-id="${CSS.escape(id)}"] .thumbnail`,
          )
        : document.querySelector(".editor-pager")
      )?.getBoundingClientRect();
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.isContentEditable)
      active.blur();
    flushSync(() => {
      if (destination === "editor") selectEditorPage(id);
      setView(destination);
      setSelected(undefined);
      setMoving(undefined);
      setThumbnailMenu(undefined);
      if (
        source &&
        target &&
        !matchMedia("(prefers-reduced-motion: reduce)").matches
      )
        setFlight({ slide: target, from: source, destination });
      else setFlight(undefined);
    });
  }
  function navigateEditor(dx: number, dy: number) {
    const current =
      latestDeck.current.slides.find((s) => s.id === activeId) ??
      latestDeck.current.slides[0];
    const next = editorNeighbor(latestDeck.current, current, dx, dy);
    if (next) selectEditorPage(next.id);
    return next;
  }
  function toggleLinkedRows() {
    const current = latestDeck.current;
    const restored = current.linkedRows ? rowPage(current, slide.y) : undefined;
    if (!commit({ ...current, linkedRows: !current.linkedRows }, current))
      return;
    if (restored) setActiveId(restored.id);
    setSelected(undefined);
  }
  const openThumbnailMenu: OpenThumbnailMenu = (event, target) => {
    event.preventDefault();
    event.stopPropagation();
    const trigger = event.currentTarget;
    const box = trigger.getBoundingClientRect();
    setThumbnailMenu({
      ...target,
      trigger,
      left: event.clientX || box.left,
      top: event.clientY || box.bottom,
    });
    setMoving(undefined);
  };
  function thumbnailAction(action: ThumbnailAction) {
    try {
      const current = latestDeck.current;
      let next: Deck;
      let chosen: Slide | undefined;
      if (action.kind === "duplicate-page") {
        next = duplicateSlide(current, action.id);
        chosen = next.slides.at(-1);
      } else if (action.kind === "duplicate-row") {
        next = duplicateRowGroup(current, action.y, action.count ?? 1);
        chosen =
          rowPage(next, action.y + 1, slide.x) ?? rowPage(next, action.y + 1);
      } else {
        next =
          action.kind === "delete-page"
            ? removeSlide(current, action.id)
            : removeRowGroup(current, action.y);
        chosen =
          next.slides.find((s) => s.id === slide.id) ??
          rowPage(next, Math.min(slide.y, bounds(next).rows - 1), slide.x) ??
          next.slides[0];
      }
      if (chosen) next = rememberRowPage(next, chosen.id);
      if (!commit(next, current)) return;
      setActiveId(chosen!.id);
      setSelected(undefined);
      editorNavigationActive.current = true;
      notify(
        action.kind.startsWith("duplicate")
          ? "複製しました。「もとに戻す」で戻せます。"
          : "削除しました。「もとに戻す」で戻せます。",
      );
    } catch (error) {
      notify((error as Error).message);
    }
  }
  useEffect(() => setThumbnailMenu(undefined), [view, deck]);
  function moveEditorItem(
    source: { kind: "row"; y: number } | { kind: "page"; id: string },
    x: number,
    y: number,
    mode: "swap" | "insert" = "swap",
  ) {
    try {
      const current = latestDeck.current;
      let next =
        source.kind === "row"
          ? mode === "insert"
            ? insertMovedRowGroup(current, source.y, y)
            : swapRowGroups(current, source.y, y)
          : mode === "insert"
            ? insertMovedPage(current, source.id, x, y)
            : movePage(current, source.id, x, y);
      if (next === current) return false;
      const chosen = source.kind === "page" ? source.id : activeId;
      next = rememberRowPage(next, chosen);
      if (!commit(next, current)) return false;
      if (source.kind === "page") {
        setActiveId(source.id);
        setSelected(undefined);
      }
      return true;
    } catch (error) {
      notify((error as Error).message);
      return false;
    }
  }
  function undo() {
    if (cloud.undoManager) {
      cloud.undoManager.undo();
      return;
    }
    if (!past.length) return;
    setFuture((f) => [workbook, ...f]);
    setWorkbook(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
  }
  function redo() {
    if (cloud.undoManager) {
      cloud.undoManager.redo();
      return;
    }
    if (!future.length) return;
    setPast((p) => [...p, workbook]);
    setWorkbook(future[0]);
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
      localStorage.setItem(
        cloud.active ? `vhslide-cloud-deck:${cloud.active.id}` : KEY,
        JSON.stringify(workbook),
      );
      setSaveStatus("この端末に保存済み");
    } catch {
      setSaveStatus("端末の保存容量が不足");
      setNotice(
        "自動保存できません。画像を減らすか、JSONファイルを保存してください。",
      );
    }
  }, [workbook, protectSaved]);
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
          "input,textarea,select,[contenteditable],[role=menu]",
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
      const editorSteps: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const target = event.target as HTMLElement;
      if (
        view === "editor" &&
        editorNavigationActive.current &&
        !event.defaultPrevented &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        editorSteps[event.key] &&
        (target === document.body || target.closest(".two-d-rail,.row-flyout"))
      ) {
        event.preventDefault();
        navigateEditor(...editorSteps[event.key]);
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
    editorNavigationActive.current = false;
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
    const roomId = cloud.active?.id;
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
      if (roomId) {
        e.src = await cloud.upload(file, roomId);
        if (cloud.active?.id !== roomId)
          throw new Error("追加先の作品が切り替わりました。");
      }
      // File decoding is asynchronous: preserve edits and page navigation made in the meantime.
      const current = latestWorkbook.current;
      const target = current.slides.find((s) => s.id === targetId);
      if (!target) throw new Error("追加先のページが削除されました。");
      if (target.elements.length >= 200)
        throw new Error("1ページの要素は200個までです。");
      commitWorkbook(
        {
          ...current,
          slides: current.slides.map((s) =>
            s.id === targetId ? { ...s, elements: [...s.elements, e] } : s,
          ),
        },
        current,
      );
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
      if (cloud.active) {
        cloud.detach();
        setPast([]);
        setFuture([]);
        latestDeck.current = next;
        setWorkbook(next);
      } else commitWorkbook(next);
      setProtectSaved(false);
      setActiveId(next.slides[0].id);
      setView("map");
      setMoving(undefined);
      notify("ファイルを開きました。前の作品へは「もとに戻す」で戻れます。");
    } catch (error) {
      notify(error instanceof Error ? error.message : "読み込めませんでした。");
    }
  }
  async function download() {
    try {
      const portable = cloud.active ? await portableDeck(workbook) : workbook;
      const url = URL.createObjectURL(
        new Blob([serializeDeck(portable)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `${deck.title.replace(/[\\/:*?"<>|]/g, "_") || "VHSlide"}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify("JSONファイルを保存しました。");
    } catch (error) {
      notify((error as Error).message);
    }
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
  function insertEditorLine(
    axis: "row" | "column",
    index: number,
    cross: number,
  ): boolean {
    try {
      const current = latestDeck.current;
      let next = insertGridLine(current, axis, index, cross);
      next = rememberRowPage(next, next.slides.at(-1)!.id);
      if (!commit(next, current)) return false;
      setActiveId(next.slides.at(-1)!.id);
      setSelected(undefined);
      return true;
    } catch (error) {
      notify((error as Error).message);
      return false;
    }
  }
  function createEditorPage(x: number, y: number): boolean {
    const current = latestDeck.current;
    if (current.slides.length >= MAX_SLIDES) {
      notify(`ページは${MAX_SLIDES}枚までです。`);
      return false;
    }
    if (current.slides.some((s) => s.x === x && s.y === y)) return false;
    const added = blank(x, y);
    if (
      !commit(
        rememberRowPage(
          { ...current, slides: [...current.slides, added] },
          added.id,
        ),
        current,
      )
    )
      return false;
    setActiveId(added.id);
    setSelected(undefined);
    return true;
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
  const cloudPresence =
    cloud.active && view !== "present" ? (
      <div className="cloud-presence">
        <Cloud size={14} />
        <span>{cloud.status}</span>
        <span>{cloud.members.length}人が参加中</span>
        <span className="cloud-participants">
          {cloud.members.map((member) => member.name).join("、")}
        </span>
        {cloud.error && <span role="alert">{cloud.error}</span>}
      </div>
    ) : null;
  const iconSize = 17;
  const historyActions = (
    <div className="history">
      <button
        className="icon-button"
        aria-label="もとに戻す"
        title={
          cloud.undoManager
            ? "自分の変更をもとに戻す (Ctrl+Z)"
            : "もとに戻す (Ctrl+Z)"
        }
        disabled={
          cloud.undoManager ? !cloud.undoManager.canUndo() : !past.length
        }
        onClick={undo}
      >
        <Undo2 size={18} />
      </button>
      <button
        className="icon-button"
        aria-label="やり直す"
        title={
          cloud.undoManager
            ? "自分の変更をやり直す (Ctrl+Shift+Z)"
            : "やり直す (Ctrl+Shift+Z)"
        }
        disabled={
          cloud.undoManager ? !cloud.undoManager.canRedo() : !future.length
        }
        onClick={redo}
      >
        <Redo2 size={18} />
      </button>
      <span className="small-divider" />
      <button
        className="quiet"
        aria-label="使い方"
        onClick={() => setHelp((h) => !h)}
      >
        <CircleHelp size={17} />
        <span>使い方</span>
      </button>
    </div>
  );
  return (
    <CloudDocument.Provider value={cloud.doc}>
      <div
        onPointerDownCapture={() => {
          if (flight) flushSync(() => setFlight(undefined));
        }}
        onKeyDownCapture={() => {
          if (flight) flushSync(() => setFlight(undefined));
        }}
        className={`app-shell ${view !== "present" ? "workspace-mode" : ""} ${view === "editor" ? "editing" : view === "map" ? "mapping" : ""} ${flight ? `workspace-transition-${flight.destination}` : ""}`}
      >
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
              {cloudPresence}
              <span className="save-state">
                <Check size={14} />
                {cloud.active ? cloud.status : saveStatus}
              </span>
              <div className="header-actions">
                {cloud.available && (
                  <button
                    className="quiet cloud-open"
                    aria-label="クラウド"
                    title="クラウド"
                    onClick={() => {
                      cloud.panel = true;
                      cloud.error = "";
                      cloud.onState();
                      void cloud.refresh().catch((error: Error) => {
                        cloud.error = error.message;
                        cloud.onState();
                      });
                    }}
                  >
                    <Cloud size={iconSize} />
                    <span>クラウド</span>
                  </button>
                )}
                <button
                  className="quiet new-deck"
                  aria-label="新しく"
                  title="新しく"
                  onClick={() => {
                    if (cloud.active) returnToLocal();
                    const next: Deck = {
                      version: 1,
                      title: "あたらしい作品",
                      slides: [blank(0, 0)],
                    };
                    commitWorkbook(next);
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
                  aria-label="開く"
                  title="開く"
                  onClick={() => jsonRef.current?.click()}
                >
                  <Upload size={iconSize} />
                  <span>開く</span>
                </button>
                <button
                  className="button outline"
                  aria-label="保存"
                  onClick={() => void download()}
                >
                  <Download size={iconSize} />
                  <span>保存</span>
                </button>
                <button
                  className="button primary"
                  aria-label="発表する"
                  onClick={startPresent}
                >
                  <Presentation size={iconSize} />
                  <span>発表する</span>
                </button>
              </div>
            </header>
            {view !== "editor" && (
              <nav className="view-bar">
                <div className="view-tabs">
                  <button
                    className={view === "map" ? "active" : ""}
                    onClick={() => switchWorkspace("map")}
                  >
                    <LayoutGrid size={16} />
                    全体マップ
                  </button>
                  <button
                    onClick={() => {
                      switchWorkspace("editor");
                    }}
                  >
                    <Type size={16} />
                    ページを編集
                  </button>
                </div>
                {historyActions}
              </nav>
            )}
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
                <br />
                マップはピンチで拡大すると編集画面へ、編集中はピンチインでマップへ戻ります。番号一覧や番号検索でも探せます。
                <br />
                編集中は文字・画像の上でも1本指でスワイプしてページを移動できます。タッチパッドは2本指で操作します。要素はタップして選び、移動ハンドルで動かします。
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
        {cloud.panel && (
          <CloudPanel cloud={cloud} deck={workbook} onLocal={returnToLocal} />
        )}
        {view !== "present" && (
          <MapView
            key={activeSheet(workbook).id}
            visible={view === "map"}
            deck={deck}
            activeId={activeId}
            moving={moving}
            onMove={setMoving}
            dropAt={dropAt}
            onInsertMove={(id, x, y) => {
              moveEditorItem({ kind: "page", id }, x, y, "insert");
              setMoving(undefined);
            }}
            add={add}
            onEdit={(id, rect) => switchWorkspace("editor", id, rect)}
            onSelect={selectEditorPage}
            onDelete={(id) => {
              commit(removeSlide(deck, id));
              notify("ページを削除しました。「もとに戻す」で戻せます。");
            }}
            onAddCell={(x, y) => {
              if (deck.slides.length < MAX_SLIDES)
                commit({ ...deck, slides: [...deck.slides, blank(x, y)] });
              else notify(`ページは${MAX_SLIDES}枚までです。`);
            }}
            zoomSteps={preferences.zoomSteps}
            onZoomSteps={(steps) => {
              setPreferences((previous) => ({ ...previous, zoomSteps: steps }));
              setMapScale((current) =>
                current === 0 ? 0 : closestZoom(steps, current * 100) / 100,
              );
            }}
            scale={mapScale}
            onScale={setMapScale}
            onOpenMenu={openThumbnailMenu}
          />
        )}
        {view === "editor" && (
          <Editor
            deck={deck}
            slide={slide}
            selected={selected}
            setSelected={(id) => {
              editorNavigationActive.current = false;
              setSelected(id);
            }}
            updateSlide={updateSlide}
            updateElement={updateElement}
            addElement={addElement}
            onInsert={insertEditorLine}
            onCreate={createEditorPage}
            onBack={(rect) => switchWorkspace("map", slide.id, rect)}
            onImagePicker={() => imageRef.current?.click()}
            onFileDrop={(file) => {
              void addImage(file);
            }}
            onSelectSlide={selectEditorPage}
            onNavigate={navigateEditor}
            onMove={moveEditorItem}
            onToggleLinkedRows={toggleLinkedRows}
            onOpenMenu={openThumbnailMenu}
            menuOpen={!!thumbnailMenu}
            historyActions={historyActions}
            railCollapsed={preferences.railCollapsed}
            railScale={preferences.railScale}
            onRailScale={(railScale) =>
              setPreferences((previous) => ({ ...previous, railScale }))
            }
            inspectorCollapsed={preferences.inspectorCollapsed}
            onToggleRail={() =>
              setPreferences((previous) => ({
                ...previous,
                railCollapsed: !previous.railCollapsed,
              }))
            }
            onToggleInspector={() =>
              setPreferences((previous) => ({
                ...previous,
                inspectorCollapsed: !previous.inspectorCollapsed,
              }))
            }
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
        {view !== "present" && (
          <SheetTabs
            sheets={sheetList(workbook)}
            activeId={activeSheet(workbook).id}
            onSelect={selectSheet}
            onAction={sheetAction}
          />
        )}
        {flight && (
          <WorkspaceTransition
            flight={flight}
            done={() => setFlight(undefined)}
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
        {thumbnailMenu && view !== "present" && (
          <ThumbnailMenu
            deck={deck}
            menu={thumbnailMenu}
            onClose={() => setThumbnailMenu(undefined)}
            onAction={thumbnailAction}
          />
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
    </CloudDocument.Provider>
  );
}
