import { useEffect, useMemo, useState } from "react";
import type {
  ThinkingPoint,
  ThinkingPointValue,
  ThinkingView,
} from "./thinkingTools";
import { useGroups } from "./GroupsContext";

function ownerHue(owner: string): number {
  let h = 0;
  for (let i = 0; i < owner.length; i++) h = (h * 31 + owner.charCodeAt(i)) % 360;
  return h;
}
const pct = (n: number) => `${Math.round(n * 100)}%`;

export function valueText(tool: ThinkingView, v: ThinkingPointValue): string {
  if (tool.template === "axis2")
    return `横 ${pct(v.x ?? 0)}・縦 ${pct(v.y ?? 0)}`;
  if (tool.template === "ratio")
    return `${tool.definition.nameA} ${v.v ?? 0}%`;
  return pct(v.v ?? 0);
}

/** Host results for one thinking tool: the class distribution per scene
 * (with a playback of how points moved), one respondent's trajectory,
 * and a CSV export. Points arrive host-filtered from the server. */
export function ThinkingResults({ tool }: { tool: ThinkingView }) {
  const groupsCtx = useGroups();
  const def = tool.definition;
  const scenes = def.scenes.length
    ? def.scenes
    : [{ id: "", label: "点の位置" }];
  const [sceneIdx, setSceneIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [owner, setOwner] = useState("");
  const scene = scenes[Math.min(sceneIdx, scenes.length - 1)];

  const nameOf = (p: ThinkingPoint): string => {
    if (tool.unit === "class") return "全体";
    if (tool.unit === "group")
      return (
        groupsCtx.groups.find((g) => g.id === p.owner)?.name || p.authorName
      );
    return p.authorName;
  };
  const owners = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of tool.points)
      if (!seen.has(p.owner)) seen.set(p.owner, nameOf(p));
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool.points, tool.unit, groupsCtx.groups]);

  useEffect(() => {
    if (!playing) return;
    if (sceneIdx >= scenes.length - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setSceneIdx((i) => i + 1), 1400);
    return () => clearTimeout(t);
  }, [playing, sceneIdx, scenes.length]);

  const inScene = tool.points.filter((p) => p.scene === scene.id);
  const trailOwners = playing || sceneIdx > 0 ? owners : [];
  function posOf(v: ThinkingPointValue): { left: string; top: string } {
    if (tool.template === "axis2")
      return {
        left: `${(v.x ?? 0) * 100}%`,
        top: `${(1 - (v.y ?? 0)) * 100}%`,
      };
    const t = (v.v ?? 0) * 100;
    return def.vertical
      ? { left: "50%", top: `${100 - t}%` }
      : { left: `${t}%`, top: "50%" };
  }
  function trailPoints(ownerId: string): string {
    return scenes
      .slice(0, sceneIdx + 1)
      .map((s) => tool.points.find((p) => p.owner === ownerId && p.scene === s.id))
      .filter((p): p is ThinkingPoint => !!p)
      .map((p) => {
        const pos = posOf(p.value);
        return `${parseFloat(pos.left)},${parseFloat(pos.top)}`;
      })
      .join(" ");
  }

  function downloadCsv() {
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const lines = [["名前", "場面", "値", "理由"].join(",")];
    for (const p of tool.points) {
      const label =
        def.scenes.find((s) => s.id === p.scene)?.label ?? p.scene;
      lines.push(
        [esc(nameOf(p)), esc(label), esc(valueText(tool, p.value)), esc(p.reason)].join(","),
      );
    }
    const blob = new Blob(["\ufeff" + lines.join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${def.title || "思考ツール"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const trajectory = owner
    ? scenes
        .map((s) => ({
          scene: s,
          point: tool.points.find((p) => p.owner === owner && p.scene === s.id),
        }))
        .filter((row) => row.point)
    : [];

  return (
    <div className="thinking-results">
      <div className="thinking-results-head">
        <div
          className="thinking-scenes"
          role="tablist"
          aria-label="結果の場面"
        >
          {scenes.map((s, i) => (
            <button
              key={s.id || "only"}
              type="button"
              role="tab"
              aria-selected={i === sceneIdx}
              className={i === sceneIdx ? "is-active" : ""}
              onClick={() => {
                setPlaying(false);
                setSceneIdx(i);
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
        {def.scenes.length > 1 && (
          <button
            type="button"
            onClick={() => {
              if (!playing) setSceneIdx(0);
              setPlaying(!playing);
            }}
          >
            {playing ? "止める" : "再生（場面ごとの動き）"}
          </button>
        )}
        <button type="button" onClick={downloadCsv}>
          CSVで保存
        </button>
        <span className="thinking-results-count">
          {inScene.length}件の点
        </span>
      </div>
      {tool.template === "ratio" ? (
        <ul className="thinking-ratio-results">
          {inScene.map((p) => (
            <li key={p.owner}>
              <span className="thinking-ratio-name">{nameOf(p)}</span>
              <span className="thinking-ratio-bar">
                <span
                  className="thinking-ratio-fill"
                  style={{ width: `${p.value.v ?? 0}%` }}
                />
              </span>
              <span>
                {def.nameA} {p.value.v ?? 0}%
              </span>
              {p.reason && <span className="thinking-ratio-reason">{p.reason}</span>}
            </li>
          ))}
          {inScene.length === 0 && <li>この場面の点はまだありません。</li>}
        </ul>
      ) : (
        <div
          className="thinking-surface thinking-results-surface"
          aria-label={`${scene.label}の分布`}
        >
          {trailOwners.map((o) => {
            const pts = trailPoints(o.id);
            if (!pts.includes(" ")) return null;
            return (
              <svg
                key={o.id}
                className="thinking-ghost-line"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <polyline
                  points={pts}
                  style={{ stroke: `hsl(${ownerHue(o.id)} 60% 45%)` }}
                />
              </svg>
            );
          })}
          {inScene.map((p) => (
            <span
              key={p.owner}
              className="thinking-point is-other"
              style={{
                ...posOf(p.value),
                background: `hsl(${ownerHue(p.owner)} 60% 50%)`,
              }}
              title={`${nameOf(p)}：${valueText(tool, p.value)}${p.reason ? `（${p.reason}）` : ""}`}
            />
          ))}
          {inScene.length === 0 && (
            <span className="thinking-hint">この場面の点はまだありません</span>
          )}
        </div>
      )}
      <div className="thinking-trajectory">
        <label>
          1人（1班）の軌跡
          <select
            aria-label="軌跡を見る相手"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
          >
            <option value="">選んでください</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        {owner && (
          <ol className="thinking-trajectory-list">
            {trajectory.map((row) => (
              <li key={row.scene.id || "only"}>
                <strong>{row.scene.label}</strong>：
                {valueText(tool, row.point!.value)}
                {row.point!.reason && <span>（{row.point!.reason}）</span>}
              </li>
            ))}
            {trajectory.length === 0 && <li>まだ点がありません。</li>}
          </ol>
        )}
      </div>
    </div>
  );
}
