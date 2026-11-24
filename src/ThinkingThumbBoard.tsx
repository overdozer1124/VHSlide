import { ThinkingWebbingMini } from "./ThinkingWebbing";
import {
  BOARD_ZONE_SPECS,
  VENN_CIRCLES,
  XCHART_CENTER,
} from "./thinkingTools";
import type {
  ThinkingCard,
  ThinkingNode,
  ThinkingTemplate,
} from "./thinkingTools";

/** The miniature of one chart (one student's or group's board): the
 * template's shape with a dot for each of the given cards in its
 * zone. Shared by the host slide's chart thumbnails and the results
 * screen's per-student chart gallery, so the two never drift apart. */
export function ThinkingThumbBoard({
  template,
  cards,
  nodes,
  title,
}: {
  template: ThinkingTemplate;
  cards: ThinkingCard[];
  /** Personal webbing (flow): the chart's nodes and centre title. */
  nodes?: ThinkingNode[];
  title?: string;
}) {
  if (template === "webbing") {
    return (
      <ThinkingWebbingMini
        title={title ?? ""}
        nodes={(nodes ?? []).map((n) => ({
          key: n.id,
          parent: n.parent,
          text: n.text,
          x: n.x,
          y: n.y,
        }))}
      />
    );
  }
  const spec = BOARD_ZONE_SPECS[template] ?? [];
  const circles = VENN_CIRCLES[template];
  if (template === "steps") {
    const ordered = [...cards].sort(
      (a, b) => a.sort - b.sort || a.created - b.created,
    );
    return (
      <span className="thinking-thumb-board is-steps" aria-hidden="true">
        {ordered.slice(0, 6).map((c, i) => (
          <span key={c.id} className="thinking-thumb-step">
            {i + 1}
          </span>
        ))}
        {ordered.length > 6 && (
          <span className="thinking-thumb-step is-more">
            +{ordered.length - 6}
          </span>
        )}
        {ordered.length === 0 && (
          <span className="thinking-thumb-step is-empty">0</span>
        )}
      </span>
    );
  }
  return (
    <span className="thinking-thumb-board">
      {template === "xchart" && (
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
      {spec.map((zoneSpec) => (
        <span
          key={zoneSpec.id}
          className={`thinking-thumb-zone${zoneSpec.wedge ? " is-wedge" : zoneSpec.rect ? "" : " is-anchor"}`}
          style={
            zoneSpec.rect
              ? {
                  left: `${zoneSpec.rect[0] * 100}%`,
                  top: `${zoneSpec.rect[1] * 100}%`,
                  width: `${zoneSpec.rect[2] * 100}%`,
                  height: `${zoneSpec.rect[3] * 100}%`,
                }
              : {
                  left: `${(zoneSpec.anchor?.[0] ?? 0.5) * 100}%`,
                  top: `${(zoneSpec.anchor?.[1] ?? 0.5) * 100}%`,
                }
          }
        >
          {cards
            .filter((c) => c.zone === zoneSpec.id)
            .map((c) => (
              <span
                key={c.id}
                className={`thinking-thumb-card is-${c.color || "none"}`}
              />
            ))}
        </span>
      ))}
    </span>
  );
}
