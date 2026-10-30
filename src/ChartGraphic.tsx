import { useEffect, useReducer } from "react";
import type { Element } from "./model";
import { chartLayout, chartNumber } from "./chartLayout";
import { textMeasure, canvasFont } from "./contentFit";
export function ChartGraphic({ element: e }: { element: Element }) {
  const [, refresh] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    const done = () => refresh();
    if (document.fonts.status !== "loaded")
      void document.fonts.ready.then(done);
    document.fonts.addEventListener("loadingdone", done);
    return () => document.fonts.removeEventListener("loadingdone", done);
  }, []);
  const c = e.chart!,
    l = chartLayout(e, textMeasure),
    data = c.series,
    total = data.reduce((sum, p) => sum + p.value, 0),
    y = (v: number) => l.bottom - ((v - l.min) * (l.bottom - l.top)) / l.range;
  const cx = e.w / 2,
    cy = (l.top + l.bottom) / 2,
    r = Math.max(1, Math.min((l.bottom - l.top) / 2 - 10, e.w * 0.24));
  let angle = -Math.PI / 2;
  return (
    <svg
      className="chart-graphic"
      data-chart-numbered={l.numbered}
      data-chart-truncated={l.issues.length > 0}
      viewBox={`0 0 ${e.w} ${e.h}`}
      width="100%"
      height="100%"
      role="img"
      aria-label={c.title || "グラフ"}
      style={{ fontFamily: canvasFont() }}
    >
      <title>
        {c.title || "グラフ"}：
        {data.map((p) => `${p.label} ${chartNumber(p.value)}`).join("、")}
      </title>
      {l.title.lines.map((line, i) => (
        <text
          key={i}
          x={e.w / 2}
          y={26 + i * 25}
          textAnchor="middle"
          fontSize={22}
          fontWeight={700}
          fill="#173d38"
        >
          {line}
        </text>
      ))}
      {l.small ? (
        <text
          x={e.w / 2}
          y={e.h / 2}
          textAnchor="middle"
          fontSize={14}
          fill="#61756b"
        >
          グラフを大きくしてください
        </text>
      ) : !data.length ? (
        <text
          x={e.w / 2}
          y={e.h / 2}
          textAnchor="middle"
          fontSize={16}
          fill="#61756b"
        >
          項目を追加してデータを入力してください
        </text>
      ) : (
        <>
          {c.kind === "pie" ? (
            <>
              {total === 0 ? (
                <>
                  <circle cx={cx} cy={cy} r={r} fill="#e8ece6" />
                  <text x={cx} y={cy + 5} textAnchor="middle" fontSize={14}>
                    すべての値が0です
                  </text>
                </>
              ) : (
                data.map((p, i) => {
                  const start = angle,
                    span = (p.value / total) * Math.PI * 2;
                  angle += span;
                  if (!p.value) return null;
                  const middle = start + span / 2;
                  return (
                    <g key={p.id}>
                      <title>
                        {p.label}：{chartNumber(p.value)}
                      </title>
                      {span > Math.PI * 2 - 0.00001 ? (
                        <circle cx={cx} cy={cy} r={r} fill={p.color} />
                      ) : (
                        <path
                          d={`M${cx} ${cy}L${cx + r * Math.cos(start)} ${cy + r * Math.sin(start)}A${r} ${r} 0 ${span > Math.PI ? 1 : 0} 1 ${cx + r * Math.cos(angle)} ${cy + r * Math.sin(angle)}Z`}
                          fill={p.color}
                          stroke="white"
                          strokeWidth={2}
                        />
                      )}{" "}
                      {span > 0.35 && (
                        <text
                          x={cx + r * 0.68 * Math.cos(middle)}
                          y={cy + r * 0.68 * Math.sin(middle) + 5}
                          textAnchor="middle"
                          fontSize={14}
                          fill="#173d38"
                          stroke="white"
                          strokeWidth={3}
                          paintOrder="stroke"
                        >
                          {String.fromCodePoint(0x2460 + i)}
                          {c.showValues && data.length <= 4
                            ? ` ${Math.round((p.value / total) * 100)}%`
                            : ""}
                        </text>
                      )}
                    </g>
                  );
                })
              )}
            </>
          ) : (
            <>
              {[0, 0.5, 1].map((t) => {
                const v = l.min + l.range * t;
                return (
                  <g key={t}>
                    <line
                      x1={l.left}
                      x2={l.right}
                      y1={y(v)}
                      y2={y(v)}
                      stroke="#dce5dc"
                    />
                    <text
                      x={l.left - 8}
                      y={y(v) + 5}
                      textAnchor="end"
                      fontSize={14}
                      fill="#61756b"
                    >
                      {chartNumber(v)}
                    </text>
                  </g>
                );
              })}
              <line
                x1={l.left}
                x2={l.right}
                y1={y(0)}
                y2={y(0)}
                stroke="#60776c"
              />
              {c.kind === "line" && (
                <polyline
                  points={data
                    .map(
                      (p, i) => `${l.left + l.step * (i + 0.5)},${y(p.value)}`,
                    )
                    .join(" ")}
                  fill="none"
                  stroke={data[0].color}
                  strokeWidth={4}
                />
              )}
              {data.map((p, i) => {
                const x = l.left + l.step * (i + 0.5);
                return (
                  <g key={p.id}>
                    <title>
                      {p.label}：{chartNumber(p.value)}
                    </title>
                    {c.kind === "bar" ? (
                      <rect
                        x={x - l.step * 0.31}
                        y={Math.min(y(p.value), y(0))}
                        width={l.step * 0.62}
                        height={Math.max(1, Math.abs(y(p.value) - y(0)))}
                        fill={p.color}
                        rx={3}
                      />
                    ) : (
                      <circle cx={x} cy={y(p.value)} r={5} fill={p.color} />
                    )}
                    {(l.numbered
                      ? [String.fromCodePoint(0x2460 + i)]
                      : l.labels[i].lines
                    ).map((label, j) => (
                      <text
                        className="chart-axis-label"
                        key={j}
                        x={x}
                        y={l.bottom + 23 + j * 18}
                        textAnchor="middle"
                        fontSize={16}
                        fill="#173d38"
                      >
                        {label}
                      </text>
                    ))}
                    {c.showValues && !l.numbered && (
                      <text
                        x={x}
                        y={Math.max(l.top + 16, y(p.value) - 8)}
                        textAnchor="middle"
                        fontSize={14}
                        fill="#173d38"
                        stroke="white"
                        strokeWidth={3}
                        paintOrder="stroke"
                      >
                        {chartNumber(p.value)}
                      </text>
                    )}
                  </g>
                );
              })}
            </>
          )}
          {l.mapping &&
            data.map((p, i) => {
              const x = 16 + (i % l.cols) * l.colWidth,
                y = l.mapTop + Math.floor(i / l.cols) * l.rowHeight;
              return (
                <g className="chart-name-entry" key={p.id}>
                  <title>
                    {p.label}：{chartNumber(p.value)}
                  </title>
                  {c.showLegend && (
                    <rect x={x} y={y} width={10} height={10} fill={p.color} />
                  )}
                  <text x={x + 14} y={y + 12} fontSize={14} fill="#173d38">
                    {String.fromCodePoint(0x2460 + i)}
                    {c.showValues ? `  ${chartNumber(p.value)}` : ""}
                  </text>
                  {l.names[i].lines.map((name, j) => (
                    <text
                      className="chart-name-line"
                      key={j}
                      x={x + 14}
                      y={y + 29 + j * 16}
                      fontSize={14}
                      fill="#173d38"
                    >
                      {name}
                    </text>
                  ))}
                </g>
              );
            })}
        </>
      )}
    </svg>
  );
}
