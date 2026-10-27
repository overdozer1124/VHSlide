import { useMapSelection } from "./useMapSelection";
import { MapBatchPanel } from "./MapBatchPanel";
import type { BatchAxis } from "./mapBatch";
import { axisId } from "./axes";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  memo,
} from "react";
import { flushSync } from "react-dom";
import { ThumbnailFooter } from "./ThumbnailFooter";
import { MapHeading } from "./MapHeading";
import { activeSheet } from "./workbook";
import type { Sheet } from "./model";
import { UsersRound } from "lucide-react";
import type { CSSProperties } from "react";
import {
  ArrowRight,
  GripVertical,
  LayoutGrid,
  Maximize2,
  MoreHorizontal,
  MousePointer2,
  Plus,
  Trash2,
  ZoomIn,
  ZoomOut,
  Hash,
  LocateFixed,
  Search,
  Filter,
  Columns2,
} from "lucide-react";
import type { Deck, Slide, GridMove } from "./model";
import { bounds, W, H } from "./model";
import { Canvas } from "./Canvas";
import { usePinch } from "./usePinch";
import type { PinchPoint } from "./usePinch";
import type { OpenThumbnailMenu } from "./ThumbnailMenu";
const ThumbnailCanvas = memo(Canvas);
import { MapZoomSettings } from "./MapZoomSettings";
import { closestZoom } from "./workspacePreferences";
import { useMapTouchDrag } from "./useMapTouchDrag";
import type { MapDrop } from "./useMapTouchDrag";

import { MapFilterPanel } from "./MapFilterPanel";
import {
  balancedGrid,
  emptyFilter,
  matchesFilter,
  toggleFilterSlide,
  toggleFilterGroup,
  groupSelection,
} from "./mapFilter";
import type { MapFilter } from "./mapFilter";
import type { AssignmentReadiness } from "./assignmentReadiness";
import { pageOrigin, type ResolvedPageScope } from "./pageScope";
import { PageScopeSummary } from "./PageScopeSummary";

// A released pinch carries on at the fingers' speed and comes to rest on its
// display step within this many ms (sooner when released quickly).
const SNAP_TIME = 250;
// Beyond the next display step, the preview follows this share of the pinch.
const OVERSTRETCH = 0.3;
const FRAME = 1000 / 60;

type Preview = { dx: number; dy: number; ratio: number };
type SpreadCard = {
  card: HTMLElement;
  x: number;
  y: number;
  thumbnail: HTMLElement | null;
  height: number;
  base: number;
  labels: { el: HTMLElement; top: number }[];
  // The add buttons beside the card, by their centres from its corner.
  width: number;
  buttons: { el: HTMLElement; cx: number; cy: number }[];
};
const previewTransform = ({ dx, dy, ratio }: Preview) =>
  `translate(${dx}px, ${dy}px) scale(${ratio})`;
/** Per-frame progress (0 to 1) of a curve that starts at `speed` (a share of
 * the distance per ms) and comes to rest at 1 without overshooting it. */
function snapProgress(speed: number) {
  // A fast release arrives sooner, so that it only slows down from there.
  const duration = Math.max(
    FRAME,
    speed > 0 ? Math.min(SNAP_TIME, 3 / speed) : SNAP_TIME,
  );
  // The starting slope over the whole curve; from rest when it turns back.
  const slope = Math.max(0, Math.min(3, speed * duration));
  const frames = Math.round(duration / FRAME);
  const progress = Array.from({ length: frames + 1 }, (_, i) => {
    const s = i / frames;
    return slope * s * (1 - s) ** 2 + s * s * (3 - 2 * s);
  });
  return { duration, progress };
}

