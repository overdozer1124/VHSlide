import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Element } from "./model";
import { useWebbing } from "./WebbingContext";
import { useGroups } from "./GroupsContext";
import { GroupBar } from "./GroupBar";
import type { WebbingNode } from "./webbing";
import { WEBBING_H, WEBBING_W } from "./webbing";
import { canDragForm } from "./formDrag";

function authorHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}
const clampX = (x: number) => Math.min(WEBBING_W - 50, Math.max(50, x));
const clampY = (y: number) => Math.min(WEBBING_H - 36, Math.max(36, y));

export function SlideWebbing(props: {
  element: Element;
  interactive?: boolean;
  onMoveStart?: (event: ReactPointerEvent) => void;
}) {
  const ctx = useWebbing();
  const binding = props.element.webbing!;
  const map =
    props.interactive && ctx.enabled && binding.deckId === ctx.deckId
      ? ctx.maps.find((m) => m.id === binding.mapId)
      : undefined;
  return (
    <section
      className={`slide-webbing ${props.interactive ? "is-interactive" : "is-preview"} ${props.onMoveStart ? "is-movable" : ""}`}
      data-slide-survey={props.interactive || undefined}
      data-webbing-map={binding.mapId}
      aria-label={`ウェビングマップ：${map?.title ?? binding.title}`}
      style={
        {
          background:
            props.element.fill === "none" ? "#ffffff" : props.element.fill,
          borderColor: props.element.stroke,
        } as React.CSSProperties
      }
      onPointerDown={
        props.interactive
          ? (e) => {
              if (props.onMoveStart && canDragForm(e)) props.onMoveStart(e);
              else e.stopPropagation();
            }
          : undefined
      }
      onClick={props.interactive ? (e) => e.stopPropagation() : undefined}
      onDoubleClick={
        props.interactive ? (e) => e.stopPropagation() : undefined
      }
      onKeyDown={props.interactive ? (e) => e.stopPropagation() : undefined}
      onTouchStart={props.interactive ? (e) => e.stopPropagation() : undefined}
      onTouchEnd={props.interactive ? (e) => e.stopPropagation() : undefined}
    >
      <header className="webbing-header">
        <span className="webbing-title">
          ウェブマップ · {map?.title ?? binding.title}
        </span>
        {map && (
          <span className="webbing-status">
            <span
              className={`webbing-chip ${map.status === "open" ? "is-open" : ""}`}
            >
              {map.status === "open"
                ? "書き込み受付中"
                : map.status === "closed"
                  ? "受付終了"
                  : "準備中"}
            </span>
            <span className="webbing-count">{map.nodes.length}件</span>
          </span>
        )}
      </header>
      {map ? (
        <WebbingStage mapId={map.id} />
      ) : (
        <div className="webbing-unavailable">
          <p>
            {!props.interactive
              ? "共有作品の編集・発表画面で書き込めます。"
              : binding.deckId !== ctx.deckId
                ? "書き込みは元のクラウド作品で受け付けます。"
                : "未公開・削除済み、または接続を確認中です。"}
          </p>
        </div>
      )}
    </section>
  );
}

