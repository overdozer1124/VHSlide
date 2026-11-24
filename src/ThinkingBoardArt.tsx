import { BOARD_ZONE_SPECS } from "./thinkingTools";
import type { ThinkingTemplate } from "./thinkingTools";

/** The line work of the stage-4 remaining board templates
 * (fishbone, butterfly, jellyfish, pyramid, rake), drawn in the
 * same 0..100 space as the venn circles and the X chart. Shared by
 * the slide surface, the thumbnails and the picker preview so the
 * three never drift apart. The cards' boxes stay upright even on
 * the fishbone; only these lines lean. */
export function ThinkingBoardArtShapes({
  template,
}: {
  template: ThinkingTemplate;
}) {
  const ve = { vectorEffect: "non-scaling-stroke" as const };
  if (template === "fishbone") {
    return (
      <g className="tb-art">
        <line x1="2" y1="50" x2="80" y2="50" {...ve} />
        <line x1="22" y1="50" x2="12" y2="10" {...ve} />
        <line x1="22" y1="50" x2="12" y2="90" {...ve} />
        <line x1="56" y1="50" x2="46" y2="10" {...ve} />
        <line x1="56" y1="50" x2="46" y2="90" {...ve} />
        <ellipse cx="89" cy="50" rx="10" ry="17" {...ve} />
      </g>
    );
  }
  if (template === "butterfly2" || template === "butterfly4") {
    const wings =
      template === "butterfly2"
        ? [
            [23, 50, 19, 38],
            [77, 50, 19, 38],
          ]
        : [
            [23, 26, 19, 21],
            [23, 74, 19, 21],
            [77, 26, 19, 21],
            [77, 74, 19, 21],
          ];
    return (
      <g className="tb-art">
        {wings.map(([cx, cy, rx, ry], i) => (
          <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} {...ve} />
        ))}
        <ellipse cx="50" cy="50" rx="5.5" ry={template === "butterfly2" ? 30 : 32} {...ve} />
      </g>
    );
  }
  if (template === "jellyfish") {
    return (
      <g className="tb-art">
        <path d="M6 40 A44 34 0 0 1 94 40" fill="none" {...ve} />
        {[13.25, 37.75, 62.25, 86.75].map((x) => (
          <path
            key={x}
            d={`M${x} 42 q3.5 13 0 27 q-3.5 13 0 26`}
            fill="none"
            {...ve}
          />
        ))}
      </g>
    );
  }
  if (template === "pyramid3" || template === "pyramid4") {
    const rects = (BOARD_ZONE_SPECS[template] ?? [])
      .map((z) => z.rect!)
      .filter(Boolean);
    if (rects.length === 0) return null;
    const top = rects[0];
    const bottom = rects[rects.length - 1];
    const yTop = top[1] * 100;
    const yBottom = (bottom[1] + bottom[3]) * 100;
    const xLeftAt = (y: number) =>
      top[0] * 100 +
      ((bottom[0] * 100 - top[0] * 100) * (y - yTop)) / (yBottom - yTop);
    const xRightAt = (y: number) =>
      (top[0] + top[2]) * 100 +
      (((bottom[0] + bottom[2]) * 100 - (top[0] + top[2]) * 100) *
        (y - yTop)) /
        (yBottom - yTop);
    return (
      <g className="tb-art">
        <line x1={xLeftAt(yTop)} y1={yTop} x2={xLeftAt(yBottom)} y2={yBottom} {...ve} />
        <line x1={xRightAt(yTop)} y1={yTop} x2={xRightAt(yBottom)} y2={yBottom} {...ve} />
        <line x1={xLeftAt(yTop)} y1={yTop} x2={xRightAt(yTop)} y2={yTop} {...ve} />
        <line x1={xLeftAt(yBottom)} y1={yBottom} x2={xRightAt(yBottom)} y2={yBottom} {...ve} />
        {rects.slice(1).map((r, i) => {
          const y = r[1] * 100;
          return (
            <line key={i} x1={xLeftAt(y)} y1={y} x2={xRightAt(y)} y2={y} {...ve} />
          );
        })}
      </g>
    );
  }
  if (template === "kumade") {
    return (
      <g className="tb-art">
        <rect x="2" y="5" width="96" height="15" rx="4" {...ve} />
        {[10, 30, 50, 70, 90].map((x) => (
          <line key={x} x1={x} y1="20" x2={x} y2="96" {...ve} />
        ))}
      </g>
    );
  }
  return null;
}

export function ThinkingBoardArt({
  template,
}: {
  template: ThinkingTemplate;
}) {
  return (
    <svg
      className="thinking-board-art"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <ThinkingBoardArtShapes template={template} />
    </svg>
  );
}

/** Where the tool's title is drawn inside the figure (the fishbone's
 * head, the butterfly's body, the jellyfish's dome, the rake's
 * handle), in 0..1 fractions of the board. The pyramid has no room
 * for it, so its title stays above the board as usual. Long titles
 * wrap and are then cut off (design review 🟡). */
export const FIGURE_TITLE_BOX: Partial<
  Record<
    ThinkingTemplate,
    { left: number; top: number; width: number; height: number; vertical?: boolean }
  >
> = {
  fishbone: { left: 0.795, top: 0.335, width: 0.195, height: 0.33 },
  butterfly2: { left: 0.447, top: 0.2, width: 0.106, height: 0.6, vertical: true },
  butterfly4: { left: 0.447, top: 0.2, width: 0.106, height: 0.6, vertical: true },
  jellyfish: { left: 0.18, top: 0.07, width: 0.64, height: 0.26 },
  kumade: { left: 0.04, top: 0.055, width: 0.92, height: 0.135 },
};

export function ThinkingFigureTitle({
  template,
  title,
}: {
  template: ThinkingTemplate;
  title: string;
}) {
  const box = FIGURE_TITLE_BOX[template];
  if (!box) return null;
  return (
    <div
      className={`thinking-figure-title${box.vertical ? " is-vertical" : ""}`}
      style={{
        left: `${box.left * 100}%`,
        top: `${box.top * 100}%`,
        width: `${box.width * 100}%`,
        height: `${box.height * 100}%`,
      }}
      aria-hidden="true"
    >
      <span>{title}</span>
    </div>
  );
}
