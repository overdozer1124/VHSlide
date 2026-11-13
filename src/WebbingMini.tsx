import { WEBBING_H, WEBBING_W, type WebbingNode } from "./webbing";

/** Read-only miniature of a webbing map: connecting lines plus a
 * labelled dot per node, laid out over the shared 960x540 stage.
 * `large` raises the label size for enlarged / projected views. */
export function WebbingMini({
  nodes,
  large,
}: {
  nodes: WebbingNode[];
  large?: boolean;
}) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (
    <div
      className={`console-webbing-mini ${large ? "is-large" : ""}`}
      aria-hidden="true"
    >
      <svg viewBox={`0 0 ${WEBBING_W} ${WEBBING_H}`}>
        {nodes
          .filter((n) => n.parentId)
          .map((n) => {
            const parent = byId.get(n.parentId!);
            if (!parent) return null;
            return (
              <line
                key={n.id}
                x1={parent.x}
                y1={parent.y}
                x2={n.x}
                y2={n.y}
                stroke="#b9cdbd"
                strokeWidth={3}
              />
            );
          })}
      </svg>
      {nodes.map((n) => (
        <span
          key={n.id}
          className={`console-webbing-dot ${n.parentId === null ? "is-root" : ""}`}
          style={{
            left: `${(n.x / WEBBING_W) * 100}%`,
            top: `${(n.y / WEBBING_H) * 100}%`,
          }}
          title={n.text}
        >
          {n.text}
        </span>
      ))}
    </div>
  );
}
