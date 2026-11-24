import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "./cloud";
import { csvCell } from "./surveyCsv";
import type {
  RecordEntry,
  RecordMatrix,
  StudentRecord,
} from "./learningRecord";
import type { ThinkingView } from "./thinkingTools";
import { valueText } from "./ThinkingResults";

/** Stage 3a: the learning-record screen. The host picks a student
 * and sees every answer that student gave in this deck, ordered by
 * its place on the map; a student sees only their own record (the
 * server keys it by the signed-in account). */

function fieldText(field: NonNullable<RecordEntry["fields"]>[number]): string {
  const v = field.value;
  if (v === null || v === undefined || v === "") return "（未入力）";
  if (field.kind === "drawing") return "（描いた絵）";
  if (Array.isArray(v)) {
    const parts = v
      .map((i) =>
        typeof i === "number" ? (field.options[i] ?? "") : String(i),
      )
      .filter(Boolean);
    return parts.length
      ? parts.join(field.kind === "order" ? " → " : "、")
      : "（未入力）";
  }
  if (typeof v === "boolean") return v ? "チェック済み" : "（未入力）";
  if (typeof v === "object")
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `${k}：${String(val)}`)
      .join("、");
  return String(v);
}

function surveyText(entry: RecordEntry): string {
  if (entry.surveyKind === "text") return entry.text || "（未入力）";
  const parts = (entry.choices ?? [])
    .map((i) => entry.options?.[i] ?? "")
    .filter(Boolean);
  return parts.length ? parts.join("、") : "（未入力）";
}

