import { useEffect, useState } from "react";
import type { WorksheetField } from "./worksheets";

function NumberCell({
  value,
  min,
  max,
  label,
  disabled,
  onChange,
}: {
  value: number | null;
  min: number;
  max: number;
  label: string;
  disabled: boolean;
  onChange: (value: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value === null ? "" : String(value));
  }, [value, focused]);
  const n = Number(text);
  const invalid = text !== "" && (!Number.isInteger(n) || n < min || n > max);
  return (
    <span className="radar-cell">
      <input
        type="number"
        inputMode="numeric"
        aria-label={label}
        aria-invalid={invalid || undefined}
        min={min}
        max={max}
        step={1}
        disabled={disabled}
        placeholder={`${min}〜${max}`}
        value={text}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          if (!invalid) setFocused(false);
        }}
        onChange={(event) => {
          const raw = event.target.value;
          setText(raw);
          const next = Number(raw);
          if (raw === "") onChange(null);
          else if (Number.isInteger(next) && next >= min && next <= max)
            onChange(next);
        }}
      />
      {invalid && (
        <small role="alert">
          {min}〜{max}の整数
        </small>
      )}
    </span>
  );
}
export function WorksheetRadar({
  field,
  value,
  disabled,
  onChange,
}: {
  field: WorksheetField;
  value: (number | null)[];
  disabled: boolean;
  onChange: (value: (number | null)[]) => void;
}) {
  const { axes, series, min, max } = field.radar!;
  const values = Array.from(
    { length: axes.length * series.length },
    (_, i) => value[i] ?? null,
  );
  const point = (index: number, fraction: number) => {
    const angle = (2 * Math.PI * index) / axes.length - Math.PI / 2;
    return [
      100 + Math.cos(angle) * 76 * fraction,
      100 + Math.sin(angle) * 76 * fraction,
    ];
  };
  const coords = (fraction: number) =>
    axes.map((_, i) => point(i, fraction).join(",")).join(" ");
  return (
    <div className="worksheet-radar">
      <p className="radar-instruction">
        各項目に {min}〜{max} の整数を入力してください。
      </p>
      <div className="radar-table-scroll">
        <table className="radar-input-table">
          <thead>
            <tr>
              <th scope="col">項目</th>
              {series.map((name) => (
                <th scope="col" key={name}>
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {axes.map((axis, a) => (
              <tr key={a}>
                <th scope="row">
                  {a + 1}. {axis}
                </th>
                {series.map((name, s) => (
                  <td key={s}>
                    <NumberCell
                      label={`${name}：${axis}`}
                      value={values[s * axes.length + a]}
                      min={min}
                      max={max}
                      disabled={disabled}
                      onChange={(n) => {
                        const next = [...values];
                        next[s * axes.length + a] = n;
                        onChange(next);
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="radar-charts">
        {series.map((name, s) => {
          const entries = values.slice(s * axes.length, (s + 1) * axes.length);
          const complete = entries.every((n) => n !== null);
          return (
            <figure key={s}>
              <figcaption>{name}</figcaption>
              <svg
                viewBox="0 0 200 200"
                role="img"
                aria-label={`${name}のレーダーチャート`}
              >
                <title>{name}のレーダーチャート</title>
                {[0.2, 0.4, 0.6, 0.8, 1].map((scale) => (
                  <polygon
                    key={scale}
                    points={coords(scale)}
                    className="radar-grid"
                  />
                ))}
                {axes.map((_, i) => {
                  const [x, y] = point(i, 1);
                  const [lx, ly] = point(i, 1.15);
                  return (
                    <g key={i}>
                      <line
                        x1="100"
                        y1="100"
                        x2={x}
                        y2={y}
                        className="radar-axis"
                      />
                      <text
                        x={lx}
                        y={ly}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className="radar-number"
                      >
                        {i + 1}
                      </text>
                    </g>
                  );
                })}
                {complete && (
                  <polygon
                    points={entries
                      .map((n, i) => point(i, n! / max).join(","))
                      .join(" ")}
                    className="radar-area"
                  />
                )}
                {entries.map((n, i) =>
                  n === null ? null : (
                    <circle
                      key={i}
                      cx={point(i, n / max)[0]}
                      cy={point(i, n / max)[1]}
                      r="2.8"
                      className="radar-point"
                    />
                  ),
                )}
                {[0.2, 0.4, 0.6, 0.8, 1].map((scale) => (
                  <text key={scale} x="103" y={100 - 76 * scale} className="radar-tick">{Number((max * scale).toFixed(1))}</text>
                ))}
              </svg>
              {!complete && <small>全項目を入力すると面を表示します</small>}
            </figure>
          );
        })}
      </div>
    </div>
  );
}
