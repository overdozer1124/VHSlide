import { useEffect, useState } from "react";
import type { Element } from "./model";
import { measureTableFit, textMeasure, type FitIssue } from "./contentFit";
import { chartLayout } from "./chartLayout";
export function ElementFitNotice({ element: e }: { element: Element }) {
  const [issues, setIssues] = useState<FitIssue[]>([]);
  useEffect(() => {
    let frame = 0,
      alive = true;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!alive) return;
        const node = document.querySelector<HTMLTableElement>(
          `.editor-workspace [data-element-id="${CSS.escape(e.id)}"] .slide-table`,
        );
        setIssues(
          e.type === "table" && node
            ? measureTableFit(node, e.id)
            : e.type === "chart"
              ? chartLayout(e, textMeasure).issues.map((message) => ({
                  elementId: e.id,
                  kind: "chart" as const,
                  message,
                }))
              : [],
        );
      });
    };
    document.addEventListener("vhslide-table-fit", update);
    document.fonts.addEventListener("loadingdone", update);
    void document.fonts.ready.then(update);
    update();
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      document.removeEventListener("vhslide-table-fit", update);
      document.fonts.removeEventListener("loadingdone", update);
    };
  }, [e]);
  if (!issues.length) return null;
  return (
    <section className="element-fit-notice" aria-label="表示の見切れ">
      <strong>表示を確認してください</strong>
      <ul>
        {issues.slice(0, 8).map((issue, i) => (
          <li key={i}>{issue.message}</li>
        ))}
      </ul>
      {issues.length > 8 && <p>ほか{issues.length - 8}セル</p>}
      <p>
        {e.type === "table"
          ? "行の高さ・文字の大きさ・表全体の大きさを調整できます。行高の比率を変えると、ほかの行の高さも変わります。入力欄では全文をスクロールして確認できます。"
          : "項目名を整理するか、グラフを大きくしてください。データ欄で元の名称を確認できます。"}
      </p>
    </section>
  );
}