interface MapViewProps {
  remainingPages: number;
  onBatchAxes: (
    axis: BatchAxis,
    action: "add" | "delete",
    start: number,
    count: number,
  ) => boolean;
  onDeleteMany: (ids: string[]) => boolean;
  scope: ResolvedPageScope;
  presentationStartId?: string;
  restoreScroll?: { token: number; left: number; top: number };
  assignedIds: string[];
  assignment?: AssignmentReadiness;
  assignmentChecking?: boolean;
  onAssignmentSheet?: (id: string) => void;
  onCompare: () => void;
  visible: boolean;
  headingEditable: boolean;
  footerLabel: (slide: Slide) => string;
  footerEditable: (slide: Slide) => boolean;
  onFooterChange: (id: string, text: string) => void;
  accountsAvailable: boolean;
  rowAccounts?: Record<string, string[]>;
  onHeadingChange: (patch: Partial<Sheet>) => void;
  filter?: MapFilter;
  onFilterChange: (value?: MapFilter) => void;
  filterEditor: boolean;
  onFilterEditorChange: (value: boolean) => void;
  zoomSteps: number[];
  onZoomSteps: (steps: number[]) => void;
  deck: Deck;
  activeId: string;
  moving?: GridMove;
  onMove: (move?: GridMove) => void;
  dropAt: (x: number, y: number, source?: GridMove) => void;
  onInsertMove: (id: string, x: number, y: number) => void;
  add: (slide: Slide, direction: "right" | "down") => void;
  onEdit: (id: string, rect?: DOMRect) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onAddCell: (x: number, y: number) => void;
  scale: number;
  onScale: (scale: number) => void;
  onOpenMenu: OpenThumbnailMenu;
}
function MapViewComponent({
  remainingPages,
  onBatchAxes,
  onDeleteMany,
  scope,
  presentationStartId,
  restoreScroll,
  assignedIds,
  assignment,
  assignmentChecking,
  onAssignmentSheet,
  onCompare,
  visible,
  headingEditable,
  footerLabel,
  footerEditable,
  onFooterChange,
  accountsAvailable,
  rowAccounts,
  onHeadingChange,
  filter,
  onFilterChange: setFilter,
  filterEditor,
  onFilterEditorChange,
  zoomSteps,
  onZoomSteps,
  deck,
  activeId,
  moving,
  onMove,
  dropAt,
  onInsertMove,
  add,
  onEdit,
  onSelect,
  onDelete,
  onAddCell,
  scale,
  onScale,
  onOpenMenu,
}: MapViewProps) {
  const sheet = activeSheet(deck);
  const [draftFilterState, setDraftFilter] = useState(emptyFilter);
  const draftFilter = draftFilterState.assigned
    ? { ...draftFilterState, assignedIds }
    : draftFilterState;
  const [filterOpen, setFilterOpen] = useState(false);
  const [draftEditor, setDraftEditor] = useState(filterEditor);
  const filtered = filter !== undefined && !filterOpen;
  const displaySlides = useMemo(
    () =>
      filtered && filter
        ? deck.slides
            .filter((s) => matchesFilter(s, filter))
            .sort((a, b) => a.y - b.y || a.x - b.x)
        : deck.slides,
    [deck.slides, filter, filtered],
  );
  const size = bounds(deck),
    packed = balancedGrid(displaySlides.length),
    cols = filtered ? packed.cols : Math.max(3, size.cols),
    rows = filtered ? packed.rows : Math.max(2, size.rows);
  const positions = useMemo(
    () =>
      new Map(
        displaySlides.map((s, i) => [
          s.id,
          filtered
            ? { x: i % cols, y: Math.floor(i / cols) }
            : { x: s.x, y: s.y },
        ]),
      ),
    [displaySlides, filtered, cols],
  );
  const selection = useMapSelection(
    displaySlides,
    positions,
    visible && !filterOpen,
  );
  const [batchOpen, setBatchOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  // A trackpad pinch over the toolbar must not zoom the whole page either.
  useEffect(() => {
    const node = mainRef.current!;
    const keep = (event: WheelEvent) => {
      if (event.ctrlKey) event.preventDefault();
    };
    node.addEventListener("wheel", keep, { passive: false });
    return () => node.removeEventListener("wheel", keep);
  }, []);
  const gridRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({
    width: 1000,
    height: 500,
  });
  const [visibleWindow, setVisibleWindow] = useState({
    left: 0,
    right: 8,
    top: 0,
    bottom: 4,
  });
  const [find, setFind] = useState("");
  const [findError, setFindError] = useState("");
  const activeCard = useRef<HTMLDivElement>(null);
  const [dropHint, setDropHint] = useState<MapDrop>();
  function hint(target?: MapDrop) {
    setDropHint((before) =>
      before?.x === target?.x &&
      before?.y === target?.y &&
      before?.insert === target?.insert
        ? before
        : target,
    );
  }
  function insertDrop(x: number, y: number, source = moving) {
    if (source?.mode !== "slide") return;
    const page = deck.slides.find((s) => s.x === source.x && s.y === source.y);
    if (page) onInsertMove(page.id, x, y);
    hint();
  }
  const skipFocusScroll = useRef(false);
  const cells = useMemo(
    () =>
      new Map(
        displaySlides.map((s) => {
          const p = positions.get(s.id)!;
          return [`${p.x},${p.y}`, s];
        }),
      ),
    [displaySlides, positions],
  );
  const levels = zoomSteps.map((percent) => percent / 100);
  const defaultScale = closestZoom(zoomSteps) / 100;
  const largestScale = levels[levels.length - 1];
  const below = (current: number) =>
    [...levels].reverse().find((level) => level < current - 0.0001) ?? 0;
  const above = (current: number) =>
    levels.find((level) => level > current + 0.0001) ?? largestScale;
  const smallerScale = below(scale),
    largerScale = above(scale);
  const numbers = scale === 0;
  const rowHeaderWidth = numbers ? 48 : 56;
  const headerHeight = 68;
  const gap = numbers ? 8 : 24;
  const thumbWidth = numbers
      ? Math.max(
          44,
          Math.min(
            72,
            (viewportSize.width - rowHeaderWidth - 16) / cols - gap - 2,
          ),
        )
      : 242 * scale,
    thumbHeight = numbers
      ? Math.max(20, Math.min(32, (viewportSize.height - 60) / rows))
      : (thumbWidth * H) / W;
  const cardWidth = thumbWidth + 2,
    cardHeight = thumbHeight + (numbers ? 0 : 34 + (filtered ? 22 : 0));
  const anchor = useRef<{
    id?: string;
    point: PinchPoint;
    scale: number;
    rx: number;
    ry: number;
  } | null>(null);
  const pending = useRef<{
    id: string;
    point: PinchPoint;
    rx: number;
    ry: number;
  } | null>(null);
  function restoreAnchor() {
    const a = pending.current;
    pending.current = null;
    if (!a) return;
    const tile = gridRef.current?.querySelector(
      `[data-page-id="${CSS.escape(a.id)}"] .thumbnail`,
    );
    const rect = tile?.getBoundingClientRect();
    if (rect && scrollRef.current) {
      scrollRef.current.scrollLeft += rect.x + rect.width * a.rx - a.point.x;
      scrollRef.current.scrollTop += rect.y + rect.height * a.ry - a.point.y;
    }
  }
  function keepAnchor(next: number, point: PinchPoint) {
    const a = anchor.current;
    if (a?.id) pending.current = { id: a.id, point, rx: a.rx, ry: a.ry };
    gridRef.current!.style.transform = "";
    clearSpread();
    skipFocusScroll.current = next !== scale;
    onScale(next);
    if (next === scale) restoreAnchor();
  }
  // The preview the pinch last drew and its recent scales (log, by time), and
  // the release animation carrying it into a display step until `finish`
  // commits that step.
  const shown = useRef<Preview>({ dx: 0, dy: 0, ratio: 1 });
  const motion = useRef<{ t: number; x: number }[]>([]);
  const trackpadStarted = useRef(false);
  // Map parts that keep their physical gaps, card borders and labels while the
  // grid is scaled, each by its steps from the pinched slide. Only parts that
  // can come into view are moved, on layers of their own, by transforms alone:
  // frames neither lay out nor repaint anything.
  const spread = useRef<{
    point: PinchPoint;
    // The smallest scale for which every part in view has been gathered.
    reach: number;
    rest: { el: HTMLElement; rect: DOMRect; x: number; y: number }[];
    items: { el: HTMLElement; x: number; y: number }[];
    cards: SpreadCard[];
    animations: Animation[];
  } | null>(null);
  const labelHeight = numbers ? 0 : 34 + (filtered ? 22 : 0);
  function gatherSpread(ax: number, ay: number, point: PinchPoint) {
    const rest = [
      ...gridRef.current!.querySelectorAll<HTMLElement>(
        ".grid-cell, .column-heading, .row-axis, .axis-origin, .axis-horizontal, .map-axis-corner",
      ),
    ].map((el) => {
      // Headings move with the first row and column next to them.
      const [x, y] = (
        el.dataset.mapCell ??
        `${el.dataset.pinchX ?? 0},${el.dataset.pinchY ?? 0}`
      )
        .split(",")
        .map(Number);
      return { el, rect: el.getBoundingClientRect(), x: x - ax, y: y - ay };
    });
    spread.current = {
      point,
      reach: Infinity,
      rest,
      items: [],
      cards: [],
      animations: [],
    };
    extendSpread(1);
  }
  /** Take in the parts that scaling the grid down to `ratio` shows. */
  function extendSpread(ratio: number) {
    const s = spread.current;
    if (!s || ratio >= s.reach) return;
    s.reach = ratio;
    const view = scrollRef.current!.getBoundingClientRect(),
      grow = 1 / Math.min(1, ratio) - 1,
      pad = 48;
    const left = view.left - (s.point.x - view.left) * grow - pad,
      right = view.right + (view.right - s.point.x) * grow + pad,
      top = view.top - (s.point.y - view.top) * grow - pad,
      bottom = view.bottom + (view.bottom - s.point.y) * grow + pad;
    s.rest = s.rest.filter(({ el, rect, x, y }) => {
      if (
        rect.right < left ||
        rect.left > right ||
        rect.bottom < top ||
        rect.top > bottom
      )
        return true;
      const card = numbers
        ? null
        : el.querySelector<HTMLElement>(":scope > .slide-card");
      if (!card) {
        el.style.willChange = "transform";
        s.items.push({ el, x, y });
        return false;
      }
      // A card carries its cell's move, and keeps a physical label height by
      // stretching only vertically, which its thumbnail and labels undo.
      const thumbnail = card.querySelector<HTMLElement>(":scope > .thumbnail");
      const labels = [
        ...card.querySelectorAll<HTMLElement>(
          ":scope > .card-footer, :scope > .filtered-origin",
        ),
      ];
      for (const part of [card, thumbnail, ...labels])
        if (part) {
          part.style.transformOrigin = "0 0";
          part.style.willChange = "transform";
        }
      const buttons = [
        ...el.querySelectorAll<HTMLElement>(":scope > .add-dot"),
      ].map((button) => {
        button.style.willChange = "transform";
        return {
          el: button,
          cx: button.offsetLeft + button.offsetWidth / 2 - card.offsetLeft,
          cy: button.offsetTop + button.offsetHeight / 2 - card.offsetTop,
        };
      });
      const height = card.offsetHeight;
      s.cards.push({
        card,
        thumbnail,
        x,
        y,
        height,
        // Where the thumbnail ends and the labels start.
        base: thumbnail
          ? thumbnail.offsetTop + thumbnail.offsetHeight
          : height - labelHeight,
        labels: labels.map((label) => ({ el: label, top: label.offsetTop })),
        width: card.offsetWidth,
        buttons,
      });
      return false;
    });
  }
  /** The transforms that undo the preview's scaling of gaps and labels. */
  function spreadStyles(ratio: number) {
    const adjust = 1 / ratio - 1;
    const move = (x: number, y: number) =>
      `translate(${x * (gap + 2) * adjust}px, ${y * (gap + labelHeight) * adjust}px)`;
    return {
      move,
      card(c: SpreadCard) {
        const k = (ratio * c.base + c.height - c.base) / (ratio * c.height);
        return {
          card: `${move(c.x, c.y)} scaleY(${k})`,
          thumbnail: `scaleY(${1 / k})`,
          labels: c.labels.map(
            ({ top }) =>
              `translateY(${(c.base + (top - c.base) / ratio) / k - top}px) scale(${1 / ratio}, ${1 / (ratio * k)})`,
          ),
          // Beside the card a button keeps its physical size and distance from
          // the card's edge; along the card it goes with the thumbnail.
          buttons: c.buttons.map(({ cx, cy }) => {
            const x = cx > c.width ? c.width + (cx - c.width) / ratio : cx,
              y =
                cy > c.height
                  ? (ratio * c.base + c.height - c.base + cy - c.height) / ratio
                  : cy;
            return `${move(c.x, c.y)} translate(${x - cx}px, ${y - cy}px) scale(${1 / ratio})`;
          }),
        };
      },
    };
  }
  function drawSpread(ratio: number) {
    const s = spread.current;
    if (!s) return;
    extendSpread(ratio);
    const styles = spreadStyles(ratio);
    for (const { el, x, y } of s.items) el.style.transform = styles.move(x, y);
    for (const c of s.cards) {
      const t = styles.card(c);
      c.card.style.transform = t.card;
      if (c.thumbnail) c.thumbnail.style.transform = t.thumbnail;
      c.labels.forEach(({ el }, i) => (el.style.transform = t.labels[i]));
      c.buttons.forEach(({ el }, i) => (el.style.transform = t.buttons[i]));
    }
  }
  /** Animate the spread alongside the grid with the same timing. */
  function animateSpread(ratios: number[], timing: KeyframeAnimationOptions) {
    const s = spread.current;
    if (!s) return;
    extendSpread(Math.min(...ratios));
    // Every fourth step of the grid's is close enough here, and far cheaper to
    // set up for each of hundreds of parts at the moment of release.
    const picks = ratios
      .map((_, i) => i)
      .filter((i) => i % 4 === 0 || i === ratios.length - 1);
    const steps = picks.map((i) => spreadStyles(ratios[i]));
    const animate = (el: HTMLElement, transforms: string[]) =>
      s.animations.push(
        el.animate(
          transforms.map((transform, i) => ({
            offset: picks[i] / (ratios.length - 1),
            transform,
          })),
          timing,
        ),
      );
    for (const { el, x, y } of s.items)
      animate(
        el,
        steps.map((style) => style.move(x, y)),
      );
    for (const c of s.cards) {
      const frames = steps.map((style) => style.card(c));
      animate(
        c.card,
        frames.map((t) => t.card),
      );
      if (c.thumbnail)
        animate(
          c.thumbnail,
          frames.map((t) => t.thumbnail),
        );
      c.labels.forEach(({ el }, i) =>
        animate(
          el,
          frames.map((t) => t.labels[i]),
        ),
      );
      c.buttons.forEach(({ el }, i) =>
        animate(
          el,
          frames.map((t) => t.buttons[i]),
        ),
      );
    }
  }
  function clearSpread() {
    const s = spread.current;
    spread.current = null;
    if (!s) return;
    for (const animation of s.animations) animation.cancel();
    for (const { el } of s.items) {
      el.style.transform = "";
      el.style.willChange = "";
    }
    for (const c of s.cards)
      for (const part of [
        c.card,
        c.thumbnail,
        ...c.labels.map((l) => l.el),
        ...c.buttons.map((b) => b.el),
      ])
        if (part) {
          part.style.transform = "";
          part.style.transformOrigin = "";
          part.style.willChange = "";
        }
    // Settle these styles while transitions are still off for the preview, so
    // ending it does not ease the cards back.
    if (s.cards[0]) getComputedStyle(s.cards[0].card).transform;
  }
  /** Take the pinch preview off the grid without committing a step. */
  function endPreview() {
    const grid = gridRef.current!;
    clearSpread();
    delete grid.dataset.pinching;
    grid.style.transform = "";
  }
  const snap = useRef<{
    animation: Animation;
    scale: number;
    finish: () => void;
  } | null>(null);
  /** Commit a running release animation at once; returns the settled scale. */
  function settle() {
    const running = snap.current;
    if (!running) return scale;
    snap.current = null;
    running.animation.cancel();
    // Draw the committed step and its anchor before the browser paints again,
    // since the preview transform has just come off.
    flushSync(running.finish);
    return running.scale;
  }
  /** Carry the preview from what is shown to `to`, then commit in the same
   * task, so the transform never comes off before the new layout is drawn. */
  function release(
    to: Preview,
    next: number,
    commit: () => void,
    uniform = false,
  ) {
    const grid = gridRef.current!,
      from = shown.current;
    const finish = () => {
      clearSpread();
      delete grid.dataset.pinching;
      commit();
    };
    const distance = Math.log(to.ratio / from.ratio),
      move = Math.hypot(to.dx - from.dx, to.dy - from.dy);
    if (
      (!distance && !move) ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return finish();
    // Carry on at the speed the scale changed over the last 100ms.
    const now = performance.now(),
      last = motion.current.at(-1);
    const first = motion.current.find((m) => now - m.t <= 100) ?? last;
    const speed =
      distance && first && last && now > first.t
        ? (last.x - first.x) / (now - first.t) / distance
        : 0;
    const { duration, progress } = uniform
      ? {
          duration: SNAP_TIME,
          progress: Array.from({ length: 17 }, (_, i) => i / 16),
        }
      : snapProgress(speed);
    const ratios = progress.map((p) =>
      uniform
        ? from.ratio + (to.ratio - from.ratio) * p
        : from.ratio * Math.exp(distance * p),
    );
    const timing = { duration, fill: "forwards" } as const;
    const animation = grid.animate(
      progress.map((p, i) => ({
        offset: i / (progress.length - 1),
        transform: previewTransform({
          dx: from.dx + (to.dx - from.dx) * p,
          dy: from.dy + (to.dy - from.dy) * p,
          ratio: ratios[i],
        }),
      })),
      timing,
    );
    animateSpread(ratios, timing);
    snap.current = { animation, scale: next, finish };
    animation.onfinish = () => {
      if (snap.current?.animation === animation) settle();
    };
  }
  useEffect(
    () => () => {
      snap.current?.animation.cancel();
      for (const animation of spread.current?.animations ?? [])
        animation.cancel();
    },
    [],
  );
  const pinching = usePinch(scrollRef, {
    prepare: settle,
    start(point) {
      selection.close();
      trackpadStarted.current = false;
      shown.current = { dx: 0, dy: 0, ratio: 1 };
      motion.current = [{ t: performance.now(), x: 0 }];
      const grid = gridRef.current!,
        rect = grid.getBoundingClientRect();
      // Read the touched card directly. For gaps, use fixed grid coordinates
      // instead of forcing a layout read for every slide in the document.
      let nearest = document
        .elementFromPoint(point.x, point.y)
        ?.closest<HTMLElement>(".slide-card");
      if (!nearest || !grid.contains(nearest)) {
        let target: Slide | undefined,
          best = Infinity;
        for (const page of displaySlides) {
          const p = positions.get(page.id)!;
          const left = rect.x + rowHeaderWidth + p.x * (cardWidth + gap);
          const top = rect.y + headerHeight + p.y * (cardHeight + gap);
          const distance = Math.hypot(
            Math.max(left - point.x, 0, point.x - left - cardWidth),
            Math.max(top - point.y, 0, point.y - top - cardHeight),
          );
          if (distance < best) {
            best = distance;
            target = page;
          }
        }
        nearest = target
          ? grid.querySelector<HTMLElement>(
              `[data-page-id="${CSS.escape(target.id)}"]`,
            )
          : null;
      }
      const tile = nearest
        ?.querySelector(".thumbnail")
        ?.getBoundingClientRect();
      anchor.current = {
        id: nearest?.dataset.pageId,
        point,
        scale,
        rx: tile ? (point.x - tile.x) / tile.width : 0.5,
        ry: tile ? (point.y - tile.y) / tile.height : 0.5,
      };
      gatherSpread(
        Number(nearest?.dataset.x ?? 0),
        Number(nearest?.dataset.y ?? 0),
        point,
      );
      grid.style.transformOrigin = `${point.x - rect.x}px ${point.y - rect.y}px`;
      grid.dataset.pinching = "true";
    },
    change(sample) {
      if (sample.input === "wheel") {
        if (!sample.direction || trackpadStarted.current) return;
        trackpadStarted.current = true;
        const a = anchor.current!,
          grid = gridRef.current!;
        if (numbers && sample.direction === "in") return endPreview();
        if (
          !filterOpen &&
          a.scale === largestScale &&
          sample.direction === "out" &&
          a.id
        ) {
          endPreview();
          const tile = grid.querySelector(
            `[data-page-id="${CSS.escape(a.id)}"] .thumbnail`,
          );
          onEdit(a.id, tile?.getBoundingClientRect());
          return;
        }
        const next = sample.direction === "in" ? smallerScale : largerScale;
        if (a.scale && next && next !== a.scale)
          release(
            { dx: 0, dy: 0, ratio: next / a.scale },
            next,
            () => keepAnchor(next, a.point),
            true,
          );
        else {
          endPreview();
          if (next !== a.scale) keepAnchor(next, a.point);
        }
        return;
      }
      if (numbers && sample.direction === "in") return;
      const a = anchor.current!;
      let ratio = Math.max(0.12, Math.min(5, sample.ratio));
      const next = sample.direction === "in" ? smallerScale : largerScale;
      // Follow the fingers up to the next display step, then resist. Opening
      // the editor and the numbered overview have no step to stop at.
      if (sample.direction && a.scale && next && next !== a.scale) {
        const limit = Math.log(next / a.scale),
          stretch = Math.log(ratio);
        if (Math.abs(stretch) > Math.abs(limit))
          ratio = Math.exp(limit + (stretch - limit) * OVERSTRETCH);
      }
      shown.current = {
        dx: sample.x - a.point.x,
        dy: sample.y - a.point.y,
        ratio,
      };
      motion.current.push({ t: performance.now(), x: Math.log(ratio) });
      if (motion.current.length > 12) motion.current.shift();
      // Make the layers a pinch-in will need now, not when it is released.
      if (sample.direction === "in" && a.scale && next)
        extendSpread(next / a.scale);
      drawSpread(ratio);
      gridRef.current!.style.transform = previewTransform(shown.current);
    },
    end(sample) {
      if (sample.input === "wheel" && trackpadStarted.current) return;
      const a = anchor.current!;
      if (!sample.direction) {
        release({ dx: 0, dy: 0, ratio: 1 }, scale, endPreview);
        return;
      }
      if (
        !filterOpen &&
        a.scale === largestScale &&
        sample.direction === "out" &&
        a.id
      ) {
        const tile = gridRef.current!.querySelector(
          `[data-page-id="${CSS.escape(a.id)}"] .thumbnail`,
        );
        const rect = tile?.getBoundingClientRect();
        // The map stays mounted while editing; do not retain its pinch preview.
        endPreview();
        // Keep the last useful map size when returning from the editor.
        onEdit(a.id, rect);
        return;
      }
      // Always complete the display step chosen by the initial pinch direction.
      const next = sample.direction === "in" ? smallerScale : largerScale;
      if (a.scale && next)
        release({ ...shown.current, ratio: next / a.scale }, next, () =>
          keepAnchor(next, sample),
        );
      else {
        // Switching to or from the numbered overview stays immediate.
        endPreview();
        keepAnchor(next, sample);
      }
    },
  });
  useMapTouchDrag(scrollRef, {
    enabled: visible && !filtered && !filterOpen && !selection.active,
    start: (source) => onMove(source),
    hit(point, source) {
      const target = document
        .elementFromPoint(point.x, point.y)
        ?.closest<HTMLElement>("[data-map-insert],[data-map-cell]");
      if (!target || !scrollRef.current?.contains(target)) return;
      const insert =
        target.hasAttribute("data-map-insert") && source.mode === "slide";
      const position = target.dataset.mapInsert ?? target.dataset.mapCell;
      const [x, y] = position!.split(",").map(Number);
      return { x, y, insert };
    },
    hover: hint,
    drop(source, target) {
      if (target.insert) insertDrop(target.x, target.y, source);
      else dropAt(target.x, target.y, source);
      onMove(undefined);
      hint();
    },
    cancel() {
      onMove(undefined);
      hint();
    },
  });
  useLayoutEffect(restoreAnchor, [scale]);
  const restoredScroll = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (!visible) return;
    if (
      restoreScroll &&
      restoredScroll.current !== restoreScroll.token &&
      scrollRef.current
    ) {
      restoredScroll.current = restoreScroll.token;
      scrollRef.current.scrollTo({
        left: restoreScroll.left,
        top: restoreScroll.top,
        behavior: "instant",
      });
      return;
    }
    const node = scrollRef.current!;
    let frame: number | undefined;
    function measure() {
      frame = undefined;
      // Not while a pinch preview is drawn (a trackpad gesture may still be
      // going on after its step has been committed).
      if (
        (pinching.current && gridRef.current?.dataset.pinching) ||
        !node.clientWidth ||
        !node.clientHeight
      )
        return;
      const width = node.clientWidth,
        height = node.clientHeight;
      setViewportSize((before) =>
        before.width === width && before.height === height
          ? before
          : { width, height },
      );
      // Keep one neighbouring row/column ready for scrolling and pinch previews.
      const next = {
        left: Math.max(
          0,
          Math.floor((node.scrollLeft - rowHeaderWidth) / (cardWidth + gap)) -
            1,
        ),
        right:
          Math.ceil(
            (node.scrollLeft + width - rowHeaderWidth) / (cardWidth + gap),
          ) + 1,
        top: Math.max(
          0,
          Math.floor((node.scrollTop - headerHeight) / (cardHeight + gap)) - 1,
        ),
        bottom:
          Math.ceil(
            (node.scrollTop + height - headerHeight) / (cardHeight + gap),
          ) + 1,
      };
      setVisibleWindow((before) =>
        before.left === next.left &&
        before.right === next.right &&
        before.top === next.top &&
        before.bottom === next.bottom
          ? before
          : next,
      );
    }
    function queue() {
      if (frame === undefined) frame = requestAnimationFrame(measure);
    }
    const observer = new ResizeObserver(queue);
    observer.observe(node);
    node.addEventListener("scroll", queue, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      node.removeEventListener("scroll", queue);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [cardWidth, cardHeight, gap, pinching, visible]);
  function zoomTo(choose: (current: number) => number) {
    onScale(choose(settle()));
  }
  function zoomOut() {
    zoomTo(below);
  }
  function zoomIn() {
    zoomTo(above);
  }
  function fitColumns() {
    settle();
    if (!scrollRef.current) return;
    const width = scrollRef.current.clientWidth - 80;
    onScale(
      [...levels]
        .reverse()
        .find((level) => cols * (242 * level + 2 + 24) <= width) ?? 0,
    );
    scrollRef.current.scrollLeft = 0;
  }
  useLayoutEffect(() => {
    if (!visible) return;
    if (skipFocusScroll.current) {
      skipFocusScroll.current = false;
      return;
    }
    const thumbnail = activeCard.current?.querySelector(".thumbnail");
    thumbnail?.scrollIntoView({
      block: "center",
      inline: "center",
      behavior: "instant",
    });
  }, [activeId, scale, visible, filtered, cols, restoreScroll]);
  return (
    <main
      // A new touch, click or key first completes a running pinch snap.
      onPointerDownCapture={settle}
      onKeyDownCapture={(e) => {
        settle();
        if (
          !selection.active ||
          (e.target as HTMLElement).closest("input,textarea,select")
        )
          return;
        if (["Delete", "Backspace"].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          setConfirmDelete(true);
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
          e.preventDefault();
          e.stopPropagation();
          selection.all();
        }
        if (e.key === "Escape") {
          e.stopPropagation();
          selection.close();
          setConfirmDelete(false);
        }
      }}
      className="map-main"
      ref={mainRef}
      data-filter-selecting={filterOpen}
      hidden={!visible}
      style={visible ? undefined : { display: "none" }}
    >
      {selection.box && (
        <div
          className="map-selection-box"
          style={selection.box}
          aria-hidden="true"
        />
      )}
      <section className="map-panel" aria-label="ページの全体マップ">
        <div className="map-toolbar">
          <div className="map-summary">
            <h1>
              <LayoutGrid size={16} />
              全体マップ
            </h1>
            <span className="map-stats">
              <PageScopeSummary scope={scope} />
            </span>
          </div>
          <button
            className="quiet filter-toggle"
            aria-label="マップをフィルタ"
            aria-expanded={filterOpen}
            onClick={() => {
              selection.close();
              setBatchOpen(false);
              setDraftFilter(filter ?? emptyFilter());
              setDraftEditor(filterEditor);
              setFilterOpen(!filterOpen);
              onMove(undefined);
            }}
          >
            <Filter size={16} />
            フィルタ
          </button>
          <button
            className="quiet"
            aria-label="スライドを複数選択"
            aria-pressed={selection.active}
            onClick={() => {
              selection.toggle();
              setConfirmDelete(false);
              setBatchOpen(false);
              onMove(undefined);
            }}
          >
            <MousePointer2 size={16} aria-hidden="true" />
            選択
          </button>
          {headingEditable && (
            <button
              className="quiet"
              aria-expanded={batchOpen}
              onClick={() => {
                setBatchOpen(!batchOpen);
                selection.close();
                setFilterOpen(false);
                onMove(undefined);
              }}
            >
              行・列を一括操作
            </button>
          )}
          <button className="quiet map-compare" onClick={onCompare}>
            <Columns2 size={16} />
            比較
          </button>
          {accountsAvailable && !filtered && (
            <button
              className="quiet map-row-accounts"
              role="switch"
              aria-label="行に共有相手の名前を表示"
              aria-checked={!!sheet.showRowAccounts}
              disabled={!headingEditable}
              title="共有相手の名前を縦書きで表示（参加前はメールアドレスの@より前）"
              onClick={() =>
                onHeadingChange({ showRowAccounts: !sheet.showRowAccounts })
              }
            >
              <UsersRound size={16} />
              行に名前 <span>{sheet.showRowAccounts ? "オン" : "オフ"}</span>
            </button>
          )}
          {filtered && (
            <button
              className="quiet"
              onClick={() => {
                setFilter(undefined);
                setFilterOpen(false);
              }}
            >
              フィルタ解除
            </button>
          )}
          <form
            className="map-find"
            onSubmit={(event) => {
              event.preventDefault();
              const match = find.trim().match(/^(\d+)[.．・,、-](\d+)$/);
              const target =
                match &&
                displaySlides.find(
                  (s) =>
                    s.x === Number(match[2]) - 1 &&
                    s.y === Number(match[1]) - 1,
                );
              if (target) {
                onSelect(target.id);
                setFindError("");
                requestAnimationFrame(() =>
                  gridRef.current
                    ?.querySelector(`[data-page-id="${CSS.escape(target.id)}"]`)
                    ?.scrollIntoView({ block: "nearest", inline: "nearest" }),
                );
              } else setFindError("その番号のページはありません");
            }}
          >
            <input
              aria-label="ページ番号で探す"
              placeholder="3.2"
              value={find}
              onChange={(event) => {
                setFind(event.target.value);
                setFindError("");
              }}
            />
            <button
              className="icon-button"
              aria-label="番号のページを探す"
              title="縦.横の番号で探す"
            >
              <Search size={15} />
            </button>
          </form>
          <div
            className="map-zoom"
            role="group"
            aria-label="マップの表示サイズ"
          >
            <button
              className="icon-button"
              aria-label="マップを縮小"
              title="マップを縮小"
              disabled={numbers}
              onClick={zoomOut}
            >
              <ZoomOut size={17} />
            </button>
            <button
              className="map-scale-reset"
              aria-label={`表示サイズを${Math.round(defaultScale * 100)}%に戻す`}
              title={`標準の${Math.round(defaultScale * 100)}%に戻す`}
              onClick={() => zoomTo(() => defaultScale)}
            >
              {numbers ? "番号" : `${Math.round(scale * 100)}%`}
            </button>
            <button
              className="icon-button"
              aria-label="マップを拡大"
              title="マップを拡大"
              disabled={scale === largestScale}
              onClick={zoomIn}
            >
              <ZoomIn size={17} />
            </button>
            <button
              className="icon-button map-numbers-toggle"
              aria-label="番号だけの一覧"
              aria-pressed={numbers}
              title="番号だけの一覧"
              onClick={() =>
                zoomTo((current) => (current === 0 ? levels[0] : 0))
              }
            >
              <Hash size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="いまのページを表示"
              title="いまのページを表示"
              onClick={() =>
                activeCard.current?.scrollIntoView({
                  block: "center",
                  inline: "center",
                  behavior: matchMedia("(prefers-reduced-motion: reduce)")
                    .matches
                    ? "instant"
                    : "smooth",
                })
              }
            >
              <LocateFixed size={17} />
            </button>
            <MapZoomSettings steps={zoomSteps} onApply={onZoomSteps} />
            <button className="quiet map-fit" onClick={fitColumns}>
              <Maximize2 size={15} />
              横をおさめる
            </button>
          </div>
        </div>
        {batchOpen && headingEditable && (
          <MapBatchPanel
            remainingPages={remainingPages}
            deck={deck}
            onApply={onBatchAxes}
            onClose={() => setBatchOpen(false)}
          />
        )}
        {selection.active && (
          <section
            className="map-selection-toolbar"
            aria-label="選択したスライドの操作"
          >
            <strong>{selection.ids.length}ページ選択</strong>
            <button
              className="quiet"
              onClick={() => {
                selection.all();
                setConfirmDelete(false);
              }}
            >
              表示中をすべて選択
            </button>
            <button
              className="quiet"
              onClick={() => {
                selection.clear();
                setConfirmDelete(false);
              }}
            >
              選択を解除
            </button>
            <button
              className="button outline"
              disabled={!selection.ids.length}
              onClick={() => {
                setFilter({ ids: selection.ids, rows: [], columns: [] });
                selection.close();
              }}
            >
              選択したページでフィルタ
            </button>
            <button
              className="button outline danger"
              disabled={
                !selection.ids.length ||
                selection.ids.some(
                  (id) =>
                    !footerEditable(deck.slides.find((s) => s.id === id)!),
                )
              }
              onClick={() => setConfirmDelete(true)}
            >
              選択したページを削除
            </button>
            <button
              className="quiet"
              onClick={() => {
                selection.close();
                setConfirmDelete(false);
              }}
            >
              選択を終了
            </button>
            <small>
              ドラッグで囲む · Ctrl／⌘で追加・解除 · Shiftで矩形範囲 ·
              Deleteで削除
            </small>
            {confirmDelete && selection.ids.length > 0 && (
              <div className="selection-delete-confirm" role="alert">
                <span>
                  {selection.ids.length}
                  ページを削除します。選んでいないページの位置は変わりません。先頭が空く場合は空白ページを残します。
                </span>
                <button
                  className="button outline danger"
                  onClick={() => {
                    if (onDeleteMany(selection.ids)) {
                      setConfirmDelete(false);
                    }
                  }}
                >
                  この{selection.ids.length}ページを削除する
                </button>
                <button
                  className="quiet"
                  onClick={() => setConfirmDelete(false)}
                >
                  取り消す
                </button>
              </div>
            )}
          </section>
        )}
        {filterOpen && (
          <MapFilterPanel
            deck={deck}
            assignedIds={assignedIds}
            assignment={assignment}
            assignmentChecking={assignmentChecking}
            onAssignmentSheet={(id) => {
              setFilterOpen(false);
              onAssignmentSheet?.(id);
            }}
            value={draftFilter}
            onChange={setDraftFilter}
            editor={draftEditor}
            onEditorChange={setDraftEditor}
            onApply={() => {
              setFilter(draftFilter);
              onFilterEditorChange(draftEditor);
              setFilterOpen(false);
              onMove(undefined);
            }}
            onClose={() => setFilterOpen(false)}
          />
        )}
        {filtered && (
          <div className="filtered-note">
            元の行・列はカード下部に表示 · 配置を変えるには絞り込みを解除
            {scope.issues.length > 0 && (
              <span role="status"> {scope.issues.join(" ")}</span>
            )}
            {!displaySlides.length && (
              <strong> 条件に合うページがありません。</strong>
            )}
          </div>
        )}
        {findError && (
          <div className="map-find-error" role="status">
            {findError}
          </div>
        )}
        {moving && (
          <div className="move-banner">
            {moving.mode === "row"
              ? "同じ高さのページをまとめて"
              : moving.mode === "column"
                ? "同じ話題のページをまとめて"
                : "ページを"}
            {moving.mode === "slide"
              ? "移動：重ねて入れ替え、間に置いて挿入。マスをタップしても移動できます。"
              : "移動：入れかえるマスに置くか、タップしてください。"}
            <button onClick={() => onMove(undefined)}>キャンセル</button>
          </div>
        )}
        <div
          {...selection.handlers}
          data-multi-selecting={selection.active}
          className="map-scroll"
          ref={scrollRef}
          role="region"
          aria-label="スライドのマップ"
          tabIndex={0}
        >
          <div
            className="map-grid"
            ref={gridRef}
            data-numbers={numbers}
            data-compact={scale <= 0.6}
            data-tiny={numbers || scale < 0.4}
            data-micro={!numbers && scale < 0.25}
            style={
              {
                gridTemplateColumns: `${rowHeaderWidth}px repeat(${cols}, ${cardWidth + gap}px) 0px`,
                "--map-header-width": `${rowHeaderWidth}px`,
                "--map-card-width": `${cardWidth}px`,
                "--map-card-height": `${cardHeight}px`,
                "--map-row-height": `${cardHeight + gap}px`,
                "--map-gap": `${gap}px`,
                "--map-thumb-height": `${thumbHeight}px`,
              } as CSSProperties
            }
          >
            <div className="axis-origin" />
            <div
              className="axis-horizontal"
              style={{ gridColumn: `2 / ${cols + 2}` }}
            >
              <span>{filtered ? "フィルタしたページ" : "次の話題へ"}</span>
              <span className="axis-line" />
              <ArrowRight size={15} />
            </div>
            <div />
            <div className="map-axis-corner" aria-hidden="true">
              行 / 列
            </div>
            <>
              {Array.from({ length: cols }, (_, x) =>
                filtered ? (
                  <div key={x} />
                ) : (
                  <div className="column-heading" key={x} data-pinch-x={x}>
                    {filterOpen ? (
                      <button
                        className="filter-axis-button"
                        aria-label={`フィルタする列${x + 1}`}
                        aria-pressed={groupSelection(
                          deck.slides.filter((s) => s.x === x),
                          draftFilter,
                        )}
                        disabled={!deck.slides.some((s) => s.x === x)}
                        onClick={() =>
                          setDraftFilter(
                            toggleFilterGroup(
                              draftFilter,
                              deck.slides.filter((s) => s.x === x),
                              "columns",
                              x,
                            ),
                          )
                        }
                      >
                        {String(x + 1).padStart(2, "0")}　
                        {sheet.columnLabels?.[x] ||
                          (x === 0 ? "はじまり" : `話題 ${x + 1}`)}
                      </button>
                    ) : (
                      <>
                        <span className="column-num">
                          {String(x + 1).padStart(2, "0")}
                        </span>
                        <MapHeading
                          label={`列${x + 1}の見出し`}
                          value={
                            sheet.columnLabels?.[x] ||
                            (x === 0 ? "はじまり" : `話題 ${x + 1}`)
                          }
                          placeholder="列の名前"
                          editable={headingEditable}
                          onChange={(text) => {
                            const labels = { ...sheet.columnLabels };
                            if (text) labels[x] = text;
                            else delete labels[x];
                            onHeadingChange({ columnLabels: labels });
                          }}
                        />
                        <button
                          draggable
                          data-map-drag-source="column"
                          data-x={x}
                          data-y={0}
                          data-map-drag-handle
                          onDragStart={() =>
                            onMove({ mode: "column", x, y: 0 })
                          }
                          onDragEnd={() => {
                            onMove(undefined);
                            hint();
                          }}
                          className="icon-button"
                          title="この話題をまとめて移動"
                          aria-label={`話題${x + 1}を移動`}
                          onClick={() => onMove({ mode: "column", x, y: 0 })}
                        >
                          <GripVertical size={16} />
                        </button>
                      </>
                    )}
                  </div>
                ),
              )}
            </>
            <div className="map-heading-end" />
            {Array.from({ length: rows }, (_, y) => (
              <div className="grid-row" key={y}>
                <div
                  className="row-axis"
                  title={
                    sheet.rowLabels?.[y] ||
                    (sheet.showRowAccounts
                      ? rowAccounts?.[axisId(deck, sheet.id, "rows", y)]?.join(
                          "・",
                        )
                      : "")
                  }
                  data-pinch-y={y}
                  style={filtered ? { visibility: "hidden" } : undefined}
                >
                  <button
                    className="row-move"
                    draggable={!filterOpen}
                    data-map-drag-source={filterOpen ? undefined : "row"}
                    data-x={0}
                    data-y={y}
                    data-map-drag-handle
                    onDragStart={(e) => {
                      if (filterOpen) {
                        e.preventDefault();
                        return;
                      }
                      onMove({ mode: "row", x: 0, y });
                    }}
                    onDragEnd={() => {
                      onMove(undefined);
                      hint();
                    }}
                    onClick={() =>
                      filterOpen
                        ? setDraftFilter(
                            toggleFilterGroup(
                              draftFilter,
                              deck.slides.filter((s) => s.y === y),
                              "rows",
                              y,
                            ),
                          )
                        : onMove({ mode: "row", x: 0, y })
                    }
                    aria-label={
                      filterOpen
                        ? `フィルタする行${y + 1}`
                        : `高さ${y + 1}のページをまとめて移動`
                    }
                    aria-pressed={
                      filterOpen
                        ? groupSelection(
                            deck.slides.filter((s) => s.y === y),
                            draftFilter,
                          )
                        : undefined
                    }
                    disabled={filterOpen && !deck.slides.some((s) => s.y === y)}
                    title="同じ高さのページを移動"
                  >
                    {String(y + 1).padStart(2, "0")}
                  </button>
                  {!filterOpen && !numbers && (
                    <MapHeading
                      vertical
                      label={`行${y + 1}の見出し`}
                      value={
                        sheet.rowLabels?.[y] ||
                        (sheet.showRowAccounts
                          ? rowAccounts?.[
                              axisId(deck, sheet.id, "rows", y)
                            ]?.join("・")
                          : "") ||
                        ""
                      }
                      placeholder={headingEditable ? "見出し" : ""}
                      editable={headingEditable}
                      onChange={(text) => {
                        const labels = { ...sheet.rowLabels };
                        if (text) labels[y] = text;
                        else delete labels[y];
                        onHeadingChange({ rowLabels: labels });
                      }}
                    />
                  )}
                </div>
                {Array.from({ length: cols }, (_, x) => {
                  const s = cells.get(`${x},${y}`);
                  const detailed =
                    !numbers &&
                    x >= visibleWindow.left &&
                    x <= visibleWindow.right &&
                    y >= visibleWindow.top &&
                    y <= visibleWindow.bottom;
                  return (
                    <div
                      className={`grid-cell ${moving ? "drop-ready" : ""}`}
                      data-map-cell={`${x},${y}`}
                      data-insert-shift={
                        dropHint?.insert && dropHint.y === y && x >= dropHint.x
                      }
                      data-drop-over={
                        dropHint &&
                        !dropHint.insert &&
                        dropHint.x === x &&
                        dropHint.y === y
                      }
                      key={x}
                      onDragOver={(e) => {
                        if (moving) {
                          e.preventDefault();
                          hint({ x, y, insert: false });
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        dropAt(x, y);
                        hint();
                      }}
                    >
                      <div
                        className="map-insert-drop"
                        data-map-insert={`${x},${y}`}
                        data-active={moving?.mode === "slide"}
                        data-over={
                          dropHint?.insert &&
                          dropHint.x === x &&
                          dropHint.y === y
                        }
                        onDragEnter={(event) => {
                          if (moving?.mode !== "slide") return;
                          event.preventDefault();
                          event.stopPropagation();
                          hint({ x, y, insert: true });
                        }}
                        onDragOver={(event) => {
                          if (moving?.mode !== "slide") return;
                          event.preventDefault();
                          event.stopPropagation();
                          hint({ x, y, insert: true });
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          insertDrop(x, y);
                        }}
                      >
                        <span className="insert-drop-line" />
                        {dropHint?.insert &&
                          dropHint.x === x &&
                          dropHint.y === y && (
                            <span className="insert-drop-label">
                              ここに挿入
                            </span>
                          )}
                      </div>
                      {s ? (
                        <>
                          <div
                            ref={s.id === activeId ? activeCard : undefined}
                            data-page-id={s.id}
                            data-multi-selected={
                              selection.active && selection.ids.includes(s.id)
                            }
                            data-filter-selecting={filterOpen}
                            data-filter-selected={
                              filterOpen
                                ? matchesFilter(s, draftFilter)
                                : undefined
                            }
                            data-map-drag-source={
                              filtered || filterOpen || selection.active
                                ? undefined
                                : "slide"
                            }
                            data-x={x}
                            data-y={y}
                            style={
                              !numbers && !detailed
                                ? { height: cardHeight }
                                : undefined
                            }
                            className={`slide-card ${s.id === activeId ? "active-card" : ""}`}
                            onContextMenu={(event) =>
                              filterOpen || selection.active
                                ? event.preventDefault()
                                : onOpenMenu(event, { pageId: s.id })
                            }
                            draggable={
                              !filtered && !filterOpen && !selection.active
                            }
                            onDragStart={(e) => {
                              if (filtered || filterOpen || selection.active) {
                                e.preventDefault();
                                return;
                              }
                              e.dataTransfer.setData("text/plain", s.id);
                              onMove({ mode: "slide", x, y });
                            }}
                            onDragEnd={() => {
                              onMove(undefined);
                              hint();
                            }}
                          >
                            <button
                              className="thumbnail"
                              style={
                                !numbers && !detailed
                                  ? {
                                      width: thumbWidth,
                                      height: thumbHeight,
                                      background: s.background,
                                    }
                                  : undefined
                              }
                              aria-current={
                                s.id === activeId ? "page" : undefined
                              }
                              title={`${s.y + 1}.${s.x + 1} ${s.title} / ${pageOrigin(deck, s)}${s.id === activeId ? "（いまのページ）" : ""}`}
                              aria-label={
                                selection.active
                                  ? `${s.title}を選択`
                                  : filterOpen
                                    ? `フィルタ選択: ${s.y + 1}.${s.x + 1} ${s.title}`
                                    : `${s.title}を${moving ? "移動先にする" : "編集"}`
                              }
                              aria-pressed={
                                selection.active
                                  ? selection.ids.includes(s.id)
                                  : filterOpen
                                    ? matchesFilter(s, draftFilter)
                                    : undefined
                              }
                              onClick={() => {
                                if (filterOpen)
                                  setDraftFilter(
                                    toggleFilterSlide(draftFilter, s),
                                  );
                                else if (moving) dropAt(x, y);
                                else onEdit(s.id);
                              }}
                            >
                              {filterOpen && (
                                <span
                                  className="filter-card-check"
                                  aria-hidden="true"
                                >
                                  {matchesFilter(s, draftFilter) ? "✓" : ""}
                                </span>
                              )}
                              {numbers ? (
                                <span
                                  className="number-tile"
                                  style={{ height: thumbHeight }}
                                >
                                  {s.y + 1}.{s.x + 1}
                                </span>
                              ) : detailed ? (
                                <ThumbnailCanvas
                                  slide={s}
                                  zoom={thumbWidth / W}
                                />
                              ) : null}
                              {detailed &&
                                !filterOpen &&
                                s.id === presentationStartId && (
                                  <span className="start-badge">
                                    発表の先頭
                                  </span>
                                )}
                            </button>
                            {detailed && (
                              <div className="card-footer">
                                <span className="page-number">
                                  {s.y + 1}.{s.x + 1}
                                </span>
                                <ThumbnailFooter
                                  slide={s}
                                  label={footerLabel(s)}
                                  editable={
                                    !filterOpen &&
                                    !selection.active &&
                                    footerEditable(s)
                                  }
                                  onChange={onFooterChange}
                                />
                                {!filterOpen && (
                                  <>
                                    <button
                                      className="card-tool"
                                      aria-label={`${s.title}のページメニュー`}
                                      onClick={(event) =>
                                        onOpenMenu(event, { pageId: s.id })
                                      }
                                    >
                                      <MoreHorizontal size={14} />
                                    </button>
                                    <button
                                      style={{
                                        display:
                                          filtered || filterOpen
                                            ? "none"
                                            : undefined,
                                      }}
                                      className="card-tool"
                                      data-map-drag-handle
                                      aria-label={`${s.title}を移動`}
                                      onClick={() =>
                                        onMove({ mode: "slide", x, y })
                                      }
                                    >
                                      <GripVertical size={14} />
                                    </button>
                                    <button
                                      className="card-tool delete"
                                      aria-label={`${s.title}を削除`}
                                      onClick={() => onDelete(s.id)}
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                            {filtered && detailed && (
                              <div
                                className="filtered-origin"
                                title={pageOrigin(deck, s)}
                              >
                                {pageOrigin(deck, s)}
                              </div>
                            )}
                          </div>
                          {detailed && !filtered && !filterOpen && (
                            <>
                              <button
                                className="add-right add-dot"
                                aria-label={`${s.title}の右に次の話題を追加`}
                                title="次の話題へ（右）"
                                onClick={() => add(s, "right")}
                              >
                                <Plus size={15} />
                              </button>
                              <button
                                className="add-down add-dot"
                                aria-label={`${s.title}の下に詳しいページを追加`}
                                title="くわしく（下）"
                                onClick={() => add(s, "down")}
                              >
                                <Plus size={15} />
                              </button>
                            </>
                          )}
                        </>
                      ) : filtered ? (
                        <div />
                      ) : (
                        <button
                          className="empty-cell"
                          disabled={filterOpen}
                          aria-label={`${y + 1}.${x + 1}にページを${moving ? "移動" : "追加"}`}
                          onClick={() => {
                            if (moving) dropAt(x, y);
                            else onAddCell(x, y);
                          }}
                        >
                          {detailed && !filtered && !filterOpen && (
                            <>
                              <Plus size={19} />
                              <span>
                                {moving ? "ここへ移動" : "ページを追加"}
                              </span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  );
                })}
                <div className="grid-end map-row-end">
                  <div
                    className="map-insert-drop"
                    data-map-insert={`${cols},${y}`}
                    data-active={moving?.mode === "slide"}
                    data-over={
                      dropHint?.insert &&
                      dropHint.x === cols &&
                      dropHint.y === y
                    }
                    onDragEnter={(event) => {
                      if (moving?.mode !== "slide") return;
                      event.preventDefault();
                      event.stopPropagation();
                      hint({ x: cols, y, insert: true });
                    }}
                    onDragOver={(event) => {
                      if (moving?.mode !== "slide") return;
                      event.preventDefault();
                      event.stopPropagation();
                      hint({ x: cols, y, insert: true });
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      insertDrop(cols, y);
                    }}
                  >
                    <span className="insert-drop-line" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        {filtered && !displaySlides.length && (
          <p className="filter-empty">
            一致するページがありません。フィルタを解除するか、条件を変更してください。
          </p>
        )}
        <div className="map-bottom">
          <span>
            <span className="keyboard-key">↔</span> よこは「次の話題」
            <span className="legend-separator">/</span>
            <span className="keyboard-key">↕</span> たては「くわしい説明」
          </span>
          <span className="map-pinch-hint">
            長押し・つまみで移動 · ピンチで拡大・縮小
          </span>
        </div>
      </section>
    </main>
  );
}
// Keep the map's DOM and scroll position for a quick return. While hidden,
// editor keystrokes and cloud updates do not rerender its thumbnails.
export const MapView = memo(
  MapViewComponent,
  (previous, next) => !previous.visible && !next.visible,
);
