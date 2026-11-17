import { useEffect, useMemo, useState } from "react";
import type {
  ThinkingCard,
  ThinkingPoint,
  ThinkingPointValue,
  ThinkingView,
} from "./thinkingTools";
import {
  BOARD_ZONE_SPECS,
  VENN_CIRCLES,
  XCHART_CENTER,
  thinkingOwnerLabels,
} from "./thinkingTools";
import { useGroups } from "./GroupsContext";
import { csvCell } from "./surveyCsv";
import { ThinkingThumbBoard } from "./ThinkingThumbBoard";

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

export function ThinkingResults({ tool }: { tool: ThinkingView }) {
  if (tool.kind === "board") return <BoardResults tool={tool} />;
  return <PointResults tool={tool} />;
}

/** Host results for a board tool: every card gathered per zone
 * （区切りごとの集約）, with the author/group for each card and a CSV
 * export. Cards arrive host-filtered from the server. */
function BoardResults({ tool }: { tool: ThinkingView }) {
  const groupsCtx = useGroups();
  const def = tool.definition;
  const [zoneFilter, setZoneFilter] = useState("");
  const [view, setView] = useState<"zone" | "charts">("zone");
  const [showNames, setShowNames] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const nameOfCard = (c: ThinkingCard): string => {
    if (tool.unit === "group")
      return (
        groupsCtx.groups.find((g) => g.id === c.owner)?.name || c.authorName
      );
    if (tool.unit === "class") return c.authorName;
    return c.authorName;
  };
  const colorLabel = (color: string): string =>
    def.cardColors.find((c) => c.color === color)?.label ?? "";
  function downloadCsv() {
    const lines = [
      ["名前・班", "区切り", "カード", "色の意味"].map(csvCell).join(","),
    ];
    for (const z of def.zones)
      for (const c of tool.cards.filter((x) => x.zone === z.id))
        lines.push(
          [nameOfCard(c), z.label, c.text, colorLabel(c.color)]
            .map(csvCell)
            .join(","),
        );
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
  const zones = zoneFilter
    ? def.zones.filter((z) => z.id === zoneFilter)
    : def.zones;
  // The chart gallery: one miniature per student (or group). Names
  // follow the teacher-slide rule — pseudonyms until the host asks
  // for names; group names are not personal and always show. A class
  // tool has a single shared chart.
  const owners = [...new Set(tool.cards.map((c) => c.owner))];
  const nameOfOwner = (owner: string): string | undefined =>
    tool.unit === "group"
      ? groupsCtx.groups.find((g) => g.id === owner)?.name
      : tool.cards.find((c) => c.owner === owner)?.authorName;
  const chartOwners: { owner: string; label: string }[] =
    tool.unit === "class"
      ? [{ owner: "", label: "全員" }]
      : thinkingOwnerLabels(
          owners,
          nameOfOwner,
          tool.unit === "group" || showNames,
        );
  const chartsLabel =
    tool.unit === "group"
      ? "班ごと"
      : tool.unit === "class"
        ? "全員のチャート"
        : "生徒ごと";
  const expandedOwner = chartOwners.find((o) => o.owner === expanded);
  return (
    <div className="thinking-results">
      <div className="thinking-results-head">
        <div className="thinking-scenes" role="tablist" aria-label="見方">
          <button
            type="button"
            role="tab"
            aria-selected={view === "zone"}
            className={view === "zone" ? "is-active" : ""}
            onClick={() => setView("zone")}
          >
            区切りごと
          </button>
          {tool.unit !== "class" && (
            <button
              type="button"
              role="tab"
              aria-selected={view === "charts"}
              className={view === "charts" ? "is-active" : ""}
              onClick={() => setView("charts")}
            >
              {chartsLabel}
            </button>
          )}
        </div>
        {view === "charts" && tool.unit === "individual" && (
          <button
            type="button"
            aria-pressed={showNames}
            onClick={() => setShowNames(!showNames)}
          >
            {showNames ? "名前を隠す" : "名前を出す"}
          </button>
        )}
        <button type="button" onClick={downloadCsv}>
          CSVで保存
        </button>
        <span className="thinking-results-count">
          カード{tool.cards.length}枚
        </span>
      </div>
      {view === "zone" && (
        <>
          <div className="thinking-results-head">
            <div className="thinking-scenes" role="tablist" aria-label="区切り">
              <button
                type="button"
                role="tab"
                aria-selected={zoneFilter === ""}
                className={zoneFilter === "" ? "is-active" : ""}
                onClick={() => setZoneFilter("")}
              >
                すべての区切り
              </button>
              {def.zones.map((z) => (
                <button
                  key={z.id}
                  type="button"
                  role="tab"
                  aria-selected={zoneFilter === z.id}
                  className={zoneFilter === z.id ? "is-active" : ""}
                  onClick={() => setZoneFilter(z.id)}
                >
                  {z.label}（{tool.cards.filter((c) => c.zone === z.id).length}）
                </button>
              ))}
            </div>
          </div>
          {zones.map((z) => {
            const cards = tool.cards
              .filter((c) => c.zone === z.id)
              .sort((a, b) => a.sort - b.sort || a.created - b.created);
            return (
              <div key={z.id} className="thinking-zone-results">
                <h4>
                  {z.label}
                  <span className="thinking-zone-count">{cards.length}枚</span>
                </h4>
                {cards.length === 0 ? (
                  <p className="thinking-zone-empty">まだカードがありません。</p>
                ) : (
                  <ul className="thinking-zone-card-list">
                    {cards.map((c) => (
                      <li key={c.id} className={`is-${c.color || "none"}`}>
                        <span className="thinking-zone-card-text">{c.text}</span>
                        <span className="thinking-zone-card-name">
                          {nameOfCard(c)}
                          {colorLabel(c.color) ? ` · ${colorLabel(c.color)}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </>
      )}
      {view === "charts" && (
        <div className="thinking-gallery">
          <div className="thinking-thumbs">
            {chartOwners.map(({ owner, label }) => {
              const own = tool.cards.filter((c) => c.owner === owner);
              return (
                <button
                  type="button"
                  key={owner || "all"}
                  className={`thinking-thumb${expanded === owner ? " is-active" : ""}`}
                  aria-expanded={expanded === owner}
                  onClick={() =>
                    setExpanded(expanded === owner ? null : owner)
                  }
                >
                  <ThinkingThumbBoard template={tool.template} cards={own} />
                  <span className="thinking-thumb-label">
                    {label}（{own.length}枚）
                  </span>
                </button>
              );
            })}
          </div>
          {chartOwners.length === 0 && (
            <p className="thinking-zone-empty">まだカードがありません。</p>
          )}
          {expandedOwner && (
            <ExpandedChart
              tool={tool}
              cards={tool.cards.filter((c) => c.owner === expandedOwner.owner)}
              label={expandedOwner.label}
              colorLabel={colorLabel}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** One student's (or group's) chart, enlarged and read-only, in the
 * results gallery: the real board shape with the card texts in their
 * zones. */
function ExpandedChart({
  tool,
  cards,
  label,
  colorLabel,
}: {
  tool: ThinkingView;
  cards: ThinkingCard[];
  label: string;
  colorLabel: (color: string) => string;
}) {
  const def = tool.definition;
  const spec = BOARD_ZONE_SPECS[tool.template] ?? [];
  const circles = VENN_CIRCLES[tool.template];
  const zoneLabel = (id: string) =>
    def.zones.find((z) => z.id === id)?.label ?? "";
  return (
    <div className="thinking-gallery-expanded">
      <h4>{label}のチャート</h4>
      <div className="thinking-board thinking-gallery-board">
        {tool.template === "xchart" && (
          <>
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
            <div className="thinking-x-topic" aria-hidden="true">
              <span>{def.title}</span>
            </div>
          </>
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
          const zoneCards = cards
            .filter((c) => c.zone === zoneSpec.id)
            .sort((a, b) => a.sort - b.sort || a.created - b.created);
          const inner = (
            <>
              <span className="thinking-zone-label">
                {zoneLabel(zoneSpec.id)}
              </span>
              <div className="thinking-zone-cards">
                {zoneCards.map((c) => (
                  <div
                    key={c.id}
                    className={`thinking-card is-${c.color || "none"}`}
                  >
                    <span className="thinking-card-text">{c.text}</span>
                    {colorLabel(c.color) && (
                      <span className="thinking-card-note">
                        {colorLabel(c.color)}
                      </span>
                    )}
                  </div>
                ))}
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
      </div>
    </div>
  );
}

/** Host results for one point tool: the class distribution per scene
 * (with a playback of how points moved), one respondent's trajectory,
 * and a CSV export. Points arrive host-filtered from the server. */
function PointResults({ tool }: { tool: ThinkingView }) {
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
    const lines = [["名前", "場面", "値", "理由"].map(csvCell).join(",")];
    for (const p of tool.points) {
      const label =
        def.scenes.find((s) => s.id === p.scene)?.label ?? p.scene;
      lines.push(
        [nameOf(p), label, valueText(tool, p.value), p.reason]
          .map(csvCell)
          .join(","),
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