function WebbingStage({ mapId }: { mapId: string }) {
  const ctx = useWebbing();
  const groupsCtx = useGroups();
  const map = ctx.maps.find((m) => m.id === mapId);
  const [activeGroupId, setActiveGroupId] = useState<string>();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const [wrapSize, setWrapSize] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const panRef = useRef<
    | { startX: number; startY: number; origX: number; origY: number }
    | undefined
  >(undefined);
  // View-only magnification on top of the fit scale; every viewer zooms
  // their own view, the shared map data does not change.
  const effScale = scale * zoom;
  const clampPan = (p: { x: number; y: number }, z: number) => ({
    x: Math.max(
      -(WEBBING_W * scale * z) / 2 - wrapSize.w / 2 + 40,
      Math.min((WEBBING_W * scale * z) / 2 + wrapSize.w / 2 - 40, p.x),
    ),
    y: Math.max(
      -(WEBBING_H * scale * z) / 2 - wrapSize.h / 2 + 40,
      Math.min((WEBBING_H * scale * z) / 2 + wrapSize.h / 2 - 40, p.y),
    ),
  });
  const viewRef = useRef({ zoom: 1, pan: { x: 0, y: 0 } });
  const applyZoom = (next: number, cx = 0, cy = 0) => {
    const prev = viewRef.current;
    const z = Math.max(1, Math.min(3.5, next));
    const ratio = z / prev.zoom;
    const p =
      z === 1
        ? { x: 0, y: 0 }
        : clampPan(
            {
              x: cx - (cx - prev.pan.x) * ratio,
              y: cy - (cy - prev.pan.y) * ratio,
            },
            z,
          );
    viewRef.current = { zoom: z, pan: p };
    setZoom(z);
    setPan(p);
  };
  const applyPan = (p: { x: number; y: number }) => {
    const clamped = clampPan(p, viewRef.current.zoom);
    viewRef.current = { zoom: viewRef.current.zoom, pan: clamped };
    setPan(clamped);
  };

  // Ctrl+wheel zooms toward the pointer. A native non-passive listener,
  // because React's root wheel listener cannot preventDefault the
  // browser's own page zoom.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = wrap.getBoundingClientRect();
      const cx = e.clientX - (rect.left + rect.width / 2);
      const cy = e.clientY - (rect.top + rect.height / 2);
      applyZoom(
        viewRef.current.zoom * Math.exp(-e.deltaY * 0.0018),
        cx,
        cy,
      );
    };
    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, wrapSize]);
  const [selected, setSelected] = useState<string>();
  const [editing, setEditing] = useState<{ id: string; text: string }>();
  const [draft, setDraft] = useState<{
    parentId: string;
    x: number;
    y: number;
    text: string;
  }>();
  const [confirmDelete, setConfirmDelete] = useState<string>();
  const [error, setError] = useState("");
  const [dragPos, setDragPos] = useState<Record<string, { x: number; y: number }>>(
    {},
  );
  const dragRef = useRef<
    | {
        id: string;
        startX: number;
        startY: number;
        origX: number;
        origY: number;
        moved: boolean;
      }
    | undefined
  >(undefined);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const unlockRef = useRef<(nodeId: string) => void>(() => {});
  unlockRef.current = (nodeId: string) => {
    if (map) void ctx.command(map.id, "unlock", { nodeId }).catch(() => {});
  };

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(() => {
      const rect = wrap.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setScale(Math.min(rect.width / WEBBING_W, rect.height / WEBBING_H));
        setWrapSize({ w: rect.width, h: rect.height });
      }
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  // Keep the edit lock alive while the editor is open; if the lock is lost
  // (server says someone else holds it), leave edit mode with a notice.
  useEffect(() => {
    if (!editing || !map) return;
    const timer = setInterval(() => {
      void ctx
        .command(map.id, "lock", { nodeId: editing.id })
        .catch((e: Error) => {
          setError(e.message);
          setEditing(undefined);
        });
    }, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id, map?.id]);
  useEffect(
    () => () => {
      const current = editingRef.current;
      if (current) unlockRef.current(current.id);
    },
    [],
  );

  if (!map) return <div className="webbing-unavailable" />;
  const groups = map.grouped ? groupsCtx.groups : [];
  const activeId: string | undefined = !map.grouped
    ? undefined
    : groups.some((g) => g.id === activeGroupId)
      ? activeGroupId
      : (groupsCtx.myGroupId ?? groups[0]?.id);
  const viewNodes = map.grouped
    ? map.nodes.filter((n) => n.groupId === activeId)
    : map.nodes;
  const canWrite = !!ctx.host || map.status === "open";
  // In a grouped map, writing happens only in your own group; the other
  // groups' boards are view-only. The host can write anywhere.
  const canWriteHere =
    canWrite && (!map.grouped || !!ctx.host || activeId === groupsCtx.myGroupId);
  const activeGroup = groups.find((g) => g.id === activeId);
  const pos = (node: WebbingNode) =>
    dragPos[node.id] ?? { x: node.x, y: node.y };
  const lockOf = (node: WebbingNode) =>
    map.locks.find((l) => l.nodeId === node.id && l.userId !== ctx.userId);
  const canModify = (node: WebbingNode) =>
    !!ctx.host || node.authorId === ctx.userId;
  const branchSize = (node: WebbingNode) => {
    const doomed = new Set([node.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of map.nodes)
        if (n.parentId && doomed.has(n.parentId) && !doomed.has(n.id)) {
          doomed.add(n.id);
          grew = true;
        }
    }
    return doomed.size;
  };

  async function startEdit(node: WebbingNode) {
    if (!map || !canWriteHere || !canModify(node)) return;
    const lock = lockOf(node);
    if (lock) {
      setError(`${lock.name}さんが編集中です。`);
      return;
    }
    try {
      await ctx.command(map.id, "lock", { nodeId: node.id });
      setError("");
      setEditing({ id: node.id, text: node.text });
      setSelected(node.id);
      setDraft(undefined);
      setConfirmDelete(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function saveEdit() {
    if (!map || !editing) return;
    try {
      await ctx.command(map.id, "node-edit", {
        nodeId: editing.id,
        text: editing.text,
      });
      await ctx
        .command(map.id, "unlock", { nodeId: editing.id })
        .catch(() => {});
      setEditing(undefined);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function cancelEdit() {
    if (map && editing)
      await ctx
        .command(map.id, "unlock", { nodeId: editing.id })
        .catch(() => {});
    setEditing(undefined);
  }
  function addChild(parent: WebbingNode) {
    if (!canWriteHere) return;
    const siblings = map!.nodes.filter((n) => n.parentId === parent.id).length;
    const angle = -Math.PI / 2 + siblings * 0.85;
    setDraft({
      parentId: parent.id,
      x: clampX(parent.x + Math.cos(angle) * 150),
      y: clampY(parent.y + Math.sin(angle) * 120),
      text: "",
    });
    setSelected(undefined);
    setConfirmDelete(undefined);
    setError("");
  }
  async function saveDraft() {
    if (!map || !draft) return;
    if (!draft.text.trim()) {
      setDraft(undefined);
      return;
    }
    try {
      const result = await ctx.command(map.id, "node-add", {
        parentId: draft.parentId,
        text: draft.text.trim(),
        x: draft.x,
        y: draft.y,
      });
      setDraft(undefined);
      if (result.createdId) setSelected(result.createdId);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function deleteNode(node: WebbingNode) {
    if (!map) return;
    try {
      await ctx.command(map.id, "node-delete", { nodeId: node.id });
      setSelected(undefined);
      setConfirmDelete(undefined);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function nodePointerDown(e: ReactPointerEvent, node: WebbingNode) {
    e.stopPropagation();
    // Toolbar buttons and the inline editor keep their own clicks; starting
    // a node drag here would capture the pointer and swallow them.
    if ((e.target as HTMLElement).closest("button,textarea,input,select"))
      return;
    if (e.button !== 0 || editing || draft) {
      setSelected(node.id);
      return;
    }
    setSelected(node.id);
    setConfirmDelete(undefined);
    if (!canWriteHere || !canModify(node) || lockOf(node)) return;
    dragRef.current = {
      id: node.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: node.x,
      origY: node.y,
      moved: false,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function nodePointerMove(e: ReactPointerEvent, node: WebbingNode) {
    const drag = dragRef.current;
    if (!drag || drag.id !== node.id) return;
    const dx = (e.clientX - drag.startX) / effScale;
    const dy = (e.clientY - drag.startY) / effScale;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (drag.moved)
      setDragPos((prev) => ({
        ...prev,
        [node.id]: { x: clampX(drag.origX + dx), y: clampY(drag.origY + dy) },
      }));
  }
  function nodePointerUp(node: WebbingNode) {
    const drag = dragRef.current;
    dragRef.current = undefined;
    if (!drag || drag.id !== node.id || !drag.moved || !map) return;
    const final = dragPos[node.id];
    setDragPos((prev) => {
      const next = { ...prev };
      delete next[node.id];
      return next;
    });
    if (final)
      void ctx
        .command(map.id, "node-edit", { nodeId: node.id, x: final.x, y: final.y })
        .catch((e: Error) => {
          setError(e.message);
          void ctx.refresh().catch(() => {});
        });
  }

  const draftParent = draft
    ? viewNodes.find((n) => n.id === draft.parentId)
    : undefined;
  return (
    <>
      {map.grouped &&
        (groups.length ? (
          <GroupBar
            groups={groups}
            myGroupId={groupsCtx.myGroupId}
            host={!!ctx.host}
            activeGroupId={activeId}
            onSelect={(groupId) => {
              setActiveGroupId(groupId);
              setSelected(undefined);
              setConfirmDelete(undefined);
              setDraft(undefined);
            }}
            onJoin={(groupId) => groupsCtx.command("join", { groupId })}
          />
        ) : (
          <p className="group-bar-note">
            {ctx.host
              ? "グループがまだ設定されていません。フォーム画面の「ウェブマップ」タブで、この作品のグループを作成してください。"
              : "先生がグループを設定すると始まります。"}
          </p>
        ))}
    <div className="webbing-stage-wrap" ref={wrapRef}>
      <div
        className={`webbing-stage ${zoom > 1 ? "is-zoomed" : ""} ${panning ? "is-panning" : ""}`}
        style={{
          width: WEBBING_W,
          height: WEBBING_H,
          transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${effScale})`,
        }}
        onPointerDown={(e) => {
          setSelected(undefined);
          setConfirmDelete(undefined);
          if (e.button !== 0 || zoom <= 1) return;
          panRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            origX: viewRef.current.pan.x,
            origY: viewRef.current.pan.y,
          };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          setPanning(true);
        }}
        onPointerMove={(e) => {
          const start = panRef.current;
          if (!start) return;
          applyPan({
            x: start.origX + (e.clientX - start.startX),
            y: start.origY + (e.clientY - start.startY),
          });
        }}
        onPointerUp={() => {
          panRef.current = undefined;
          setPanning(false);
        }}
        onPointerCancel={() => {
          panRef.current = undefined;
          setPanning(false);
        }}
      >
        <svg className="webbing-edges" width={WEBBING_W} height={WEBBING_H}>
          {viewNodes
            .filter((n) => n.parentId)
            .map((n) => {
              const parent = viewNodes.find((p) => p.id === n.parentId);
              if (!parent) return null;
              const a = pos(parent);
              const b = pos(n);
              return (
                <line
                  key={n.id}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="#9db8a4"
                  strokeWidth={2}
                />
              );
            })}
          {draft && draftParent && (
            <line
              x1={draftParent.x}
              y1={draftParent.y}
              x2={draft.x}
              y2={draft.y}
              stroke="#9db8a4"
              strokeWidth={2}
              strokeDasharray="6 5"
            />
          )}
        </svg>
        {viewNodes.map((node) => {
          const p = pos(node);
          const lock = lockOf(node);
          const isRoot = node.parentId === null;
          const isEditing = editing?.id === node.id;
          const hue = authorHue(node.authorId);
          return (
            <div
              key={node.id}
              className={`webbing-node ${isRoot ? "is-root" : ""} ${selected === node.id ? "is-selected" : ""} ${lock ? "is-locked" : ""}`}
              data-webbing-node={node.id}
              style={{
                left: p.x,
                top: p.y,
                ...(isRoot
                  ? {}
                  : {
                      borderColor: `hsl(${hue} 45% 45%)`,
                      background: `hsl(${hue} 70% 93%)`,
                    }),
              }}
              onPointerDown={(e) => nodePointerDown(e, node)}
              onPointerMove={(e) => nodePointerMove(e, node)}
              onPointerUp={() => nodePointerUp(node)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (!isEditing) void startEdit(node);
              }}
            >
              {lock && (
                <span className="webbing-node-lock">
                  {lock.name}さんが編集中
                </span>
              )}
              {isEditing ? (
                <span className="webbing-node-editor">
                  <textarea
                    aria-label="書き込みを編集"
                    value={editing.text}
                    maxLength={100}
                    rows={2}
                    autoFocus
                    onChange={(e) =>
                      setEditing({ id: node.id, text: e.target.value })
                    }
                    onPointerDown={(e) => e.stopPropagation()}
                  />
                  <span className="webbing-node-editor-actions">
                    <button type="button" onClick={() => void saveEdit()}>
                      保存
                    </button>
                    <button type="button" onClick={() => void cancelEdit()}>
                      やめる
                    </button>
                  </span>
                </span>
              ) : (
                <>
                  <span className="webbing-node-text">{node.text}</span>
                  {!isRoot && (
                    <span className="webbing-node-author">
                      {node.authorName}
                    </span>
                  )}
                </>
              )}
              {selected === node.id && !isEditing && (
                <span className="webbing-node-tools">
                  {confirmDelete === node.id ? (
                    <>
                      <span className="webbing-confirm-text">
                        この枝（{branchSize(node)}件）を削除しますか？
                      </span>
                      <button
                        type="button"
                        onClick={() => void deleteNode(node)}
                      >
                        削除する
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(undefined)}
                      >
                        やめる
                      </button>
                    </>
                  ) : (
                    <>
                      {canWriteHere && (
                        <button type="button" onClick={() => addChild(node)}>
                          子を追加
                        </button>
                      )}
                      {canModify(node) && !lock && canWriteHere && (
                        <button
                          type="button"
                          onClick={() => void startEdit(node)}
                        >
                          編集
                        </button>
                      )}
                      {canModify(node) &&
                        !lock &&
                        canWriteHere &&
                        node.parentId !== null && (
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(node.id)}
                          >
                            削除
                          </button>
                        )}
                    </>
                  )}
                </span>
              )}
            </div>
          );
        })}
        {draft && (
          <div
            className="webbing-node is-draft"
            style={{ left: draft.x, top: draft.y }}
          >
            <span className="webbing-node-editor">
              <textarea
                aria-label="新しい書き込み"
                value={draft.text}
                maxLength={100}
                rows={2}
                autoFocus
                placeholder="思いついたことを書こう"
                onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                onPointerDown={(e) => e.stopPropagation()}
              />
              <span className="webbing-node-editor-actions">
                <button type="button" onClick={() => void saveDraft()}>
                  追加する
                </button>
                <button type="button" onClick={() => setDraft(undefined)}>
                  やめる
                </button>
              </span>
            </span>
          </div>
        )}
        {map.status === "open" && viewNodes.length === 1 && !draft && canWriteHere && (
          <p className="webbing-hint">
            中心のテーマを選んで「子を追加」から、思いついたことを書き足していこう
          </p>
        )}
        {map.grouped && !ctx.host && groupsCtx.myGroupId && activeId !== groupsCtx.myGroupId && (
          <p className="webbing-hint">
            {activeGroup?.name ?? "他のグループ"}のマップを表示しています（書き込みは自分のグループだけ）
          </p>
        )}
        {map.status !== "open" && (
          <p className="webbing-hint">
            {map.status === "closed"
              ? "書き込みの受付は終了しました"
              : "先生が受付を開始すると書き込めます"}
          </p>
        )}
      </div>
      <div
        className="webbing-zoom"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="縮小"
          disabled={zoom <= 1}
          onClick={() => applyZoom(viewRef.current.zoom / 1.3)}
        >
          −
        </button>
        <span className="webbing-zoom-label">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          aria-label="拡大"
          disabled={zoom >= 3.5}
          onClick={() => applyZoom(viewRef.current.zoom * 1.3)}
        >
          ＋
        </button>
        <button
          type="button"
          className="webbing-zoom-reset"
          aria-label="全体表示に戻す"
          disabled={zoom === 1}
          onClick={() => applyZoom(1)}
        >
          全体
        </button>
      </div>
      {error && (
        <p className="webbing-error" role="alert">
          {error}
        </p>
      )}
    </div>
    </>
  );
}
