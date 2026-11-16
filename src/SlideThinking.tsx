import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Element } from "./model";
import { useThinking } from "./ThinkingContext";
import { useGroups } from "./GroupsContext";
import type {
  ThinkingPoint,
  ThinkingPointValue,
  ThinkingView,
} from "./thinkingTools";
import { canDragForm } from "./formDrag";

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
        <ThinkingSurface tool={tool} interactive={!!props.interactive} />
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
    tool.unit === "individual"
      ? (ctx.userId ?? "")
      : tool.unit === "group"
        ? (tool.myGroupId ?? "")
        : "";
  const [sceneSel, setSceneSel] = useState<string | undefined>(undefined);
  const scene =
    def.scenes.length === 0
      ? ""
      : def.sceneMode === "teacher"
        ? tool.scene || (def.scenes[0]?.id ?? "")
        : (sceneSel ?? tool.scene ?? def.scenes[0]?.id ?? "");
  const myPoints = tool.points.filter((p) => p.owner === myOwner);
  const myPoint = myPoints.find((p) => p.scene === scene);
  const lock = tool.locks.find((l) => l.owner === myOwner && l.scene === scene);
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
  }, [scene, tool.id]);
  useEffect(() => {
    if (draft && myPoint && JSON.stringify(myPoint.value) === JSON.stringify(draft))
      setDraft(undefined);
  }, [myPoint, draft]);

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
    } catch {
      setDraft(undefined);
    }
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

  const others =
    ctx.host && tool.unit !== "class"
      ? tool.points.filter((p) => p.scene === scene && p.owner !== myOwner)
      : [];
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
      {tool.template === "ratio" ? (
        <RatioSurface
          key={scene}
          tool={tool}
          value={shownValue}
          canEdit={canEdit}
          ghosts={ghosts}
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
          onDraft={setDraft}
          onCommit={(v) => void commit(v)}
        />
      )}
      {lockedByOther && (
        <p className="thinking-lock-note">{lock.name}さんが編集中です</p>
      )}
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

/** Axes (axis2), one axis (axis1) and the emotion meter share one surface:
 * a point placed by tap/drag, arrow keys, with ghost points from the
 * other scenes joined by a line. */
function AxisSurface({
  tool,
  value,
  canEdit,
  ghosts,
  others,
  onDraft,
  onCommit,
}: {
  tool: ThinkingView;
  value?: ThinkingPointValue;
  canEdit: boolean;
  ghosts: ThinkingPoint[];
  others: ThinkingPoint[];
  onDraft: (v: ThinkingPointValue) => void;
  onCommit: (v: ThinkingPointValue) => void;
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
            />
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
                  onDraft(next);
                  onCommit(next);
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
  onCommit,
}: {
  tool: ThinkingView;
  value?: ThinkingPointValue;
  canEdit: boolean;
  ghosts: ThinkingPoint[];
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
