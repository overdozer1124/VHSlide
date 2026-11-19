import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Element } from "./model";
import { useThinking } from "./ThinkingContext";
import { useGroups } from "./GroupsContext";
import {
  BOARD_ZONE_SPECS,
  VENN_CIRCLES,
  XCHART_CENTER,
  curveKey,
  splitCurveKey,
  thinkingOwnerLabels,
  zoneAtPoint,
} from "./thinkingTools";
import type {
  ThinkingCard,
  ThinkingPoint,
  ThinkingPointValue,
  ThinkingView,
} from "./thinkingTools";
import { canDragForm } from "./formDrag";
import { ThinkingThumbBoard } from "./ThinkingThumbBoard";

const FACES = ["😞", "😕", "😐", "🙂", "😄"];
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function ownerHue(owner: string): number {
  let h = 0;
  for (let i = 0; i < owner.length; i++) h = (h * 31 + owner.charCodeAt(i)) % 360;
  return h;
}

export function SlideThinking(props: {
  element: Element;
  interactive?: boolean;
  onMoveStart?: (event: ReactPointerEvent) => void;
}) {
  const ctx = useThinking();
  const binding = props.element.thinking!;
  const tool =
    ctx.enabled && binding.deckId === ctx.deckId
      ? ctx.tools.find((t) => t.id === binding.toolId)
      : undefined;
  return (
    <section
      className={`slide-thinking ${props.interactive ? "is-interactive" : "is-preview"} ${props.onMoveStart ? "is-movable" : ""}`}
      data-slide-survey={props.interactive || undefined}
      data-thinking-tool={binding.toolId}
      aria-label={`思考ツール：${tool?.definition.title ?? binding.title}`}
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
          思考ツール · {tool?.definition.title ?? binding.title}
        </span>
        {tool && (
          <span className="webbing-status">
            <span
              className={`webbing-chip ${tool.status === "open" ? "is-open" : ""}`}
            >
              {tool.status === "open"
                ? "書き込み受付中"
                : tool.status === "closed"
                  ? "受付終了"
                  : "準備中"}
            </span>
          </span>
        )}
      </header>
      {tool ? (
        tool.kind === "board" ? (
          <BoardSurface tool={tool} interactive={!!props.interactive} />
        ) : tool.kind === "point" ? (
          tool.template === "curve" ? (
            <CurveSurface tool={tool} interactive={!!props.interactive} />
          ) : (
            <ThinkingSurface tool={tool} interactive={!!props.interactive} />
          )
        ) : (
          <div className="webbing-unavailable">
            <p>このツールは、新しい版のVHSlideで開いてください。</p>
          </div>
        )
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

function ThinkingSurface({
  tool,
  interactive,
}: {
  tool: ThinkingView;
  interactive: boolean;
}) {
  const ctx = useThinking();
  const groupsCtx = useGroups();
  const def = tool.definition;
  const myOwner =
    tool.unit === "group" ? (tool.myGroupId ?? "") : (ctx.userId ?? "");
  const [sceneSel, setSceneSel] = useState<string | undefined>(undefined);
  const scene =
    def.scenes.length === 0
      ? ""
      : def.sceneMode === "teacher"
        ? tool.scene || (def.scenes[0]?.id ?? "")
        : (sceneSel ?? tool.scene ?? def.scenes[0]?.id ?? "");
  const myPoints = tool.points.filter((p) => p.owner === myOwner);
  const myPoint = myPoints.find((p) => p.scene === scene);
  // Lock expiry is time-based and does not move the poll version, so the
  // client re-checks the expiry itself once a second.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const lock = tool.locks.find(
    (l) => l.owner === myOwner && l.scene === scene && l.expires > nowTick,
  );
  const lockedByOther = !!lock && lock.userId !== ctx.userId;
  const canEdit =
    interactive &&
    tool.status === "open" &&
    !lockedByOther &&
    (tool.unit !== "group" || !!tool.myGroupId || !ctx.host) &&
    !(ctx.host && tool.unit === "group");
  const [draft, setDraft] = useState<ThinkingPointValue | undefined>(
    undefined,
  );
  const [reason, setReason] = useState<string | undefined>(undefined);
  const shownValue = draft ?? myPoint?.value;
  const shownReason = reason ?? myPoint?.reason ?? "";
  // Drop local drafts once the server state catches up or the scene moves.
  useEffect(() => {
    setDraft(undefined);
    setReason(undefined);
    setNotice("");
  }, [scene, tool.id]);
  useEffect(() => {
    if (draft && myPoint && JSON.stringify(myPoint.value) === JSON.stringify(draft))
      setDraft(undefined);
  }, [myPoint, draft]);

  const [notice, setNotice] = useState("");
  // Host-only slide display state (user decision 2026-11-17, point
  // tools): the host can narrow the slide to one student's (or one
  // group's) points instead of everyone's, and author names stay
  // hidden until the host explicitly turns them on. Display-only —
  // nothing extra is ever sent to student terminals.
  const [focusOwner, setFocusOwner] = useState("");
  const [showNames, setShowNames] = useState(false);
  async function commit(value: ThinkingPointValue, nextReason?: string) {
    try {
      await ctx.command(tool.id, "point", {
        scene,
        value,
        ...(def.reason
          ? { reason: nextReason ?? shownReason }
          : {}),
        ...(tool.unit === "group" ? { owner: myOwner } : {}),
      });
      setNotice("");
    } catch (e) {
      setDraft(undefined);
      // A 409 here is almost always a classmate's edit lock: say so
      // instead of silently snapping the point back (review 🟡5).
      if ((e as { status?: number }).status === 409)
        setNotice((e as Error).message);
    }
  }
  /** Group points are shared: take the edit lock when a drag starts,
   * not only when the point is dropped (review 🟡5). */
  function beginSharedEdit() {
    if (tool.unit !== "group" || !canEdit) return;
    void ctx
      .command(tool.id, "lock", { scene, owner: myOwner })
      .catch(() => {});
  }
  async function clearPoint() {
    setDraft(undefined);
    try {
      await ctx.command(tool.id, "clear", {
        scene,
        ...(tool.unit === "group" ? { owner: myOwner } : {}),
      });
    } catch {
      /* the fresh list shows the outcome */
    }
  }
  // Reasons autosave shortly after typing stops (like worksheet text);
  // blur alone is unreliable inside the canvas, which keeps focus.
  const commitRef = useRef(commit);
  commitRef.current = commit;
  // Arrow keys: update the draft immediately but send only once the
  // keys settle (~0.5s), like the reason autosave — one request per
  // keypress would hit the rate limit on a long hold (review 🟡4).
  const keyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  function commitKeys(value: ThinkingPointValue) {
    setDraft(value);
    if (keyTimer.current) clearTimeout(keyTimer.current);
    keyTimer.current = setTimeout(() => {
      void commitRef.current(value);
    }, 500);
  }
  useEffect(() => {
    if (reason === undefined || !shownValue) return;
    if (reason === (myPoint?.reason ?? "")) return;
    const t = setTimeout(() => {
      void commitRef.current(shownValue, reason);
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reason, shownValue, myPoint?.reason]);

  if (tool.unit === "group" && !tool.myGroupId && !ctx.host) {
    return (
      <div className="thinking-join">
        <p>この思考ツールは班ごとに書き込みます。班に入ってください。</p>
        <div className="thinking-join-buttons">
          {groupsCtx.groups.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => void groupsCtx.command("join", { groupId: g.id })}
            >
              {g.name}に入る
            </button>
          ))}
        </div>
      </div>
    );
  }

  const others = ctx.host
    ? tool.points.filter(
        (p) =>
          p.scene === scene &&
          p.owner !== myOwner &&
          (!focusOwner || p.owner === focusOwner),
      )
    : [];
  // Who the host can narrow the slide to. Labels follow the same
  // convention as the board thumbnails: group names are not personal,
  // student names appear only while the host has names turned on.
  const pointOwners: { owner: string; label: string }[] =
    tool.unit === "group"
      ? groupsCtx.groups.map((g) => ({ owner: g.id, label: g.name }))
      : thinkingOwnerLabels(
          tool.points
            .filter((p) => p.owner !== myOwner)
            .map((p) => p.owner),
          (owner) =>
            tool.ownerNames?.[owner] ||
            tool.points.find((p) => p.owner === owner)?.authorName ||
            undefined,
          showNames,
          tool.roster,
        );
  const ghosts = myPoints
    .filter((p) => p.scene !== scene)
    .sort(
      (a, b) =>
        def.scenes.findIndex((s) => s.id === a.scene) -
        def.scenes.findIndex((s) => s.id === b.scene),
    );

  return (
    <div className="thinking-body">
      {def.scenes.length > 0 && (
        <div
          className="thinking-scenes"
          role="tablist"
          aria-label="場面"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {def.scenes.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === scene}
              className={s.id === scene ? "is-active" : ""}
              disabled={
                def.sceneMode === "teacher" && !ctx.host && s.id !== scene
              }
              onClick={() => {
                if (def.sceneMode === "teacher") {
                  if (ctx.host)
                    void ctx.command(tool.id, "scene", { scene: s.id });
                } else setSceneSel(s.id);
              }}
            >
              {s.label}
            </button>
          ))}
          {def.sceneMode === "teacher" && !ctx.host && (
            <span className="thinking-scene-note">先生が場面を切り替えます</span>
          )}
        </div>
      )}
      {ctx.host && interactive && tool.template !== "ratio" && (
        <div
          className="thinking-hostbar"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span className="thinking-hostbar-label">表示</span>
          <button
            type="button"
            className={!focusOwner ? "is-active" : ""}
            onClick={() => setFocusOwner("")}
          >
            全員
          </button>
          {pointOwners.map((o) => (
            <button
              key={o.owner}
              type="button"
              className={focusOwner === o.owner ? "is-active" : ""}
              onClick={() => setFocusOwner(o.owner)}
            >
              {o.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowNames((v) => !v)}
          >
            {showNames ? "名前を隠す" : "名前を出す"}
          </button>
        </div>
      )}
      {tool.template === "ratio" ? (
        <RatioSurface
          key={scene}
          tool={tool}
          value={shownValue}
          canEdit={canEdit}
          ghosts={ghosts}
          onDragStart={beginSharedEdit}
          onCommit={(v) => {
            setDraft(v);
            void commit(v);
          }}
        />
      ) : (
        <AxisSurface
          key={scene}
          tool={tool}
          value={shownValue}
          canEdit={canEdit}
          ghosts={ghosts}
          others={others}
          labelOthers={showNames && !!focusOwner}
          onDraft={setDraft}
          onCommit={(v) => void commit(v)}
          onKeyCommit={commitKeys}
          onDragStart={beginSharedEdit}
        />
      )}
      {lockedByOther && (
        <p className="thinking-lock-note">{lock.name}さんが編集中です</p>
      )}
      {notice && <p className="thinking-lock-note">{notice}</p>}
      {def.reason && (
        <div
          className="thinking-reason"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <label>
            理由
            <textarea
              aria-label="理由"
              value={shownReason}
              disabled={!interactive || tool.status !== "open"}
              maxLength={200}
              rows={2}
              placeholder="そう考えた理由を書こう"
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => {
                if (shownValue && reason !== undefined)
                  void commit(shownValue, reason);
              }}
            />
          </label>
        </div>
      )}
      {interactive && myPoint && tool.status === "open" && (
        <div
          className="thinking-actions"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button type="button" onClick={() => void clearPoint()}>
            この場面の点を消す
          </button>
        </div>
      )}
    </div>
  );
}


const CURVE_LINE_COLORS = ["#e2703a", "#3a7bd5", "#3aa655"];
export const curveLineColor = (index: number) =>
  CURVE_LINE_COLORS[index % CURVE_LINE_COLORS.length];

/** The emotion curve （心情曲線）: one point per story scene, joined
 * into a line per character. Points live in the ordinary point rows
 * under the composed key "sceneId:lineId". Students edit the line
 * chosen in the tab row; the host's slide overlays everyone's lines
 * (names and focus follow the point-tool host bar convention). */
function CurveSurface({
  tool,
  interactive,
}: {
  tool: ThinkingView;
  interactive: boolean;
}) {
  const ctx = useThinking();
  const groupsCtx = useGroups();
  const def = tool.definition;
  const myOwner =
    tool.unit === "group"
      ? (tool.myGroupId ?? "")
      : tool.unit === "class"
        ? ""
        : (ctx.userId ?? "");
  const [lineSel, setLineSel] = useState("");
  const lineId = def.lines.some((l) => l.id === lineSel)
    ? lineSel
    : (def.lines[0]?.id ?? "");
  const [selected, setSelected] = useState("");
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [reasonDraft, setReasonDraft] = useState<string | undefined>(
    undefined,
  );
  const [notice, setNotice] = useState("");
  const [focusOwner, setFocusOwner] = useState("");
  const [showNames, setShowNames] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const plotRef = useRef<HTMLDivElement>(null);
  const dragKey = useRef("");
  const canEdit =
    interactive &&
    tool.status === "open" &&
    (tool.unit !== "group" || !!tool.myGroupId || !ctx.host) &&
    !(ctx.host && tool.unit === "group");
  // Points on scenes/lines the teacher later removed from the
  // definition stay stored but are not shown (design review 🟡1).
  const validKeys = new Set(
    def.scenes.flatMap((s) => def.lines.map((l) => curveKey(s.id, l.id))),
  );
  const visiblePoints = tool.points.filter((p) => validKeys.has(p.scene));
  const myPoints = visiblePoints.filter((p) => p.owner === myOwner);
  const myByKey = new Map(myPoints.map((p) => [p.scene, p]));
  const selectedPoint = selected ? myByKey.get(selected) : undefined;
  const shownReason = reasonDraft ?? selectedPoint?.reason ?? "";
  // Drop a draft once the server value matches it.
  useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const [key, v] of Object.entries(prev)) {
        const p = myByKey.get(key);
        if (p && p.value.v === v) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool.points]);
  useEffect(() => {
    setReasonDraft(undefined);
  }, [selected, tool.id]);

  async function commitPoint(key: string, v: number, reason?: string) {
    const existing = myByKey.get(key);
    try {
      await ctx.command(tool.id, "point", {
        scene: key,
        value: { v },
        reason: reason ?? existing?.reason ?? "",
        ...(tool.unit === "group" ? { owner: myOwner } : {}),
      });
      setNotice("");
    } catch (e) {
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      if ((e as { status?: number }).status === 409)
        setNotice((e as Error).message);
    }
  }
  const commitRef = useRef(commitPoint);
  commitRef.current = commitPoint;
  const keyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  function commitKeys(key: string, v: number) {
    setDrafts((prev) => ({ ...prev, [key]: v }));
    if (keyTimer.current) clearTimeout(keyTimer.current);
    keyTimer.current = setTimeout(
      () => void commitRef.current(key, v),
      500,
    );
  }
  // The one-line note autosaves shortly after typing stops.
  useEffect(() => {
    if (reasonDraft === undefined || !selected) return;
    if (reasonDraft === (selectedPoint?.reason ?? "")) return;
    const v = drafts[selected] ?? selectedPoint?.value.v;
    if (v === undefined) return;
    const t = setTimeout(
      () => void commitRef.current(selected, v, reasonDraft),
      900,
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reasonDraft, selected]);
  async function clearPoint(key: string) {
    try {
      await ctx.command(tool.id, "clear", {
        scene: key,
        ...(tool.unit === "group" ? { owner: myOwner } : {}),
      });
      setSelected("");
    } catch {
      /* the fresh list shows the outcome */
    }
  }
  function fromEvent(e: ReactPointerEvent): { key: string; v: number } {
    const rect = plotRef.current!.getBoundingClientRect();
    const fx = clamp01((e.clientX - rect.left) / rect.width);
    const fy = clamp01((e.clientY - rect.top) / rect.height);
    const index = Math.min(
      def.scenes.length - 1,
      Math.floor(fx * def.scenes.length),
    );
    return {
      key: curveKey(def.scenes[index].id, lineId),
      v: Math.round((1 - fy) * 100) / 100,
    };
  }
  const lockOf = (key: string) =>
    tool.locks.find(
      (l) => l.owner === myOwner && l.scene === key && l.expires > nowTick,
    );
  const selectedLock = selected ? lockOf(selected) : undefined;
  const selectedLockedByOther =
    !!selectedLock && selectedLock.userId !== ctx.userId;

  if (tool.unit === "group" && !tool.myGroupId && !ctx.host) {
    return (
      <div className="thinking-join">
        <p>この思考ツールは班ごとに書き込みます。班に入ってください。</p>
        <div className="thinking-join-buttons">
          {groupsCtx.groups.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => void groupsCtx.command("join", { groupId: g.id })}
            >
              {g.name}に入る
            </button>
          ))}
        </div>
      </div>
    );
  }

  const xOf = (sceneId: string) =>
    ((def.scenes.findIndex((s) => s.id === sceneId) + 0.5) /
      def.scenes.length) *
    100;
  const linePoints = (
    points: ThinkingPoint[],
    owner: string,
    line: string,
  ): { x: number; y: number; key: string; point: ThinkingPoint }[] =>
    points
      .filter((p) => {
        if (p.owner !== owner) return false;
        const parts = splitCurveKey(p.scene);
        return parts?.lineId === line;
      })
      .map((p) => ({
        x: xOf(splitCurveKey(p.scene)!.sceneId),
        y: (1 - (p.value.v ?? 0)) * 100,
        key: p.scene,
        point: p,
      }))
      .sort((a, b) => a.x - b.x);
  const polyline = (pts: { x: number; y: number }[]) =>
    pts.map((p) => `${p.x},${p.y}`).join(" ");
  const otherOwners = ctx.host
    ? [...new Set(visiblePoints.map((p) => p.owner))].filter(
        (o) => o !== myOwner,
      )
    : [];
  const ownerLabels = thinkingOwnerLabels(
    otherOwners,
    (owner) => tool.ownerNames?.[owner] || undefined,
    showNames,
    tool.roster,
  );

  return (
    <div className="thinking-body">
      {def.lines.length > 1 && (
        <div
          className="thinking-scenes"
          role="tablist"
          aria-label="線（登場人物）"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {def.lines.map((l, i) => (
            <button
              key={l.id}
              type="button"
              role="tab"
              aria-selected={l.id === lineId}
              className={l.id === lineId ? "is-active" : ""}
              onClick={() => setLineSel(l.id)}
            >
              <span
                className="thinking-curve-dot"
                style={{ background: curveLineColor(i) }}
              />
              {l.label}
            </button>
          ))}
        </div>
      )}
      {ctx.host && interactive && (
        <div
          className="thinking-hostbar"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span className="thinking-hostbar-label">表示</span>
          <button
            type="button"
            className={!focusOwner ? "is-active" : ""}
            onClick={() => setFocusOwner("")}
          >
            全員
          </button>
          {ownerLabels.map((o) => (
            <button
              key={o.owner}
              type="button"
              className={focusOwner === o.owner ? "is-active" : ""}
              onClick={() => setFocusOwner(o.owner)}
            >
              {o.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowNames((v) => !v)}
          >
            {showNames ? "名前を隠す" : "名前を出す"}
          </button>
        </div>
      )}
      <div className="thinking-curve">
        <div className="thinking-curve-ylabels" aria-hidden="true">
          <span>{def.yMax}</span>
          <span>{def.yMin}</span>
        </div>
        <div className="thinking-curve-main">
          <div
            ref={plotRef}
            className={`thinking-curve-plot ${canEdit ? "is-editable" : ""}`}
            role={canEdit ? "application" : undefined}
            aria-label={def.title}
            onPointerDown={(e) => {
              if (!canEdit) return;
              e.stopPropagation();
              const { key, v } = fromEvent(e);
              if (lockOf(key)?.userId && lockOf(key)?.userId !== ctx.userId)
                return;
              dragKey.current = key;
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
              if (tool.unit === "group")
                void ctx
                  .command(tool.id, "lock", { scene: key, owner: myOwner })
                  .catch(() => {});
              setSelected(key);
              setDrafts((prev) => ({ ...prev, [key]: v }));
            }}
            onPointerMove={(e) => {
              if (!dragKey.current || !canEdit) return;
              const { key, v } = fromEvent(e);
              if (key === dragKey.current)
                setDrafts((prev) => ({ ...prev, [key]: v }));
            }}
            onPointerUp={(e) => {
              if (!dragKey.current) return;
              const key = dragKey.current;
              dragKey.current = "";
              const { v } = fromEvent(e);
              if (canEdit) void commitPoint(key, v);
            }}
          >
            {def.scenes.map((s) => (
              <span
                key={s.id}
                className="thinking-curve-grid"
                style={{ left: `${xOf(s.id)}%` }}
              />
            ))}
            <span className="thinking-curve-grid is-mid" />
            <svg
              className="thinking-curve-lines"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {ctx.host &&
                otherOwners.map((owner) =>
                  def.lines.map((l) => {
                    const pts = linePoints(visiblePoints, owner, l.id);
                    if (pts.length < 2) return null;
                    const dim = focusOwner && focusOwner !== owner;
                    return (
                      <polyline
                        key={`${owner}:${l.id}`}
                        points={polyline(pts)}
                        stroke={`hsl(${ownerHue(owner)} 60% 55%)`}
                        strokeWidth={focusOwner === owner ? 1.6 : 0.7}
                        opacity={dim ? 0.08 : focusOwner ? 0.9 : 0.35}
                      />
                    );
                  }),
                )}
              {def.lines.map((l, li) => {
                const pts = linePoints(myPoints, myOwner, l.id).map(
                  (p) => ({
                    ...p,
                    y:
                      drafts[p.key] !== undefined
                        ? (1 - drafts[p.key]) * 100
                        : p.y,
                  }),
                );
                if (pts.length < 2) return null;
                return (
                  <polyline
                    key={l.id}
                    points={polyline(pts)}
                    stroke={curveLineColor(li)}
                    strokeWidth={l.id === lineId ? 1.4 : 0.8}
                    opacity={l.id === lineId ? 1 : 0.55}
                  />
                );
              })}
            </svg>
            {ctx.host &&
              otherOwners.map((owner) =>
                visiblePoints
                  .filter((p) => p.owner === owner)
                  .map((p) => {
                    const parts = splitCurveKey(p.scene);
                    if (!parts) return null;
                    const dim = focusOwner && focusOwner !== owner;
                    return (
                      <span
                        key={`${owner}:${p.scene}`}
                        className="thinking-point is-other"
                        style={{
                          left: `${xOf(parts.sceneId)}%`,
                          top: `${(1 - (p.value.v ?? 0)) * 100}%`,
                          background: `hsl(${ownerHue(owner)} 60% 55%)`,
                          opacity: dim ? 0.15 : 0.75,
                        }}
                      />
                    );
                  }),
              )}
            {myPoints.map((p) => {
              const parts = splitCurveKey(p.scene);
              if (!parts) return null;
              const v = drafts[p.scene] ?? p.value.v ?? 0;
              const isActive = parts.lineId === lineId;
              const style = {
                left: `${xOf(parts.sceneId)}%`,
                top: `${(1 - v) * 100}%`,
                background: curveLineColor(
                  def.lines.findIndex((l) => l.id === parts.lineId),
                ),
              };
              return canEdit && isActive ? (
                <button
                  key={p.scene}
                  type="button"
                  className={`thinking-point is-mine ${selected === p.scene ? "is-selected" : ""}`}
                  style={style}
                  aria-label={`${def.scenes.find((s) => s.id === parts.sceneId)?.label ?? ""}の点（矢印キーで動かせます）`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setSelected(p.scene)}
                  onKeyDown={(e) => {
                    const step = e.shiftKey ? 0.1 : 0.02;
                    let next: number | undefined;
                    if (e.key === "ArrowUp") next = clamp01(v + step);
                    if (e.key === "ArrowDown") next = clamp01(v - step);
                    if (next !== undefined) {
                      e.preventDefault();
                      e.stopPropagation();
                      setSelected(p.scene);
                      commitKeys(p.scene, Math.round(next * 100) / 100);
                    }
                  }}
                />
              ) : (
                <span
                  key={p.scene}
                  className="thinking-point is-mine"
                  style={{ ...style, opacity: isActive ? 1 : 0.55 }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    setSelected(p.scene);
                    if (isActive) return;
                    setLineSel(parts.lineId);
                  }}
                />
              );
            })}
            {!myPoints.length && canEdit && (
              <span className="thinking-hint">
                場面の列をタップして、気持ちの点を置こう
              </span>
            )}
          </div>
          <div className="thinking-curve-scenes" aria-hidden="true">
            {def.scenes.map((s) => (
              <span key={s.id}>{s.label}</span>
            ))}
          </div>
        </div>
      </div>
      {selectedLockedByOther && (
        <p className="thinking-lock-note">
          {selectedLock?.name}さんが編集中です
        </p>
      )}
      {notice && <p className="thinking-lock-note">{notice}</p>}
      {selected && (selectedPoint || drafts[selected] !== undefined) && (
        <div
          className="thinking-reason"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <label>
            {(() => {
              const parts = splitCurveKey(selected);
              const sceneLabel = def.scenes.find(
                (s) => s.id === parts?.sceneId,
              )?.label;
              const lineLabel = def.lines.find(
                (l) => l.id === parts?.lineId,
              )?.label;
              return `${sceneLabel ?? ""}${lineLabel ? `・${lineLabel}` : ""}の一言`;
            })()}
            <textarea
              aria-label="一言"
              value={shownReason}
              disabled={!canEdit}
              maxLength={200}
              rows={2}
              placeholder="この場面の気持ちを一言で書こう"
              onChange={(e) => setReasonDraft(e.target.value)}
              onBlur={() => {
                const v = drafts[selected] ?? selectedPoint?.value.v;
                if (v !== undefined && reasonDraft !== undefined)
                  void commitPoint(selected, v, reasonDraft);
              }}
            />
          </label>
          {canEdit && selectedPoint && (
            <div className="thinking-actions">
              <button
                type="button"
                onClick={() => void clearPoint(selected)}
              >
                この点を消す
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Axes (axis2), one axis (axis1) and the emotion meter share one surface:
 * a point placed by tap/drag, arrow keys, with ghost points from the
 * other scenes joined by a line. */
function AxisSurface({
  tool,
  value,
  canEdit,
  ghosts,
  others,
  labelOthers,
  onDraft,
  onCommit,
  onKeyCommit,
  onDragStart,
}: {
  tool: ThinkingView;
  value?: ThinkingPointValue;
  canEdit: boolean;
  ghosts: ThinkingPoint[];
  others: ThinkingPoint[];
  labelOthers?: boolean;
  onDraft: (v: ThinkingPointValue) => void;
  onCommit: (v: ThinkingPointValue) => void;
  onKeyCommit: (v: ThinkingPointValue) => void;
  onDragStart: () => void;
}) {
  const def = tool.definition;
  const two = tool.template === "axis2";
  const vertical = !two && def.vertical;
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  function fromEvent(e: ReactPointerEvent): ThinkingPointValue {
    const rect = ref.current!.getBoundingClientRect();
    const px = clamp01((e.clientX - rect.left) / rect.width);
    const py = clamp01((e.clientY - rect.top) / rect.height);
    if (two) return { x: px, y: 1 - py };
    return { v: vertical ? 1 - py : px };
  }
  function posOf(v: ThinkingPointValue): { left: string; top: string } {
    if (two)
      return {
        left: `${(v.x ?? 0) * 100}%`,
        top: `${(1 - (v.y ?? 0)) * 100}%`,
      };
    const t = (v.v ?? 0) * 100;
    return vertical
      ? { left: "50%", top: `${100 - t}%` }
      : { left: `${t}%`, top: "50%" };
  }
  const ticks =
    def.scale === "s5" ? [0.2, 0.4, 0.6, 0.8] : def.scale === "s10"
      ? [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
      : [];
  const ghostLine = [...ghosts, ...(value ? [{ value } as ThinkingPoint] : [])]
    .map((p) => posOf(p.value))
    .map((p) => `${parseFloat(p.left)},${parseFloat(p.top)}`)
    .join(" ");
  return (
    <div className="thinking-axis-wrap">
      {two && (
        <span className="thinking-axis-label thinking-axis-top">{def.yMax}</span>
      )}
      <div className="thinking-axis-mid">
        <span className="thinking-axis-label">
          {two ? def.yMin : vertical ? def.xMax : def.xMin}
        </span>
        <div
          ref={ref}
          className={`thinking-surface ${two ? "is-2d" : vertical ? "is-vertical" : "is-1d"} ${canEdit ? "is-editable" : ""}`}
          role={canEdit ? "application" : undefined}
          aria-label={def.title}
          onPointerDown={(e) => {
            if (!canEdit) return;
            e.stopPropagation();
            dragging.current = true;
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            onDragStart();
            onDraft(fromEvent(e));
          }}
          onPointerMove={(e) => {
            if (dragging.current && canEdit) onDraft(fromEvent(e));
          }}
          onPointerUp={(e) => {
            if (!dragging.current) return;
            dragging.current = false;
            if (canEdit) onCommit(fromEvent(e));
          }}
        >
          {ticks.map((t) => (
            <span
              key={`x${t}`}
              className="thinking-tick is-x"
              style={
                vertical
                  ? { bottom: `${t * 100}%` }
                  : { left: `${t * 100}%` }
              }
            />
          ))}
          {two &&
            ticks.map((t) => (
              <span
                key={`y${t}`}
                className="thinking-tick is-y"
                style={{ bottom: `${t * 100}%` }}
              />
            ))}
          {tool.template === "emotion" &&
            FACES.map((face, i) => (
              <span
                key={face}
                className="thinking-face"
                style={
                  vertical
                    ? { bottom: `${i * 25}%` }
                    : { left: `${i * 25}%` }
                }
              >
                {face}
              </span>
            ))}
          {ghosts.length > 0 && value && (
            <svg
              className="thinking-ghost-line"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polyline points={ghostLine} />
            </svg>
          )}
          {ghosts.map((p) => (
            <span
              key={p.scene}
              className="thinking-point is-ghost"
              style={posOf(p.value)}
              title={def.scenes.find((s) => s.id === p.scene)?.label ?? ""}
            />
          ))}
          {others.map((p) => (
            <span
              key={`${p.owner}:${p.scene}`}
              className="thinking-point is-other"
              style={{
                ...posOf(p.value),
                background: `hsl(${ownerHue(p.owner)} 60% 55%)`,
              }}
            >
              {labelOthers && p.authorName && (
                <span className="thinking-point-name">{p.authorName}</span>
              )}
            </span>
          ))}
          {value && (
            <button
              type="button"
              className="thinking-point is-mine"
              style={posOf(value)}
              aria-label="自分の点（矢印キーで動かせます）"
              disabled={!canEdit}
              onKeyDown={(e) => {
                if (!canEdit) return;
                const step = e.shiftKey ? 0.1 : 0.02;
                const cur = value;
                let next: ThinkingPointValue | undefined;
                if (two) {
                  const x = cur.x ?? 0;
                  const y = cur.y ?? 0;
                  if (e.key === "ArrowLeft") next = { x: clamp01(x - step), y };
                  if (e.key === "ArrowRight") next = { x: clamp01(x + step), y };
                  if (e.key === "ArrowUp") next = { x, y: clamp01(y + step) };
                  if (e.key === "ArrowDown") next = { x, y: clamp01(y - step) };
                } else {
                  const v = cur.v ?? 0;
                  if (e.key === "ArrowLeft" || e.key === "ArrowDown")
                    next = { v: clamp01(v - step) };
                  if (e.key === "ArrowRight" || e.key === "ArrowUp")
                    next = { v: clamp01(v + step) };
                }
                if (next) {
                  e.preventDefault();
                  e.stopPropagation();
                  onKeyCommit(next);
                }
              }}
            />
          )}
          {!value && canEdit && (
            <span className="thinking-hint">
              {two ? "タップして点を置こう" : "タップして気持ちを置こう"}
            </span>
          )}
        </div>
        <span className="thinking-axis-label">
          {two ? "" : vertical ? def.xMin : def.xMax}
        </span>
      </div>
      {two && (
        <div className="thinking-axis-xlabels">
          <span>{def.xMin}</span>
          <span>{def.xMax}</span>
        </div>
      )}
    </div>
  );
}

/** The two-part ratio circle （心情円）: a pie whose A share is the value,
 * adjusted by dragging around the centre or with the slider. */
function RatioSurface({
  tool,
  value,
  canEdit,
  ghosts,
  onDragStart,
  onCommit,
}: {
  tool: ThinkingView;
  value?: ThinkingPointValue;
  canEdit: boolean;
  ghosts: ThinkingPoint[];
  onDragStart: () => void;
  onCommit: (v: ThinkingPointValue) => void;
}) {
  const def = tool.definition;
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [local, setLocal] = useState<number | undefined>(undefined);
  const v = local ?? value?.v ?? 50;
  function fromEvent(e: ReactPointerEvent): ThinkingPointValue {
    const rect = ref.current!.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let angle = Math.atan2(e.clientX - cx, -(e.clientY - cy));
    if (angle < 0) angle += Math.PI * 2;
    return { v: Math.round((angle / (Math.PI * 2)) * 100) };
  }
  return (
    <div className="thinking-ratio">
      <div
        ref={ref}
        className={`thinking-pie ${canEdit ? "is-editable" : ""}`}
        style={{
          background: `conic-gradient(#e2703a 0% ${v}%, #3a7bd5 ${v}% 100%)`,
        }}
        role={canEdit ? "application" : undefined}
        aria-label={`${def.nameA}の割合`}
        onPointerDown={(e) => {
          if (!canEdit) return;
          e.stopPropagation();
          dragging.current = true;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          onDragStart();
          setLocal(fromEvent(e).v);
        }}
        onPointerMove={(e) => {
          if (dragging.current && canEdit) setLocal(fromEvent(e).v);
        }}
        onPointerUp={() => {
          if (!dragging.current) return;
          dragging.current = false;
          if (local !== undefined) onCommit({ v: local });
        }}
      >
        <span className="thinking-pie-center">{v}%</span>
      </div>
      <div
        className="thinking-ratio-side"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <p className="thinking-ratio-legend">
          <span className="thinking-swatch is-a" /> {def.nameA}：{v}%
        </p>
        <p className="thinking-ratio-legend">
          <span className="thinking-swatch is-b" /> {def.nameB}：{100 - v}%
        </p>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={v}
          disabled={!canEdit}
          aria-label={`${def.nameA}の割合`}
          onChange={(e) => setLocal(Number(e.target.value))}
          onPointerUp={() => {
            if (local !== undefined) onCommit({ v: local });
          }}
          onBlur={() => {
            if (local !== undefined) onCommit({ v: local });
          }}
        />
        {ghosts.length > 0 && (
          <p className="thinking-ratio-ghosts">
            前の場面：
            {ghosts.map((g) => (
              <span key={g.scene}>
                {def.scenes.find((s) => s.id === g.scene)?.label ?? ""}{" "}
                {g.value.v ?? 0}%{" "}
              </span>
            ))}
          </p>
        )}
        {!value && canEdit && (
          <p className="thinking-hint">円をタップするか、スライダーで割合を決めよう</p>
        )}
      </div>
    </div>
  );
}

/** Board (区切り・カード型) surface: cards written into the zones of a
 * chart. Anyone in scope may move a card; its text is edited or deleted
 * only by its author or the host, under the short editing lock (user
 * decisions, plan §4.1.2/§7). A class board is one shared board. */
function BoardSurface({
  tool,
  interactive,
}: {
  tool: ThinkingView;
  interactive: boolean;
}) {
  const ctx = useThinking();
  const groupsCtx = useGroups();
  const def = tool.definition;
  const spec = BOARD_ZONE_SPECS[tool.template] ?? [];
  const circles = VENN_CIRCLES[tool.template];
  const isXChart = tool.template === "xchart";
  const xUnderlay = isXChart && (
    <svg
      className="thinking-x"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <line x1="0" y1="0" x2="100" y2="100" vectorEffect="non-scaling-stroke" />
      <line x1="100" y1="0" x2="0" y2="100" vectorEffect="non-scaling-stroke" />
      <circle
        cx={XCHART_CENTER.x * 100}
        cy={XCHART_CENTER.y * 100}
        r={XCHART_CENTER.r * 100}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
  const boardRef = useRef<HTMLDivElement>(null);
  const [composing, setComposing] = useState("");
  const [draftText, setDraftText] = useState("");
  const [draftColor, setDraftColor] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [editColor, setEditColor] = useState("");
  const [moveZone, setMoveZone] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState("");
  // Host-only slide display state (user decision 2026-11-17): for
  // individual/group boards the host first sees one thumbnail per
  // student/group and opens one chart at a time; author names stay
  // hidden until the host explicitly turns them on. Neither changes
  // what the server returns to anyone.
  const [focusOwner, setFocusOwner] = useState("");
  const [showNames, setShowNames] = useState(false);
  const [drag, setDrag] = useState<
    { id: string; x: number; y: number } | undefined
  >(undefined);
  const dragStart = useRef<{ id: string; px: number; py: number } | undefined>(
    undefined,
  );
  // Lock expiry is time-based; re-check it once a second like points.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (tool.unit === "group" && !tool.myGroupId && !ctx.host) {
    return (
      <div className="thinking-join">
        <p>この思考ツールは班ごとに書き込みます。班に入ってください。</p>
        <div className="thinking-join-buttons">
          {groupsCtx.groups.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => void groupsCtx.command("join", { groupId: g.id })}
            >
              {g.name}に入る
            </button>
          ))}
        </div>
      </div>
    );
  }

  const inScope =
    interactive &&
    tool.status === "open" &&
    !(ctx.host && tool.unit === "group") &&
    !focusOwner;
  const canCompose =
    inScope && (tool.unit !== "group" || !!tool.myGroupId) &&
    (!ctx.host || tool.unit === "class");
  const canMove = inScope && (tool.unit !== "group" || !!tool.myGroupId || !!ctx.host);
  // On the host's slide, individual and group boards open as a
  // thumbnail list (one chart per student/group) instead of piling
  // everyone's cards into one chart (user decision 2026-11-17).
  const hostChartList = !!ctx.host && tool.unit !== "class" && !focusOwner;
  const chartOwners: { owner: string; label: string }[] =
    tool.unit === "group"
      ? groupsCtx.groups.map((g) => ({ owner: g.id, label: g.name }))
      : thinkingOwnerLabels(
          tool.cards.map((c) => c.owner),
          (owner) =>
            tool.ownerNames?.[owner] ||
            tool.cards.find((c) => c.owner === owner)?.authorName ||
            undefined,
          showNames,
          tool.roster,
        );
  const focusLabel =
    chartOwners.find((o) => o.owner === focusOwner)?.label ?? "";
  const selected = tool.cards.find((c) => c.id === selectedId);
  const lockOf = (card: ThinkingCard) =>
    tool.locks.find((l) => l.scene === card.id && l.expires > nowTick);
  const selectedLock = selected ? lockOf(selected) : undefined;
  const selectedLockedByOther = !!selectedLock && !selectedLock.mine;
  const canEditSelected =
    !!selected && (selected.mine || !!ctx.host) && !selectedLockedByOther;

  function zoneLabel(zoneId: string): string {
    return def.zones.find((z) => z.id === zoneId)?.label ?? zoneId;
  }
  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
      setNotice("");
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  async function addCard(zone: string) {
    const text = draftText.trim();
    if (!text) return;
    const result = await ctx
      .command(tool.id, "card", {
        zone,
        text,
        color: draftColor,
        ...(tool.unit === "group" ? { owner: tool.myGroupId } : {}),
      })
      .catch((e: Error) => {
        setNotice(e.message);
        return undefined;
      });
    if (result) {
      setDraftText("");
      setComposing("");
      if (result.createdId) setSelectedId(result.createdId);
    }
  }
  function beginEdit(card: ThinkingCard) {
    setEditing(true);
    setEditText(card.text);
    setEditColor(card.color);
    setConfirmDelete(false);
    void ctx.command(tool.id, "lock", { cardId: card.id }).catch(() => {});
  }
  async function saveEdit() {
    if (!selected) return;
    await run(async () => {
      await ctx.command(tool.id, "cardedit", {
        cardId: selected.id,
        text: editText,
        color: editColor,
      });
      setEditing(false);
    });
  }
  function boardPos(e: ReactPointerEvent): { x: number; y: number } {
    const rect = boardRef.current!.getBoundingClientRect();
    return {
      x: clamp01((e.clientX - rect.left) / rect.width),
      y: clamp01((e.clientY - rect.top) / rect.height),
    };
  }

  function renderCard(card: ThinkingCard) {
    const lock = lockOf(card);
    const lockedByOther = !!lock && !lock.mine;
    if (focusOwner)
      // The host's opened chart is for looking, not editing.
      return (
        <div
          key={card.id}
          className={`thinking-card is-${card.color || "none"}`}
        >
          <span className="thinking-card-text">{card.text}</span>
          {showNames && card.authorName && (
            <span className="thinking-card-author">{card.authorName}</span>
          )}
        </div>
      );
    return (
      <div
        key={card.id}
        role="button"
        tabIndex={0}
        aria-label={`カード：${card.text}`}
        className={`thinking-card is-${card.color || "none"} ${card.id === selectedId ? "is-selected" : ""} ${drag?.id === card.id ? "is-dragging" : ""} ${canMove ? "is-draggable" : ""}`}
        onClick={() => {
          setSelectedId(card.id);
          setEditing(false);
          setMoveZone(card.zone);
          setConfirmDelete(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setSelectedId(card.id);
            setMoveZone(card.zone);
          }
        }}
        onPointerDown={(e) => {
          if (!canMove) return;
          e.stopPropagation();
          dragStart.current = { id: card.id, px: e.clientX, py: e.clientY };
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const start = dragStart.current;
          if (!start || start.id !== card.id) return;
          if (
            !drag &&
            Math.hypot(e.clientX - start.px, e.clientY - start.py) < 8
          )
            return;
          setDrag({ id: card.id, ...boardPos(e) });
        }}
        onPointerUp={(e) => {
          const start = dragStart.current;
          dragStart.current = undefined;
          if (!start || start.id !== card.id) return;
          if (drag?.id === card.id) {
            const pos = boardPos(e);
            const zone = zoneAtPoint(tool.template, pos.x, pos.y);
            setDrag(undefined);
            if (zone && zone !== card.zone)
              void run(() =>
                ctx.command(tool.id, "cardmove", {
                  cardId: card.id,
                  zone,
                  x: pos.x,
                  y: pos.y,
                }),
              );
          }
        }}
      >
        <span className="thinking-card-text">{card.text}</span>
        {/* Author names on a slide only when the host turned them on
          (user decision 2026-11-17): the host's screen is what gets
          projected to the class, so the default is no names. */}
        {showNames && ctx.host && card.authorName && (
          <span className="thinking-card-author">{card.authorName}</span>
        )}
        {lockedByOther && (
          <span className="thinking-card-lock">ほかの人が編集中です</span>
        )}
      </div>
    );
  }

  function composeForm(zone: string) {
    return (
      <div
        className="thinking-compose"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <textarea
          aria-label="カードの内容"
          value={draftText}
          maxLength={80}
          rows={2}
          autoFocus
          placeholder="カードに書くこと"
          onChange={(e) => setDraftText(e.target.value)}
        />
        {def.cardColors.length > 0 && (
          <select
            aria-label="カードの色"
            value={draftColor}
            onChange={(e) => setDraftColor(e.target.value)}
          >
            <option value="">色なし</option>
            {def.cardColors.map((c) => (
              <option key={c.color} value={c.color}>
                {c.label || c.color}
              </option>
            ))}
          </select>
        )}
        <div className="thinking-compose-actions">
          <button
            type="button"
            disabled={!draftText.trim()}
            onClick={() => void addCard(zone)}
          >
            追加する
          </button>
          <button type="button" onClick={() => setComposing("")}>
            やめる
          </button>
        </div>
      </div>
    );
  }

  const cardsIn = (zone: string) =>
    tool.cards
      .filter((c) => !focusOwner || c.owner === focusOwner)
      .filter((c) => c.zone === zone)
      .sort((a, b) => a.sort - b.sort || a.created - b.created);

  const renderThumbs = () => (
    <div className="thinking-thumbs">
      {chartOwners.map(({ owner, label }) => {
        const own = tool.cards.filter((c) => c.owner === owner);
        return (
          <button
            type="button"
            key={owner}
            className="thinking-thumb"
            onClick={() => setFocusOwner(owner)}
          >
            <ThinkingThumbBoard template={tool.template} cards={own} />
            <span className="thinking-thumb-label">
              {label}（{own.length}枚）
            </span>
          </button>
        );
      })}
      {chartOwners.length === 0 && (
        <p className="thinking-zone-empty">まだカードがありません。</p>
      )}
    </div>
  );

  return (
    <div className="thinking-body">
      {def.cardColors.length > 0 && (
        <div className="thinking-color-legend" aria-label="カードの色の意味">
          {def.cardColors.map((c) => (
            <span key={c.color} className="thinking-color-legend-item">
              <span className={`thinking-color-dot is-${c.color}`} />
              {c.label}
            </span>
          ))}
        </div>
      )}
      {ctx.host && interactive && (
        <div className="thinking-hostbar">
          {focusOwner && (
            <button type="button" onClick={() => setFocusOwner("")}>
              ← 一覧に戻る
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowNames((v) => !v)}
          >
            {showNames ? "名前を隠す" : "名前を出す"}
          </button>
          {focusOwner && (
            <span className="thinking-focus-label">{focusLabel}の図</span>
          )}
        </div>
      )}
      {hostChartList ? (
        renderThumbs()
      ) : (
      <div ref={boardRef} className="thinking-board">
        {xUnderlay}
        {isXChart && (
          <div className="thinking-x-topic" aria-hidden="true">
            <span>{def.title}</span>
          </div>
        )}
        {circles && (
          <svg
            className="thinking-venn"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {circles.map((c, i) => (
              <circle
                key={i}
                cx={c.x * 100}
                cy={c.y * 100}
                r={c.r * 100}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
        )}
        {spec.map((zoneSpec) => {
          const label = zoneLabel(zoneSpec.id);
          const zoneCards = cardsIn(zoneSpec.id);
          const inner = (
            <>
              <span className="thinking-zone-label">{label}</span>
              <div className="thinking-zone-cards">
                {zoneCards.map(renderCard)}
                {composing === zoneSpec.id
                  ? composeForm(zoneSpec.id)
                  : canCompose && (
                      <button
                        type="button"
                        className="thinking-add-card"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => {
                          setComposing(zoneSpec.id);
                          setDraftText("");
                          setDraftColor("");
                        }}
                      >
                        ＋カードを書く
                      </button>
                    )}
              </div>
            </>
          );
          return zoneSpec.rect ? (
            <div
              key={zoneSpec.id}
              className={`thinking-zone${zoneSpec.wedge ? " is-wedge" : ""}`}
              style={{
                left: `${zoneSpec.rect[0] * 100}%`,
                top: `${zoneSpec.rect[1] * 100}%`,
                width: `${zoneSpec.rect[2] * 100}%`,
                height: `${zoneSpec.rect[3] * 100}%`,
              }}
            >
              {inner}
            </div>
          ) : (
            <div
              key={zoneSpec.id}
              className="thinking-zone is-anchor"
              style={{
                left: `${zoneSpec.anchor[0] * 100}%`,
                top: `${zoneSpec.anchor[1] * 100}%`,
              }}
            >
              {inner}
            </div>
          );
        })}
        {drag && (
          <div
            className="thinking-card is-drag-ghost"
            style={{
              left: `${drag.x * 100}%`,
              top: `${drag.y * 100}%`,
            }}
          >
            <span className="thinking-card-text">
              {tool.cards.find((c) => c.id === drag.id)?.text}
            </span>
          </div>
        )}
      </div>
      )}
      {notice && <p className="thinking-lock-note">{notice}</p>}
      {selected && (
        <div
          className="thinking-card-panel"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {editing ? (
            <>
              <textarea
                aria-label="カードの内容を変える"
                value={editText}
                maxLength={80}
                rows={2}
                autoFocus
                onChange={(e) => setEditText(e.target.value)}
              />
              {def.cardColors.length > 0 && (
                <select
                  aria-label="カードの色"
                  value={editColor}
                  onChange={(e) => setEditColor(e.target.value)}
                >
                  <option value="">色なし</option>
                  {def.cardColors.map((c) => (
                    <option key={c.color} value={c.color}>
                      {c.label || c.color}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                disabled={!editText.trim()}
                onClick={() => void saveEdit()}
              >
                保存する
              </button>
              <button type="button" onClick={() => setEditing(false)}>
                やめる
              </button>
            </>
          ) : (
            <>
              <span className="thinking-card-panel-zone">
                {zoneLabel(selected.zone)}
              </span>
              {canMove && def.zones.length > 1 && (
                <label>
                  区切りを移す
                  <select
                    aria-label="移す先の区切り"
                    value={moveZone}
                    onChange={(e) => setMoveZone(e.target.value)}
                  >
                    {def.zones.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {canMove && moveZone !== selected.zone && (
                <button
                  type="button"
                  onClick={() =>
                    void run(() =>
                      ctx.command(tool.id, "cardmove", {
                        cardId: selected.id,
                        zone: moveZone,
                      }),
                    )
                  }
                >
                  移す
                </button>
              )}
              {canEditSelected && (
                <button type="button" onClick={() => beginEdit(selected)}>
                  内容を変える
                </button>
              )}
              {canEditSelected &&
                (confirmDelete ? (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        void run(async () => {
                          await ctx.command(tool.id, "carddelete", {
                            cardId: selected.id,
                          });
                          setSelectedId("");
                          setConfirmDelete(false);
                        })
                      }
                    >
                      本当に削除する
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                    >
                      やめる
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                  >
                    削除
                  </button>
                ))}
              {selectedLockedByOther && (
                <span className="thinking-lock-note">
                  ほかの人が編集中です
                </span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
