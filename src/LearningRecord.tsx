import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "./cloud";
import { csvCell } from "./surveyCsv";
import type {
  RecordEntry,
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

export function LearningRecord({
  deckId,
  isHost,
  onClose,
}: {
  deckId: string;
  isHost: boolean;
  onClose: () => void;
}) {
  const [students, setStudents] = useState<StudentRecord[] | null>(null);
  const [own, setOwn] = useState<StudentRecord | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [printing, setPrinting] = useState(false);

  const load = () => {
    setError("");
    if (isHost) {
      api<{ students: StudentRecord[] }>(`/api/decks/${deckId}/record`)
        .then((r) => {
          setStudents(r.students);
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
      {current ? (
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
