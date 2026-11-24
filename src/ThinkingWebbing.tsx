/** Read-only rendering of one student's (or group's) personal
 * webbing (stage 4, flow tools): the centre is the tool's title —
 * drawn, never stored as a node — and every node hangs off it or
 * off another node. Positions are fractions of the 960x540 stage,
 * the same space the slide webbing map uses. Used by the results
 * thumbnails, the enlarged chart and the shared (4c) view. */
export type WebbingChartNode = {
  key: string;
  parent: string | null;
  text: string;
  x: number;
  y: number;
};

export function ThinkingWebbingMini({
  title,
  nodes,
  large,
}: {
  title: string;
  nodes: WebbingChartNode[];
  large?: boolean;
}) {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const centre = { x: 0.5, y: 0.5 };
  const posOf = (n: WebbingChartNode) =>
    n.parent == null
      ? centre
      : (byKey.get(n.parent) ?? centre);
  return (
    <div
      className={`thinking-webbing-mini ${large ? "is-large" : ""}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 960 540">
        {nodes.map((n) => {
          const a = posOf(n);
          return (
            <line
              key={n.key}
              x1={a.x * 960}
              y1={a.y * 540}
              x2={n.x * 960}
              y2={n.y * 540}
              stroke="#b9cdbd"
              strokeWidth={3}
            />
          );
        })}
      </svg>
      <span
        className="thinking-webbing-centre"
        style={{ left: "50%", top: "50%" }}
        title={title}
      >
        {title}
      </span>
      {nodes.map((n) => (
        <span
          key={n.key}
          className="thinking-webbing-dot"
          style={{ left: `${n.x * 100}%`, top: `${n.y * 100}%` }}
          title={n.text}
        >
          {n.text}
        </span>
      ))}
    </div>
  );
}
