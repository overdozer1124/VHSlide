import { useEffect, useState } from "react";
import type { Element } from "./model";
import type { PrevAnswerData } from "./prevAnswer";
import { api } from "./cloud";
import { useThinking } from "./ThinkingContext";
import { valueText } from "./ThinkingResults";
import type { ThinkingView } from "./thinkingTools";

/**
 * Stage 3b: renders a 「前の自分の回答」 part. Each viewer sees only
 * their own earlier answer (the server keys it by account); the host
 * sees a placeholder naming the source, never a student's answer.
 */
export function SlidePrevAnswer({ element }: { element: Element }) {
  const binding = element.prevAnswer!;
  const ctx = useThinking();
  const deckId = ctx.deckId ?? binding.deckId;
  const [data, setData] = useState<PrevAnswerData | null | undefined>(
    undefined,
  );
  useEffect(() => {
    if (ctx.host || !deckId) return;
    let alive = true;
    const load = () => {
      const params = new URLSearchParams({
        source: binding.source,
        ref: binding.refId,
      });
      if (binding.fieldId) params.set("field", binding.fieldId);
      if (binding.sceneId) params.set("scene", binding.sceneId);
      api<{ answer: PrevAnswerData | null }>(
        `/api/decks/${deckId}/prev-answer?${params}`,
      )
        .then((r) => {
          if (alive) setData(r.answer);
        })
        .catch(() => {
          if (alive) setData(null);
        });
    };
    // A previous answer rarely changes while the slide is open;
    // load once per mount instead of polling (review 🟡1).
    load();
    return () => {
      alive = false;
    };
  }, [
    ctx.host,
    deckId,
    binding.source,
    binding.refId,
    binding.fieldId,
    binding.sceneId,
  ]);

  const head = (
    <div className="prev-answer-head">
      <span className="prev-answer-tag">前の自分の回答</span>
      <span className="prev-answer-source">
        {binding.title}
        {binding.label ? `（${binding.label}）` : ""}
      </span>
    </div>
  );
  const frameStyle = {
    background: element.fill === "none" ? "#ffffff" : element.fill,
    borderColor: element.stroke,
    color: element.color,
  } as React.CSSProperties;
  if (ctx.host) {
    return (
      <div className="prev-answer prev-answer-host" style={frameStyle}>
        {head}
        <p className="prev-answer-note">
          生徒の画面には、本人の前の回答が表示されます。
        </p>
      </div>
    );
  }
  return (
    <div className="prev-answer" style={frameStyle}>
      {head}
      {data === undefined ? (
        <p className="prev-answer-note">読み込んでいます…</p>
      ) : data === null ? (
        <p className="prev-answer-note">まだ回答がありません。</p>
      ) : (
        <PrevAnswerBody data={data} />
      )}
    </div>
  );
}

function PrevAnswerBody({ data }: { data: PrevAnswerData }) {
  if (data.source === "worksheet") {
    return (
      <>
        <p className="prev-answer-value">
          {worksheetValueText(data)}
        </p>
        {data.reason && (
          <p className="prev-answer-reason">理由：{data.reason}</p>
        )}
      </>
    );
  }
  if (data.source === "survey") {
    const text =
      data.surveyKind === "text"
        ? data.text
        : data.choices
            .map((i) => data.options[i] ?? "")
            .filter(Boolean)
            .join("、");
    return <p className="prev-answer-value">{text || "（未入力）"}</p>;
  }
  const tool = {
    template: data.template,
    definition: { nameA: data.nameA, nameB: data.nameB },
  } as unknown as ThinkingView;
  return (
    <>
      {data.unit === "group" && (
        <p className="prev-answer-group">
          {data.groupName ?? "班"}の回答
          {data.groupCurrent ? "（今の班）" : ""}
        </p>
      )}
      <p className="prev-answer-value">{valueText(tool, data.value)}</p>
      {data.reason && (
        <p className="prev-answer-reason">理由：{data.reason}</p>
      )}
    </>
  );
}

function worksheetValueText(data: Extract<PrevAnswerData, { source: "worksheet" }>): string {
  const v = data.value;
  if (v === null || v === undefined || v === "") return "（未入力）";
  if (data.fieldKind === "drawing") return "（描いた絵は「学びの記録」で見られます）";
  if (Array.isArray(v)) {
    const parts = v
      .map((i) =>
        typeof i === "number" ? (data.options[i] ?? "") : String(i),
      )
      .filter(Boolean);
    return parts.length
      ? parts.join(data.fieldKind === "order" ? " → " : "、")
      : "（未入力）";
  }
  if (typeof v === "boolean") return v ? "チェック済み" : "（未入力）";
  if (typeof v === "object")
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `${k}：${String(val)}`)
      .join("、");
  return String(v);
}