function EntryView({ entry }: { entry: RecordEntry }) {
  const kindLabel =
    entry.kind === "worksheet"
      ? "ワークシート"
      : entry.kind === "survey"
        ? "アンケート"
        : "思考ツール";
  return (
    <div className="record-entry">
      <div className="record-entry-head">
        <span className="record-kind">{kindLabel}</span>
        <span className="record-entry-title">{entry.title}</span>
        {entry.groupName && (
          <span className="record-group">
            {entry.groupName}の活動{entry.groupCurrent ? "（今の班）" : ""}
          </span>
        )}
        {entry.placement?.slideTitle &&
          entry.placement.slideTitle !== entry.title && (
            <span className="record-slide">
              スライド：{entry.placement.slideTitle}
            </span>
          )}
      </div>
      {entry.fields && (
        <dl className="record-fields">
          {entry.fields.map((f) => (
            <div key={f.id} className="record-field">
              <dt>{f.label}</dt>
              <dd>
                {fieldText(f)}
                {f.reason ? (
                  <span className="record-reason">理由：{f.reason}</span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {entry.kind === "survey" && (
        <p className="record-answer">{surveyText(entry)}</p>
      )}
      {entry.scenes && (
        <dl className="record-fields">
          {entry.scenes.map((s) => {
            const empty =
              s.value.x === undefined &&
              s.value.y === undefined &&
              s.value.v === undefined;
            return (
              <div key={s.id} className="record-field">
                <dt>{s.label}</dt>
                <dd>
                  {empty
                    ? "（まだ置いていない）"
                    : valueText(
                        {
                          template: entry.template,
                          definition: {
                            nameA: entry.nameA ?? "",
                            nameB: entry.nameB ?? "",
                          },
                        } as ThinkingView,
                        s.value,
                      )}
                  {s.reason ? (
                    <span className="record-reason">理由：{s.reason}</span>
                  ) : null}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      {entry.nodes && (
        <ul className="record-nodes">
          {entry.nodes.map((n, i) => (
            <li
              key={i}
              className="record-node"
              style={{ marginLeft: `${n.depth * 1.4}em` }}
            >
              {n.text}
            </li>
          ))}
        </ul>
      )}
      {entry.zones && (
        <div className="record-zones">
          {entry.zones.map((z) => (
            <div key={z.id} className="record-zone">
              <span className="record-zone-label">{z.label}</span>
              {z.cards.length === 0 ? (
                <span className="record-empty">（なし）</span>
              ) : (
                z.cards.map((c, i) => (
                  <span key={i} className={`record-card is-${c.color || "none"}`}>
                    {c.text}
                  </span>
                ))
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RecordTimeline({ record }: { record: StudentRecord }) {
  const groups: { heading: string; entries: RecordEntry[] }[] = [];
  for (const entry of record.entries) {
    const heading = entry.placement
      ? [entry.placement.sheetName, entry.placement.rowLabel]
          .filter(Boolean)
          .join(" ") || "（見出しなし）"
      : "スライドに置かれていないもの";
    const last = groups[groups.length - 1];
    if (last && last.heading === heading) last.entries.push(entry);
    else groups.push({ heading, entries: [entry] });
  }
  if (record.entries.length === 0)
    return <p className="record-none">まだ回答がありません。</p>;
  return (
    <div className="record-timeline">
      {groups.map((g, i) => (
        <section key={i} className="record-time">
          <h3>{g.heading}</h3>
          {g.entries.map((e) => (
            <EntryView key={`${e.kind}:${e.refId}`} entry={e} />
          ))}
        </section>
      ))}
    </div>
  );
}

/** Stage 3c: the answer-status matrix （生徒×時間）. A cell shows
 * whether the student answered that row's items; clicking it opens
 * the slide the item sits on. Host only — the payload itself is
 * served by the host-only record route. */
function RecordMatrixView({
  matrix,
  onOpenSlide,
}: {
  matrix: RecordMatrix;
  onOpenSlide?: (slideId: string) => void;
}) {
  if (matrix.columns.length === 0)
    return (
      <p className="record-none">
        スライドに置かれた項目がまだありません。
      </p>
    );
  return (
    <div className="record-matrix-wrap">
      <table className="record-matrix">
        <thead>
          <tr>
            <th scope="col" className="record-matrix-name">生徒</th>
            {matrix.columns.map((column) => (
              <th key={column.key} scope="col">
                {[column.sheetName, column.rowLabel]
                  .filter(Boolean)
                  .join(" ") ||
                  column.slideTitle ||
                  "（見出しなし）"}
                <span className="record-matrix-total">
                  {column.total}件
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((row) => (
            <tr key={row.userId}>
              <th scope="row" className="record-matrix-name">
                {row.name}
              </th>
              {row.cells.map((cell, i) => {
                const total = matrix.columns[i].total;
                const groupOnly = cell.group > 0 && cell.answered < total;
                const state =
                  cell.answered >= total
                    ? "full"
                    : cell.answered > 0
                      ? "partial"
                      : groupOnly
                        ? "group"
                        : "none";
                const label =
                  state === "full"
                    ? "●"
                    : state === "none"
                      ? "―"
                      : cell.answered === 0 && cell.group >= total
                        ? "班"
                        : `${cell.answered}/${total}${groupOnly ? "・班" : ""}`;
                return (
                  <td key={matrix.columns[i].key}>
                    <button
                      type="button"
                      className={`record-matrix-cell is-${state}`}
                      disabled={!onOpenSlide}
                      onClick={() => onOpenSlide?.(cell.slideId)}
                      aria-label={`${row.name}さん、${matrix.columns[i].rowLabel || matrix.columns[i].slideTitle}：${cell.answered}/${total}件回答${groupOnly ? "（今の班が答えている項目があります）" : ""}。スライドを開く`}
                    >
                      {label}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="record-matrix-note">
        セルを押すと、その時間のスライドを開きます。●は全ての項目に回答済み、数字は回答した項目の数です。「班」は、自分では書いていないけれど今の班が答えているものです（回答の数には入れていません）。
      </p>
    </div>
  );
}

export function LearningRecord({
  deckId,
  isHost,
  onClose,
  onOpenSlide,
}: {
  deckId: string;
  isHost: boolean;
  onClose: () => void;
  onOpenSlide?: (slideId: string) => void;
}) {
  const [students, setStudents] = useState<StudentRecord[] | null>(null);
  const [matrix, setMatrix] = useState<RecordMatrix | null>(null);
  const [mode, setMode] = useState<"timeline" | "matrix">("timeline");
  const [own, setOwn] = useState<StudentRecord | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [printing, setPrinting] = useState(false);

  const load = () => {
    setError("");
    if (isHost) {
      api<{ students: StudentRecord[]; matrix: RecordMatrix }>(
        `/api/decks/${deckId}/record`,
      )
        .then((r) => {
          setStudents(r.students);
          setMatrix(r.matrix);
          setSelected((prev) =>
            r.students.some((s) => s.userId === prev)
              ? prev
              : (r.students[0]?.userId ?? ""),
          );
        })
        .catch(() => setError("記録を読み込めませんでした。"));
    } else {
      api<{ record: StudentRecord }>(`/api/decks/${deckId}/record/me`)
        .then((r) => setOwn(r.record))
        .catch(() => setError("記録を読み込めませんでした。"));
    }
  };
  useEffect(load, [deckId, isHost]);

  const current = isHost
    ? (students?.find((s) => s.userId === selected) ?? null)
    : own;

  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener("afterprint", done);
    const t = setTimeout(() => window.print(), 60);
    return () => {
      clearTimeout(t);
      window.removeEventListener("afterprint", done);
    };
  }, [printing]);

  const downloadCsv = () => {
    if (!current) return;
    const lines = [["時間", "スライド", "種類", "項目", "内容"].map(csvCell).join(",")];
    for (const e of current.entries) {
      const time = e.placement
        ? [e.placement.sheetName, e.placement.rowLabel].filter(Boolean).join(" ")
        : "";
      const slide = e.placement?.slideTitle ?? "";
      const kind =
        e.kind === "worksheet"
          ? "ワークシート"
          : e.kind === "survey"
            ? "アンケート"
            : "思考ツール";
      if (e.fields)
        for (const f of e.fields)
          lines.push(
            [time, slide, kind, `${e.title}／${f.label}`, fieldText(f)]
              .map(csvCell)
              .join(","),
          );
      if (e.kind === "survey")
        lines.push(
          [time, slide, kind, e.title, surveyText(e)].map(csvCell).join(","),
        );
      if (e.scenes)
        for (const s of e.scenes)
          lines.push(
            [
              time,
              slide,
              kind,
              `${e.title}／${s.label}`,
              s.value.x === undefined &&
              s.value.y === undefined &&
              s.value.v === undefined
                ? "（まだ置いていない）"
                : valueText(
                    {
                      template: e.template,
                      definition: {
                        nameA: e.nameA ?? "",
                        nameB: e.nameB ?? "",
                      },
                    } as ThinkingView,
                    s.value,
                  ),
            ]
              .map(csvCell)
              .join(","),
          );
      if (e.zones)
        for (const z of e.zones)
          for (const c of z.cards)
            lines.push(
              [time, slide, kind, `${e.title}／${z.label}`, c.text]
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
    a.download = `${current.name}さんの学びの記録.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="learning-record">
      <div className="learning-record-head">
        <h2>学びの記録</h2>
        <div className="learning-record-actions">
          <button type="button" onClick={load}>
            最新にする
          </button>
          <button type="button" onClick={downloadCsv} disabled={!current}>
            CSVで保存
          </button>
          <button
            type="button"
            onClick={() => setPrinting(true)}
            disabled={!current}
          >
            印刷・PDF
          </button>
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
      {error && (
        <p className="record-error" role="alert">
          {error}
        </p>
      )}
      {isHost && students && (
        <div className="record-modes" role="tablist" aria-label="見方を選ぶ">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "timeline"}
            className={mode === "timeline" ? "is-active" : ""}
            onClick={() => setMode("timeline")}
          >
            タイムライン
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "matrix"}
            className={mode === "matrix" ? "is-active" : ""}
            onClick={() => setMode("matrix")}
          >
            回答状況
          </button>
        </div>
      )}
      {isHost && students && mode === "timeline" && (
        <div className="record-students" role="tablist" aria-label="生徒を選ぶ">
          {students.map((s) => (
            <button
              key={s.userId}
              type="button"
              role="tab"
              aria-selected={selected === s.userId}
              className={selected === s.userId ? "is-active" : ""}
              onClick={() => setSelected(s.userId)}
            >
              {s.name}
              <span className="record-count">
                {s.answered}/{s.total}
              </span>
            </button>
          ))}
          {students.length === 0 && (
            <p className="record-none">参加者がまだいません。</p>
          )}
        </div>
      )}
      {!isHost && own && (
        <p className="record-mine-note">
          {own.name}さんの記録です（{own.answered}/{own.total} 件の回答）。
        </p>
      )}
      {isHost && mode === "matrix" ? (
        matrix ? (
          <RecordMatrixView matrix={matrix} onOpenSlide={onOpenSlide} />
        ) : (
          !error && <p className="record-none">読み込んでいます…</p>
        )
      ) : current ? (
        <RecordTimeline record={current} />
      ) : (
        !error && <p className="record-none">読み込んでいます…</p>
      )}
      {printing &&
        current &&
        createPortal(
          <div className="print-export learning-record-print">
            <h1>{current.name}さんの学びの記録</h1>
            <RecordTimeline record={current} />
          </div>,
          document.body,
        )}
      {printing &&
        createPortal(
          <style>
            {"@media print { @page { size: A4 portrait; margin: 12mm; } }"}
          </style>,
          document.head,
        )}
    </div>
  );
}
