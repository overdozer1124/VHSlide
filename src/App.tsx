import { FitReview } from "./FitReview";
import { fitKey, needsFitCheck } from "./checkContentFit";
import type { FitIssue } from "./contentFit";
import { SaveState } from "./SaveState";
import { BackupDialog } from "./BackupDialog";
import { batchAxes, removeSelectedPages } from "./mapBatch";
import { PageScopeSummary } from "./PageScopeSummary";
import {
  bindMapFilter,
  resolveMapFilter,
  resolvePageScope,
  type PageScope,
} from "./pageScope";
import {
  presentationState,
  presentationNeighbor,
  type PresentationSession,
} from "./presentationSession";
import { assignmentReadiness } from "./assignmentReadiness";
import { CacheRecoveryNotice } from "./CacheRecoveryNotice";
import { alignRichParagraphs } from "./richText";
import {
  expandGroups,
  groupElements,
  ungroupElements,
  resolveConnections,
  removeObjects,
} from "./structureData";
import { arrangeStructured } from "./structuredEditing";
import { coverCrop } from "./imageData";
import { duplicateObjects } from "./objectEditing";
import type { Arrange } from "./objectEditing";
import { createTable } from "./tableData";
import { SlideActionDialog } from "./SlideActionDialog";
import type { SlideAction } from "./SlideActionDialog";
import { ActionMenu } from "./ActionMenu";
import { assignedSlides, routeSlides } from "./learningTools";
import { hostAccess } from "./permissions";
import { saveLocalVersion } from "./localHistory";
import { CloudRecoveryNotice } from "./CloudRecoveryNotice";
import { useEffect, useRef, useState, useMemo, lazy, Suspense } from "react";
import { flushSync } from "react-dom";
import { WorkspaceTransition } from "./WorkspaceTransition";
import type { WorkspaceFlight } from "./WorkspaceTransition";
import {
  Cloud,
  CircleHelp,
  History,
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
import { thumbnailLabel } from "./ThumbnailFooter";
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
import { matchesFilter } from "./mapFilter";
import type { MapFilter } from "./mapFilter";
const ReleaseHistory = lazy(() => import("./ReleaseHistory"));
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
  const [cloud] = useState(() => new CloudWorkspace());
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
  const [viewFilters, setViewFilters] = useState<
    Record<string, { filter?: MapFilter; editor: boolean }>
  >({});
  const currentSheetId = activeSheet(workbook).id;
  const rawSheetFilter = viewFilters[currentSheetId];
  const sheetFilter = useMemo(
    () =>
      rawSheetFilter?.filter
        ? {
            ...rawSheetFilter,
            filter: resolveMapFilter(
              workbook,
              currentSheetId,
              rawSheetFilter.filter,
              cloud.active ? cloud.access : hostAccess(),
            ).filter,
          }
        : rawSheetFilter,
    [rawSheetFilter, workbook, currentSheetId, cloud.access, cloud.active?.id],
  );
  const mapScope = useMemo<PageScope>(
    () =>
      rawSheetFilter?.filter
        ? {
            kind: "filter",
            sheetId: currentSheetId,
            filter: rawSheetFilter.filter,
          }
        : { kind: "sheet", sheetId: currentSheetId },
    [rawSheetFilter?.filter, currentSheetId],
  );
  const mapResolvedScope = useMemo(
    () =>
      resolvePageScope(
        workbook,
        mapScope,
        cloud.active ? cloud.access : hostAccess(),
      ),
    [workbook, mapScope, cloud.access, cloud.active?.id],
  );
  const filterEditor = sheetFilter?.editor ?? true;
  const editorFiltered = !!sheetFilter?.filter && filterEditor;
  const navigationDeck = useMemo(
    () =>
      editorFiltered
        ? {
            ...deck,
            slides: deck.slides.filter((s) =>
              matchesFilter(s, sheetFilter!.filter!),
            ),
          }
        : deck,
    [deck, editorFiltered, sheetFilter?.filter],
  );
  const latestNavigationDeck = useRef(navigationDeck);
  latestNavigationDeck.current = navigationDeck;
  function setMapFilter(filter?: MapFilter) {
    const id = activeSheet(workbook).id;
    setViewFilters((previous) => ({
      ...previous,
      [id]: {
        editor: previous[id]?.editor ?? true,
        filter: filter
          ? bindMapFilter(latestWorkbook.current, id, filter)
          : undefined,
      },
    }));
  }
  function setFilterEditor(editor: boolean) {
    const id = activeSheet(workbook).id;
    setViewFilters((previous) => ({
      ...previous,
      [id]: { ...previous[id], editor },
    }));
  }
  const [, cloudChanged] = useState(0);
  const [past, setPast] = useState<Deck[]>([]),
    [future, setFuture] = useState<Deck[]>([]);
  const [view, setView] = useState<"map" | "editor" | "present">("map");
  const [backupOpen, setBackupOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState<SlideAction>();
  type FitRequest = {
    ids: string[];
    label: string;
    mode: PresentationSession["mode"];
    startId?: string;
  };
  const [fitRequest, setFitRequest] = useState<FitRequest>();
  const [deferredFit, setDeferredFit] = useState<FitRequest>();
  const [pdfResume, setPdfResume] = useState<{
    scope: PageScope;
    ids: string[];
  }>();
  const [presentation, setPresentation] = useState<PresentationSession>();
  const [pendingPresentationLink, setPendingPresentationLink] =
    useState<string>();
  const [mapReturnScroll, setMapReturnScroll] = useState<{
    token: number;
    left: number;
    top: number;
  }>();
  const presentationMissing = useRef(new Set<string>());
  const editorScope = useMemo<PageScope>(
    () =>
      editorFiltered || mapScope.kind === "sheet"
        ? mapScope
        : { kind: "sheet", sheetId: currentSheetId },
    [editorFiltered, mapScope, currentSheetId],
  );
  const actionScope = view === "editor" ? editorScope : mapScope;
  const actionResolvedScope = useMemo(
    () =>
      actionScope === mapScope
        ? mapResolvedScope
        : resolvePageScope(
            workbook,
            actionScope,
            cloud.active ? cloud.access : hostAccess(),
          ),
    [
      workbook,
      actionScope,
      mapScope,
      mapResolvedScope,
      cloud.access,
      cloud.active?.id,
    ],
  );
  const localHistoryTime = useRef(0);
  const [historyPending, setHistoryPending] = useState(false);
  const [activeId, setActiveId] = useState(deck.slides[0].id),
    [selected, setPrimarySelected] = useState<string>();
  const [selectionIds, setSelectionIds] = useState<string[]>([]);
  function setSelected(id?: string) {
    setPrimarySelected(id);
    setSelectionIds(id ? [id] : []);
  }
  function selectObjects(id?: string, additive = false, inside = false) {
    if (!id) return setSelected();
    const ids = inside ? [id] : expandGroups(slide.elements, [id]);
    const previous = additive ? expandGroups(slide.elements, selectionIds) : [];
    const next =
      additive && ids.every((i) => previous.includes(i))
        ? previous.filter((i) => !ids.includes(i))
        : [...new Set([...previous, ...ids])];
    setSelectionIds(next);
    setPrimarySelected(next.includes(id) ? id : next.at(-1));
  }
  const [objectTrail, setObjectTrail] = useState<{ slideId: string }[]>([]);
  const [notice, setNotice] = useState(boot.error ?? "");
  const [noticeLibrary, setNoticeLibrary] = useState(false);
  const [cloudInitialTab, setCloudInitialTab] = useState<
    "library" | undefined
  >();
  const fileOpenEpoch = useRef(0);
  const [saveStatus, setSaveStatus] = useState("この端末に自動保存");
  const [protectSaved, setProtectSaved] = useState(!!boot.error);
  const [help, setHelp] = useState(false);
  const [updatesOpen, setUpdatesOpen] = useState(
    () => location.hash === "#updates",
  );
  useEffect(() => {
    const sync = () => setUpdatesOpen(location.hash === "#updates");
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
    };
  }, []);
  function openUpdates() {
    history.pushState(
      null,
      "",
      `${location.pathname}${location.search}#updates`,
    );
    setUpdatesOpen(true);
  }
  function closeUpdates() {
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    setUpdatesOpen(false);
  }

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
  const presenting = useMemo(
    () =>
      presentation
        ? presentationState(
            workbook,
            presentation,
            activeId,
            objectTrail.length > 0,
          )
        : undefined,
    [workbook, presentation, activeId, objectTrail.length],
  );
  const slide =
    (view === "present" ? presenting?.slide : undefined) ??
    (view === "editor"
      ? (navigationDeck.slides.find((s) => s.id === activeId) ??
        navigationDeck.slides[0])
      : deck.slides.find((s) => s.id === activeId)) ??
    deck.slides[0];
  useEffect(() => {
    const valid = new Set(slide.elements.map((e) => e.id));
    if (selectionIds.some((id) => !valid.has(id))) {
      const next = selectionIds.filter((id) => valid.has(id));
      setSelectionIds(next);
      setPrimarySelected(next.at(-1));
    }
  }, [slide.id, slide.elements, selectionIds]);
  const latestDeck = useRef(deck);
  latestDeck.current = deck;
  const latestSlideId = useRef(slide.id);
  latestSlideId.current = slide.id;
  cloud.onState = () => cloudChanged((revision) => revision + 1);
  cloud.onDeck = (shared, reset) => {
    let preferences: Partial<Deck> = latestWorkbook.current;
    if (reset) {
      setViewFilters({});
      setFitRequest(undefined);
      setDeferredFit(undefined);
      setPdfResume(undefined);
      setMapReturnScroll(undefined);
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
    if (
      cloud.active &&
      (cloud.saveSnapshot.notesDirty ||
        cloud.saveSnapshot.notesFailed ||
        cloud.saveSnapshot.notesSaving)
    ) {
      notify(
        "付箋の保存が完了していません。再試行してから作品を切り替えてください。JSONには付箋は含まれません。",
      );
      return false;
    }
    cloud.detach();
    setViewFilters({});
    setFitRequest(undefined);
    setDeferredFit(undefined);
    setPdfResume(undefined);
    setMapReturnScroll(undefined);
    const next = initial().deck;
    setWorkbook(next);
    setPast([]);
    setFuture([]);
    setActiveId(next.slides[0].id);
    setSelected(undefined);
    setView("map");
    cloud.panel = false;
    cloud.onState();
    return true;
  }
  function commitWorkbook(
    next: Deck,
    before = latestWorkbook.current,
    historyReady = false,
  ) {
    try {
      const previous = latestWorkbook.current;
      if (next.slides.length > MAX_SLIDES)
        throw new Error(`作品全体で${MAX_SLIDES}ページまでです。`);
      serializeDeck(next);
      if (cloud.doc) next = cloud.apply(before, next);
      else {
        const deleted = previous.slides.some(
          (s) => !next.slides.some((t) => t.id === s.id),
        );
        if (deleted && !historyReady) {
          setHistoryPending(true);
          let timer: ReturnType<typeof setTimeout>;
          const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    "保存に時間がかかっています。もう一度操作してください。",
                  ),
                ),
              10000,
            );
          });
          void Promise.race([saveLocalVersion(previous, "削除する前"), timeout])
            .then(() => {
              if (latestWorkbook.current !== previous) {
                notify(
                  "保存中に作品が変わりました。削除をもう一度操作してください。",
                );
                return;
              }
              commitWorkbook(next, before, true);
            })
            .catch((error) =>
              notify(
                `削除を中止しました。版を保存できません。${error.message}`,
              ),
            )
            .finally(() => {
              clearTimeout(timer);
              setHistoryPending(false);
            });
          return true;
        }
        if (!historyReady && Date.now() - localHistoryTime.current >= 300_000) {
          localHistoryTime.current = Date.now();
          void saveLocalVersion(previous, "自動保存").catch((error) =>
            notify(`版を保存できませんでした。${error.message}`),
          );
        }
        setPast((p) => [...p.slice(-39), previous]);
      }
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
  function changeFooter(id: string, text: string) {
    const book = latestWorkbook.current,
      page = book.slides.find((s) => s.id === id);
    if (!page || !cloud.canEdit(page)) return;
    commitWorkbook({
      ...book,
      slides: book.slides.map((s) => {
        if (s.id !== id) return s;
        const next = { ...s };
        if (text) next.footerLabel = text;
        else delete next.footerLabel;
        return next;
      }),
    });
  }
  function selectSheet(id: string) {
    setMapReturnScroll(undefined);
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
    if (!cloud.isHost) {
      notify("シートの設定はホストだけが変更できます。");
      return false;
    }
    try {
      const next = changeSheet(latestWorkbook.current, action, id, name);
      const switched =
        activeSheet(next).id !== activeSheet(latestWorkbook.current).id;
      if (next === latestWorkbook.current) return true;
      if (!commitWorkbook(next)) return false;
      if (switched) {
        setActiveId(sheetDeck(next).slides[0].id);
        setSelected(undefined);
        setMoving(undefined);
        setFlight(undefined);
      }
      return true;
    } catch (error) {
      notify((error as Error).message);
      return false;
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
    if (
      destination === "editor" &&
      editorFiltered &&
      !navigationDeck.slides.some((s) => s.id === id)
    ) {
      if (!navigationDeck.slides.length) {
        notify(
          "フィルタ対象のページがありません。マップで条件を変更してください。",
        );
        return;
      }
      id = navigationDeck.slides[0].id;
    }
    setMapReturnScroll(undefined);
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
      else setActiveId(id);
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
      latestNavigationDeck.current.slides.find((s) => s.id === activeId) ??
      latestNavigationDeck.current.slides[0];
    if (!current) return undefined;
    const next = editorNeighbor(latestNavigationDeck.current, current, dx, dy);
    if (next) selectEditorPage(next.id);
    return next;
  }
  function toggleLinkedRows() {
    const current = latestDeck.current;
    const restored = current.linkedRows ? rowPage(current, slide.y) : undefined;
    if (!commit({ ...current, linkedRows: !current.linkedRows }, current))
      return;
    if (
      restored &&
      (!editorFiltered ||
        navigationDeck.slides.some((s) => s.id === restored.id))
    )
      setActiveId(restored.id);
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
          : cloud.isHost
            ? "削除しました。「もとに戻す」で戻せます。"
            : "削除しました。削除済みの画像・付箋を戻す場合はホストに依頼してください。",
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
        s.id === slide.id
          ? {
              ...s,
              ...patch,
              ...(patch.elements
                ? { elements: resolveConnections(patch.elements) }
                : {}),
            }
          : s,
      ),
    });
  }
  function updateElement(patch: Partial<Element>) {
    updateSlide({
      elements: resolveConnections(slide.elements).map((e) =>
        e.id === selected
          ? {
              ...e,
              ...patch,
              ...(patch.textAlign && e.richText && patch.richText === undefined
                ? { richText: alignRichParagraphs(e.richText, patch.textAlign) }
                : {}),
            }
          : e,
      ),
    });
  }
  function arrangeObjects(action: Arrange) {
    updateSlide({
      elements: arrangeStructured(slide.elements, selectionIds, action),
    });
  }
  function duplicateSelection() {
    const result = duplicateObjects(slide.elements, selectionIds);
    if (result.elements.length > 200)
      return notify("1ページの要素は200個までです。");
    updateSlide({ elements: result.elements });
    setSelectionIds(result.ids);
    setPrimarySelected(result.ids.at(-1));
  }
  function deleteSelection() {
    updateSlide({
      elements: removeObjects(slide.elements, selectionIds),
    });
    setSelected(undefined);
  }
  function insertStructure(elements: Element[]) {
    if (slide.elements.length + elements.length > 200)
      return notify("1ページの要素は200個までです。");
    updateSlide({ elements: [...slide.elements, ...elements] });
    setSelectionIds(elements.map((e) => e.id));
    setPrimarySelected(elements[0]?.id);
  }
  function groupSelection() {
    const ids = expandGroups(slide.elements, selectionIds);
    updateSlide({ elements: groupElements(slide.elements, ids, uid) });
    setSelectionIds(ids);
  }
  function ungroupSelection() {
    updateSlide({ elements: ungroupElements(slide.elements, selectionIds) });
  }
  function followPresentationLink(id: string) {
    const target = latestWorkbook.current.slides.find((s) => s.id === id);
    if (!target || !presentation)
      return notify("リンク先のページが見つかりません。");
    setObjectTrail((previous) =>
      [...previous, { slideId: presenting?.slide?.id ?? activeId }].slice(-30),
    );
    setActiveId(id);
    setPendingPresentationLink(undefined);
    setSelected();
  }
  function openObjectLink(id: string) {
    const current = latestWorkbook.current,
      target = current.slides.find((s) => s.id === id);
    if (!target) return notify("リンク先のページが見つかりません。");
    if (view === "present") {
      if (!presentation?.ids.includes(id)) {
        setPendingPresentationLink(id);
        return;
      }
      return followPresentationLink(id);
    }
    const sheetId = target.sheetId ?? "main",
      preference = viewFilters[sheetId];
    if (
      preference?.filter &&
      preference.editor !== false &&
      !matchesFilter(
        target,
        resolveMapFilter(
          current,
          sheetId,
          preference.filter,
          cloud.active ? cloud.access : hostAccess(),
        ).filter,
      )
    ) {
      setViewFilters((previous) => ({
        ...previous,
        [sheetId]: { ...previous[sheetId], editor: false },
      }));
      notify(
        "リンク先を表示するため、編集画面のフィルタを一時的に外しました。マップの絞り込みは残っています。",
      );
    }
    editorNavigationActive.current = false;
    setWorkbook({ ...current, activeSheetId: sheetId });
    setActiveId(id);
    setSelected();
  }
  function backFromObjectLink() {
    const current = latestWorkbook.current;
    let i = objectTrail.length - 1;
    while (
      i >= 0 &&
      !current.slides.some((s) => s.id === objectTrail[i].slideId)
    )
      i--;
    const id = i >= 0 ? objectTrail[i].slideId : presenting?.pages[0]?.id;
    setObjectTrail(i >= 0 ? objectTrail.slice(0, i) : []);
    if (id) setActiveId(id);
    else notify("戻るページが見つかりません。");
  }
  useEffect(() => {
    if (
      pendingPresentationLink &&
      !workbook.slides.some((s) => s.id === pendingPresentationLink)
    ) {
      setPendingPresentationLink(undefined);
      notify("リンク先のページが削除されました。");
    }
  }, [pendingPresentationLink, workbook]);
  function notify(message: string) {
    setNoticeLibrary(false);
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
    if (!presentation || !presenting) return;
    const next = presentationNeighbor(presenting, presentation.mode, dx, dy);
    if (next) {
      setDirection(dx > 0 ? "right" : dx < 0 ? "left" : dy > 0 ? "down" : "up");
      setActiveId(next.id);
    }
  }
  function exitPresent(reason?: string) {
    const origin = presentation?.returnTo,
      current = latestWorkbook.current;
    setObjectTrail([]);
    setPendingPresentationLink(undefined);
    setPresentation(undefined);
    if (document.fullscreenElement)
      void document.exitFullscreen().catch(() => {});
    const sheet =
      sheetList(current).find((s) => s.id === origin?.sheetId) ??
      sheetList(current)[0];
    const page =
      current.slides.find(
        (s) => s.id === origin?.activeId && (s.sheetId ?? "main") === sheet.id,
      ) ?? current.slides.find((s) => (s.sheetId ?? "main") === sheet.id);
    setWorkbook({ ...current, activeSheetId: sheet.id });
    if (page) setActiveId(page.id);
    setView(origin?.view ?? "map");
    if (origin?.view === "map" && origin.scroll)
      setMapReturnScroll({ token: Date.now(), ...origin.scroll });
    if (origin && !sheetList(current).some((s) => s.id === origin.sheetId))
      notify(
        `${reason ?? "発表を終了しました。"} 元のシートが削除されたため、${sheet.name}を表示しています。`,
      );
    else if (reason) notify(reason);
  }
  useEffect(() => {
    if (view !== "present" || !presentation || !presenting) return;
    if (cloud.viewingRevoked) {
      exitPresent("作品へのアクセスが終了したため、発表を停止しました。");
      return;
    }
    if (!presenting.pages.length) {
      exitPresent("発表対象のページがすべて削除されました。");
      return;
    }
    const liveIds = new Set(workbook.slides.map((s) => s.id)),
      missing = new Set(presentation.ids.filter((id) => !liveIds.has(id)));
    const removed = [...missing].filter(
      (id) => !presentationMissing.current.has(id),
    );
    presentationMissing.current = missing;
    if (removed.length)
      notify(`発表対象の${removed.length}ページが削除されました。`);
    if (presenting.slide && presenting.slide.id !== activeId) {
      setActiveId(presenting.slide.id);
      if (!liveIds.has(activeId) && objectTrail.length) setObjectTrail([]);
    }
  }, [
    view,
    presentation,
    presenting,
    workbook,
    activeId,
    cloud.viewingRevoked,
  ]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        cloud.viewingRevoked ||
        updatesOpen ||
        cloud.panel ||
        toolsOpen ||
        fitRequest ||
        backupOpen ||
        historyPending
      )
        return;
      if (
        (event.target as HTMLElement).closest(
          "input,textarea,select,[contenteditable],[role=menu]",
        )
      )
        return;
      if (view === "present") {
        if (pendingPresentationLink) {
          if (event.key === "Escape") {
            event.preventDefault();
            setPendingPresentationLink(undefined);
          }
          return;
        }
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
        ["Delete", "Backspace"].includes(event.key) &&
        !target.closest(".inspector")
      ) {
        event.preventDefault();
        deleteSelection();
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
        cloud.viewingRevoked ||
        updatesOpen ||
        cloud.panel ||
        toolsOpen ||
        fitRequest ||
        backupOpen ||
        historyPending
      )
        return;
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
  function addElement(
    type: "text" | "shape" | "line",
    shape: Shape = "rect",
    lineKind: Element["lineKind"] = "straight",
    endArrow: Element["endArrow"] = "none",
    startArrow: Element["startArrow"] = "none",
  ) {
    editorNavigationActive.current = false;
    if (slide.elements.length >= 200)
      return notify("1ページの要素は200個までです。");
    const e: Element =
      type === "line"
        ? {
            id: uid(),
            type,
            x: 280,
            y: 230,
            w: 360,
            h: 80,
            stroke: "#173d38",
            strokeWidth: 3,
            strokeDash: "solid",
            lineKind,
            startArrow,
            endArrow,
            lineStart: { x: 0, y: lineKind === "straight" ? 50 : 80 },
            lineEnd: { x: 100, y: lineKind === "straight" ? 50 : 20 },
          }
        : type === "text"
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
              text: "",
              fontSize: 24,
              color: "#173d38",
              textAlign: "center",
              verticalAlign: "middle",
            };
    updateSlide({ elements: [...slide.elements, e] });
    setSelected(e.id);
  }
  function addTable(rows: number, columns: number) {
    editorNavigationActive.current = false;
    if (slide.elements.length >= 200)
      return notify("1ページの要素は200個までです。");
    const element: Element = {
      id: uid(),
      type: "table",
      x: 100,
      y: 100,
      w: 760,
      h: 330,
      table: createTable(rows, columns, uid),
      fontSize: 24,
      color: "#173d38",
      fill: "#ffffff",
      stroke: "#79958b",
      textAlign: "left",
    };
    updateSlide({ elements: [...slide.elements, element] });
    setSelected(element.id);
  }
  async function addImage(file: File, replaceId?: string) {
    const target = latestDeck.current.slides.find((s) => s.id === activeId);
    if (target && !cloud.canEdit(target)) {
      notify("このスライドは閲覧のみです。");
      return;
    }
    const targetId = slide.id;
    const originalImage = replaceId
      ? target?.elements.find((e) => e.id === replaceId && e.type === "image")
      : undefined;
    if (replaceId && !originalImage)
      return notify("差し替える画像が見つかりません。");
    const roomId = cloud.active?.id;
    try {
      if (
        !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
          file.type,
        )
      )
        throw new Error("PNG・JPEG・WebP・GIFの画像を選んでください。");
      if (file.size > 6_000_000) throw new Error("画像は6MBまでです。");
      if (!replaceId && slide.elements.length >= 200)
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
      if (!replaceId && target.elements.length >= 200)
        throw new Error("1ページの要素は200個までです。");
      const prior = replaceId
        ? target.elements.find((e) => e.id === replaceId)
        : undefined;
      if (replaceId && (!prior || prior.src !== originalImage?.src))
        throw new Error(
          "差し替え中に画像が変更・削除されました。もう一度選んでください。",
        );
      const replacement = prior
        ? {
            ...prior,
            src: e.src,
            crop: coverCrop(
              img.naturalWidth / img.naturalHeight,
              ((prior.rotation ?? 0) % 180 ? prior.h : prior.w) /
                ((prior.rotation ?? 0) % 180 ? prior.w : prior.h),
            ),
          }
        : undefined;
      commitWorkbook(
        {
          ...current,
          slides: current.slides.map((s) =>
            s.id === targetId
              ? {
                  ...s,
                  elements: replacement
                    ? s.elements.map((item) =>
                        item.id === replaceId ? replacement : item,
                      )
                    : [...s.elements, e],
                }
              : s,
          ),
        },
        current,
      );
      if (latestSlideId.current === targetId) setSelected(replaceId ?? e.id);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "画像を読み込めませんでした。",
      );
    }
  }
  async function openFile(file?: File) {
    if (!file) return;
    const epoch = ++fileOpenEpoch.current;
    try {
      if (file.size > MAX_FILE_BYTES)
        throw new Error("ファイルは25MBまでです。");
      const next = parseDeck(await file.text());
      const previous = latestWorkbook.current,
        source = cloud.active?.id,
        doc = cloud.doc;
      if (source) await cloud.prepareBackup();
      else await saveLocalVersion(previous, "ファイルを開く前");
      if (
        epoch !== fileOpenEpoch.current ||
        previous !== latestWorkbook.current ||
        source !== cloud.active?.id ||
        doc !== cloud.doc
      )
        throw new Error(
          "読み込み中に作品が変わりました。もう一度ファイルを開いてください。",
        );
      setViewFilters({});
      setFitRequest(undefined);
      setDeferredFit(undefined);
      setPdfResume(undefined);
      setMapReturnScroll(undefined);
      if (source) {
        cloud.detach();
        setPast([]);
        setFuture([]);
        latestDeck.current = next;
        setWorkbook(next);
      } else if (!commitWorkbook(next, previous, true)) return;
      setProtectSaved(false);
      setActiveId(next.slides[0].id);
      setView("map");
      setMoving(undefined);
      notify(
        source
          ? "JSONを端末の作品として開きました。元のクラウド作品は作品一覧から開けます。"
          : "ファイルを開きました。前の作品へは「もとに戻す」で戻れます。",
      );
      setNoticeLibrary(!!source);
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
      notify(
        "JSONファイルを作成しました。ダウンロード先を確認してください。付箋・共有設定・過去の版は含みません。",
      );
      return true;
    } catch (error) {
      notify((error as Error).message);
      return false;
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
  function launchPresentation(
    ids: string[],
    label: string,
    mode: PresentationSession["mode"],
    startId?: string,
  ) {
    if (!ids.length) {
      notify(
        "対象のページがありません。フィルタの条件を変更するか、解除してください。",
      );
      return;
    }
    const scroll = document.querySelector<HTMLElement>(".map-scroll");
    setPresentation({
      mode,
      ids: [...ids],
      label,
      returnTo: {
        view: view === "editor" ? "editor" : "map",
        sheetId: currentSheetId,
        activeId: view === "editor" ? slide.id : activeId,
        ...(view === "map" && scroll
          ? { scroll: { left: scroll.scrollLeft, top: scroll.scrollTop } }
          : {}),
      },
    });
    setMapReturnScroll(undefined);
    presentationMissing.current = new Set();
    setObjectTrail([]);
    setPendingPresentationLink(undefined);
    setToolsOpen(undefined);
    setFlight(undefined);
    setActiveId(startId && ids.includes(startId) ? startId : ids[0]);
    setDirection("right");
    setView("present");
    try {
      void document.documentElement.requestFullscreen?.().catch(() => {});
    } catch {
      /* Windowed presentation remains available. */
    }
  }
  function beginPresentation(
    ids: string[],
    label: string,
    mode: PresentationSession["mode"],
    startId?: string,
  ) {
    setDeferredFit(undefined);
    const pages = latestWorkbook.current.slides.filter((p) =>
      ids.includes(p.id),
    );
    if (needsFitCheck(pages)) {
      setToolsOpen(undefined);
      setFitRequest({ ids, label, mode, startId });
    } else launchPresentation(ids, label, mode, startId);
  }
  function fixFitIssue(issue: FitIssue) {
    if (!issue.pageId) return;
    openObjectLink(issue.pageId);
    setView("editor");
    setSelected(issue.elementId);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (issue.cellKey)
          document
            .querySelector<HTMLTextAreaElement>(
              `.editor-workspace [data-element-id="${CSS.escape(issue.elementId)}"] textarea[data-cell="${CSS.escape(issue.cellKey)}"]`,
            )
            ?.focus({ preventScroll: true });
      }),
    );
  }
  function startRoute(id: string) {
    const route = workbook.routes?.find((r) => r.id === id),
      pages = route ? routeSlides(workbook, route) : [];
    beginPresentation(
      pages.map((s) => s.id),
      route?.name ?? "保存済みルート",
      "route",
    );
  }
  function startPresent(scope: PageScope = actionScope, fromCurrent = false) {
    const resolved = resolvePageScope(
      latestWorkbook.current,
      scope,
      cloud.active ? cloud.access : hostAccess(),
    );
    beginPresentation(
      resolved.ids,
      resolved.label,
      "spatial",
      fromCurrent ? slide.id : undefined,
    );
  }
  const cloudPresence =
    cloud.active && view !== "present" ? (
      <div className="cloud-presence">
        <Cloud size={14} />
        <SaveState cloud={cloud} />
        <span>
          {cloud.isHost
            ? "ホスト"
            : cloud.access.mode === "none"
              ? "閲覧のみ"
              : cloud.access.mode === "scoped"
                ? assignmentReadiness(workbook, cloud.access).kind === "waiting"
                  ? "担当ページの準備待ち"
                  : "指定範囲を編集"
                : "スライドを編集"}
        </span>
        <span>{cloud.members.length}人が参加中</span>
        <span className="cloud-participants">
          {cloud.members.map((member) => member.name).join("、")}
        </span>
        {cloud.error && !cloud.needsAttention && !cloud.canRetryConnection && (
          <span role="alert">{cloud.error}</span>
        )}
      </div>
    ) : null;
  const iconSize = 17;
  const historyActions = (
    <div className="history">
      <button
        className="icon-button updates-button"
        aria-label="更新履歴"
        title="更新履歴"
        onClick={openUpdates}
      >
        <History size={18} />
        <span>更新履歴</span>
      </button>
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
  if (cloud.viewingRevoked)
    return (
      <CloudDocument.Provider value={cloud.doc}>
        <main className="access-revoked" role="alert">
          <h1>作品へのアクセスを確認してください</h1>
          <p>
            参加権限またはログイン状態が変わったため、作品の表示を停止しました。
          </p>
          <button className="button primary" onClick={() => location.reload()}>
            ログイン状態を確認して開き直す
          </button>
          <button
            className="button outline"
            onClick={() => {
              cloud.panel = true;
              cloud.onState();
              void cloud.refresh().catch((error) => {
                cloud.error = error.message;
                cloud.onState();
              });
            }}
          >
            作品一覧を開く
          </button>
        </main>
        {cloud.panel && (
          <Suspense fallback={<p role="status">作品一覧を読み込み中…</p>}>
            <CloudPanel
              cloud={cloud}
              deck={workbook}
              onLocal={returnToLocal}
              initialTab="library"
            />
          </Suspense>
        )}
      </CloudDocument.Provider>
    );
  return (
    <CloudDocument.Provider value={cloud.doc}>
      <div
        inert={updatesOpen || cloud.panel || historyPending}
        onPointerDownCapture={(event) => {
          if (flight && event.pointerType !== "touch") flushSync(() => setFlight(undefined));
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
                readOnly={!cloud.isHost}
                maxLength={200}
                value={deck.title}
                onChange={(e) => commit({ ...deck, title: e.target.value })}
              />
              {cloudPresence}
              <SaveState cloud={cloud} local={saveStatus} />
              <div className="header-actions">
                {cloud.available && (
                  <button
                    className="quiet cloud-open"
                    aria-label="クラウド"
                    title="クラウド"
                    onClick={() => {
                      setCloudInitialTab(undefined);
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
                    if (cloud.active && !returnToLocal()) return;
                    const next: Deck = {
                      version: 1,
                      title: "あたらしい作品",
                      slides: [blank(0, 0)],
                    };
                    setViewFilters({});
                    setFitRequest(undefined);
                    setDeferredFit(undefined);
                    setPdfResume(undefined);
                    setMapReturnScroll(undefined);
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
                <div className="split-action">
                  <button
                    className="button outline"
                    aria-label="ファイルに保存"
                    title="編集用ファイル（JSON）を作成。付箋・共有設定は含みません"
                    onClick={() => void download()}
                  >
                    <Download size={iconSize} />
                    <span>ファイルに保存</span>
                  </button>
                  <ActionMenu
                    label="保存方法を選ぶ"
                    items={[
                      {
                        label: "JSONで保存",
                        detail:
                          "全シートのページ・写真。付箋・共有設定は含みません",
                        action: () => void download(),
                      },
                      {
                        label: "PDFで保存",
                        detail: "印刷・配布・提出する",
                        action: () => {
                          setPdfResume(undefined);
                          setToolsOpen("pdf");
                        },
                      },
                      {
                        label: "完全バックアップ（ZIP）・復元",
                        detail: "付箋・共有設定を含む保管と復旧",
                        action: () => setBackupOpen(true),
                      },
                      {
                        label: "保存した版",
                        detail: "版の保存・確認・別作品への復元",
                        action: () => setToolsOpen("history"),
                      },
                    ]}
                  />
                </div>
                <div className="split-action">
                  <button
                    className="button primary"
                    aria-label={
                      actionScope.kind === "filter"
                        ? `この${actionResolvedScope.ids.length}ページを発表`
                        : "発表する"
                    }
                    title={`${actionResolvedScope.summary}を縦横に移動して発表`}
                    disabled={!actionResolvedScope.ids.length}
                    onClick={() => startPresent()}
                  >
                    <Presentation size={iconSize} />
                    <span>
                      {actionScope.kind === "filter"
                        ? `この${actionResolvedScope.ids.length}ページを発表`
                        : "発表する"}
                    </span>
                  </button>
                  <ActionMenu
                    primary
                    label="発表方法を選ぶ"
                    items={[
                      {
                        label:
                          actionScope.kind === "filter"
                            ? "絞り込んだページを縦横に発表"
                            : "縦横に移動して発表",
                        detail: actionResolvedScope.summary,
                        disabled: !actionResolvedScope.ids.length,
                        action: () => startPresent(),
                      },
                      {
                        label: "現在のページから縦横に発表",
                        detail: actionResolvedScope.summary,
                        disabled: !actionResolvedScope.ids.includes(slide.id),
                        action: () => startPresent(actionScope, true),
                      },
                      ...(actionScope.kind === "filter"
                        ? [
                            {
                              label: "シート全体を縦横に発表",
                              detail: `${activeSheet(workbook).name}・全${deck.slides.length}ページ`,
                              action: () =>
                                startPresent({
                                  kind: "sheet",
                                  sheetId: currentSheetId,
                                }),
                            },
                          ]
                        : []),
                      ...(workbook.routes ?? []).map((r) => ({
                        label: `${r.name}で発表`,
                        detail: `保存した順番 · ${routeSlides(workbook, r).length}枚`,
                        disabled: !routeSlides(workbook, r).length,
                        action: () => startRoute(r.id),
                      })),
                      {
                        label: "発表ルートを編集",
                        detail: "発表するスライドと順番を決める",
                        action: () => setToolsOpen("routes"),
                      },
                    ]}
                  />
                </div>
              </div>
            </header>
            {cloud.active &&
              !cloud.recoveryOnly &&
              !(cloud.cacheRecovery && !cloud.cacheRecovery.stored) &&
              (cloud.needsAttention || cloud.canRetryConnection) && (
                <section
                  className="connection-notice"
                  aria-label="クラウド接続の状態"
                  role="status"
                >
                  <span>
                    {cloud.error ||
                      (cloud.needsAttention
                        ? "共有を停止しています。未送信の変更はJSONに保存してください。"
                        : "クラウドへ再接続しています。変更を保持したまま再試行します。")}
                  </span>
                  <div>
                    {cloud.canRetryConnection && (
                      <button
                        className="button outline"
                        onClick={() => cloud.retryConnection()}
                      >
                        接続を再試行
                      </button>
                    )}
                    <button
                      className="button outline"
                      onClick={() => void download()}
                    >
                      JSONを保存
                    </button>
                  </div>
                </section>
              )}
            {cloud.active && cloud.saveSnapshot.notesFailed > 0 && (
              <section
                className="connection-notice"
                aria-label="付箋の保存状態"
              >
                <span>
                  付箋{cloud.saveSnapshot.notesFailed}
                  件を保存できていません。JSONには付箋は含まれません。この画面を閉じずに再試行してください。
                </span>
                <button
                  className="button outline"
                  disabled={cloud.busy}
                  onClick={() => void cloud.run(() => cloud.retryNoteSaves())}
                >
                  付箋の保存を再試行
                </button>
              </section>
            )}
            {(deferredFit || pdfResume) && (
              <section
                className="connection-notice"
                aria-label="表示を修正した後の再開"
              >
                <span>修正後に、元の対象ページをもう一度確認できます。</span>
                {deferredFit && (
                  <button
                    className="button outline"
                    onClick={() => {
                      setFitRequest(deferredFit);
                      setDeferredFit(undefined);
                    }}
                  >
                    確認して発表を再開
                  </button>
                )}
                {pdfResume && (
                  <button
                    className="button outline"
                    onClick={() => setToolsOpen("pdf")}
                  >
                    PDFの準備を再開
                  </button>
                )}
                <button
                  className="quiet"
                  onClick={() => {
                    setDeferredFit(undefined);
                    setPdfResume(undefined);
                  }}
                >
                  取り消す
                </button>
              </section>
            )}
            {!cloud.recoveryOnly && <CacheRecoveryNotice cloud={cloud} />}
            {cloud.recoveryOnly && (
              <CloudRecoveryNotice
                key={cloud.active?.id}
                save={download}
                resume={() => {
                  if (
                    window.confirm(
                      "JSONが端末に保存されていることを確認しましたか？ クラウドの内容を開き直すと、画面と一時保存をクラウドの内容に置き換えます。",
                    )
                  )
                    void cloud.run(() => cloud.open(cloud.active!.id, true));
                }}
              />
            )}
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
                編集中は文字・画像の上でも1本指でスワイプしてページを移動できます。タッチパッドは2本指で操作します。要素はタップして選び、枠をドラッグして動かします。
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
        {backupOpen && (
          <BackupDialog
            cloud={cloud}
            close={() => setBackupOpen(false)}
            openLibrary={() => {
              setBackupOpen(false);
              setCloudInitialTab("library");
              cloud.panel = true;
              cloud.onState();
            }}
          />
        )}
        {cloud.panel && (
          <CloudPanel
            cloud={cloud}
            deck={workbook}
            onLocal={returnToLocal}
            initialTab={cloudInitialTab}
          />
        )}
        {view !== "present" && (
          <MapView
            remainingPages={Math.max(0, MAX_SLIDES - workbook.slides.length)}
            onBatchAxes={(axis, action, start, count) => {
              if (!cloud.isHost) return false;
              const current = sheetDeck(latestWorkbook.current);
              const result = commit(
                batchAxes(current, axis, action, start, count),
                current,
              );
              if (result)
                notify(
                  action === "add"
                    ? "行・列をまとめて追加しました。"
                    : "行・列の削除を受け付けました。もとに戻すこともできます。",
                );
              return result;
            }}
            onDeleteMany={(ids) => {
              const current = sheetDeck(latestWorkbook.current);
              if (
                ids.some((id) => {
                  const page = current.slides.find((s) => s.id === id);
                  return !page || !cloud.canEdit(page);
                })
              ) {
                notify(
                  "編集できないページが含まれています。選択を確認してください。",
                );
                return false;
              }
              return commit(removeSelectedPages(current, ids), current);
            }}
            scope={mapResolvedScope}
            presentationStartId={mapResolvedScope.ids[0]}
            restoreScroll={mapReturnScroll}
            assignment={
              cloud.active
                ? assignmentReadiness(
                    workbook,
                    cloud.access,
                    activeSheet(workbook).id,
                  )
                : undefined
            }
            assignmentChecking={
              !cloud.doc && new URL(location.href).searchParams.has("room")
            }
            onAssignmentSheet={selectSheet}
            assignedIds={assignedSlides(
              deck,
              cloud.active ? cloud.access : hostAccess(),
            ).map((s) => s.id)}
            onCompare={() => setToolsOpen("compare")}
            key={activeSheet(workbook).id}
            visible={view === "map"}
            headingEditable={cloud.isHost}
            footerLabel={(page) =>
              thumbnailLabel(page, cloud.accountLabels, workbook)
            }
            footerEditable={(page) => cloud.canEdit(page)}
            onFooterChange={changeFooter}
            accountsAvailable={!!cloud.active}
            rowAccounts={cloud.rowAccounts[activeSheet(workbook).id]}
            onHeadingChange={(patch) => {
              if (!cloud.isHost) return;
              const book = latestWorkbook.current,
                current = activeSheet(book);
              commitWorkbook({
                ...book,
                sheets: sheetList(book).map((sheet) =>
                  sheet.id === current.id ? { ...sheet, ...patch } : sheet,
                ),
              });
            }}
            filter={sheetFilter?.filter}
            onFilterChange={setMapFilter}
            filterEditor={filterEditor}
            onFilterEditorChange={setFilterEditor}
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
        {view === "editor" && !navigationDeck.slides.length && (
          <main className="editor-main filtered-editor-empty">
            <PageScopeSummary scope={actionResolvedScope} />
            {actionResolvedScope.issues.length > 0 && (
              <p role="status">{actionResolvedScope.issues.join(" ")}</p>
            )}
            {historyActions}
            <p>フィルタ対象のページがありません。</p>
            <button onClick={() => switchWorkspace("map")}>全体マップへ</button>
            <button onClick={() => setFilterEditor(false)}>
              すべてのページを編集
            </button>
          </main>
        )}
        {view === "editor" && navigationDeck.slides.length > 0 && (
          <Editor
            scope={actionResolvedScope}
            editable={cloud.canEdit(slide!)}
            onUndo={undo}
            onRedo={redo}
            onReplaceImage={(file, id) => {
              void addImage(file, id);
            }}
            onFooterChange={changeFooter}
            cloud={cloud.active ? cloud : undefined}
            deck={deck}
            navigationDeck={navigationDeck}
            filtered={editorFiltered}
            filterAvailable={!!sheetFilter?.filter}
            onToggleFilter={() => setFilterEditor(!filterEditor)}
            slide={slide}
            selected={selected}
            selectedIds={selectionIds.filter((id) =>
              slide.elements.some((e) => e.id === id),
            )}
            setSelected={(id, additive, inside) => {
              editorNavigationActive.current = false;
              selectObjects(id, additive, inside);
            }}
            onArrange={arrangeObjects}
            linkDeck={workbook}
            onOpenLink={openObjectLink}
            onInsertStructure={insertStructure}
            onGroup={groupSelection}
            onUngroup={ungroupSelection}
            onSelectGroup={() => selected && selectObjects(selected)}
            onDuplicate={duplicateSelection}
            onDeleteSelection={deleteSelection}
            updateSlide={updateSlide}
            updateElement={updateElement}
            addElement={addElement}
            addTable={addTable}
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
            railNumbers={preferences.railNumbers}
            onToggleRailNumbers={() =>
              setPreferences((previous) => ({
                ...previous,
                railNumbers: !previous.railNumbers,
              }))
            }
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
        {view === "present" &&
          presenting?.slide &&
          presenting.pages.length > 0 &&
          presentation && (
            <PresentationView
              onOpenLink={openObjectLink}
              onLinkBack={objectTrail.length ? backFromObjectLink : undefined}
              deck={presenting.deck}
              slide={presenting.slide}
              direction={direction}
              go={go}
              exitPresent={() => exitPresent()}
              route={
                presentation.mode === "route" ? presenting.pages : undefined
              }
              scopeLabel={presentation.label}
              scopeCount={presenting.pages.length}
              external={presenting.external}
              pendingLink={
                pendingPresentationLink
                  ? workbook.slides.find(
                      (s) => s.id === pendingPresentationLink,
                    )
                  : undefined
              }
              onConfirmLink={() =>
                pendingPresentationLink &&
                followPresentationLink(pendingPresentationLink)
              }
              onCancelLink={() => setPendingPresentationLink(undefined)}
            />
          )}
        {view !== "present" && (
          <SheetTabs
            readOnly={!cloud.isHost}
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
            {noticeLibrary && (
              <button
                onClick={() => {
                  setCloudInitialTab("library");
                  cloud.panel = true;
                  cloud.onState();
                  void cloud.refresh().catch((error) => notify(error.message));
                  setNotice("");
                }}
              >
                作品一覧を開く
              </button>
            )}
            <button aria-label="通知を閉じる" onClick={() => setNotice("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {fitRequest && (
          <FitReview
            pages={fitRequest.ids.flatMap((id) => {
              const p = workbook.slides.find((s) => s.id === id);
              return p ? [p] : [];
            })}
            onCancel={() => setFitRequest(undefined)}
            onContinue={() => {
              const request = fitRequest;
              const checked = workbook.slides.filter((s) =>
                  request.ids.includes(s.id),
                ),
                current = latestWorkbook.current.slides.filter((s) =>
                  request.ids.includes(s.id),
                );
              if (fitKey(checked) !== fitKey(current)) {
                setFitRequest({ ...request });
                return;
              }
              setFitRequest(undefined);
              launchPresentation(
                request.ids,
                request.label,
                request.mode,
                request.startId,
              );
            }}
            onEdit={(issue) => {
              setDeferredFit(fitRequest);
              setFitRequest(undefined);
              fixFitIssue(issue);
            }}
          />
        )}
        {toolsOpen && (
          <Suspense
            fallback={<div role="status">ツールを読み込んでいます…</div>}
          >
            <SlideActionDialog
              key={toolsOpen}
              mode={toolsOpen}
              defaultScope={
                toolsOpen === "pdf" && pdfResume ? pdfResume.scope : actionScope
              }
              initialIds={toolsOpen === "pdf" ? pdfResume?.ids : undefined}
              onFixIssue={(issue, scope, ids) => {
                setPdfResume({ scope, ids });
                setToolsOpen(undefined);
                fixFitIssue(issue);
              }}
              filterScope={
                toolsOpen === "pdf" && pdfResume?.scope.kind === "filter"
                  ? pdfResume.scope
                  : mapScope.kind === "filter"
                    ? mapScope
                    : undefined
              }
              access={cloud.active ? cloud.access : hostAccess()}
              book={workbook}
              latestBook={() => latestWorkbook.current}
              cloud={cloud}
              close={() => {
                setToolsOpen(undefined);
                setPdfResume(undefined);
              }}
              commit={commitWorkbook}
              present={startRoute}
              restoreLocal={(restored) => {
                setPast([]);
                setFuture([]);
                setWorkbook(restored);
                setActiveId(sheetDeck(restored).slides[0].id);
                setViewFilters({});
                setFitRequest(undefined);
                setDeferredFit(undefined);
                setPdfResume(undefined);
                setMapReturnScroll(undefined);
                setToolsOpen(undefined);
              }}
            />
          </Suspense>
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
      {historyPending && (
        <div className="toast" role="status">
          削除前の版を保存しています…
        </div>
      )}
      {updatesOpen && (
        <Suspense
          fallback={
            <div className="release-history" role="status">
              更新履歴を読み込み中…
            </div>
          }
        >
          <ReleaseHistory onClose={closeUpdates} />
        </Suspense>
      )}
    </CloudDocument.Provider>
  );
}
