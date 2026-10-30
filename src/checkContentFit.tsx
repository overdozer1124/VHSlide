import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Canvas } from "./Canvas";
import type { Slide } from "./model";
import {
  canvasFont,
  fontRevision,
  measureTableFit,
  textMeasure,
  type FitIssue,
} from "./contentFit";
import { chartLayout } from "./chartLayout";
const cache = new Map<string, FitIssue[]>(),
  acknowledged = new Set<string>();
export const fitKey = (pages: Slide[]) =>
  JSON.stringify([
    fontRevision(),
    canvasFont(),
    pages.map((s) => [
      s.id,
      s.elements.filter((e) => e.type === "table" || e.type === "chart"),
    ]),
  ]);
export function acknowledgeFit(key: string) {
  if (acknowledged.size > 100) acknowledged.clear();
  acknowledged.add(key);
}
export const fitAcknowledged = (key: string) => acknowledged.has(key);
export const needsFitCheck = (pages: Slide[]) =>
  pages.some((s) =>
    s.elements.some((e) => e.type === "table" || e.type === "chart"),
  );
export async function checkContentFit(
  pages: Slide[],
  signal: AbortSignal,
  progress: (n: number) => void,
) {
  signal.throwIfAborted();
  let abort = () => {};
  try {
    await Promise.race([
      document.fonts.ready,
      new Promise<never>((_, reject) => {
        abort = () =>
          reject(new DOMException("表示確認を中断しました", "AbortError"));
        signal.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
  signal.throwIfAborted();
  const host = document.createElement("div");
  host.className = "fit-render-host";
  host.style.cssText =
    "position:fixed;top:0;left:0;width:960px;height:540px;visibility:hidden;pointer-events:none;z-index:-1;contain:layout style;";
  document.body.append(host);
  let failure: unknown;
  const root = createRoot(host, {
      onUncaughtError: (e) => {
        failure = e;
      },
    }),
    result: FitIssue[] = [];
  try {
    for (let i = 0; i < pages.length; i++) {
      signal.throwIfAborted();
      const page = pages[i],
        elements = page.elements.filter(
          (e) => e.type === "table" || e.type === "chart",
        ),
        key = fitKey([{ ...page, elements }]);
      if (cache.has(key)) result.push(...cache.get(key)!);
      else if (elements.length) {
        flushSync(() => root.render(<Canvas slide={{ ...page, elements }} />));
        if (failure) throw failure;
        const issues: FitIssue[] = [];
        for (const e of elements) {
          if (e.type === "table") {
            const node = host.querySelector<HTMLTableElement>(
              `[data-element-id="${CSS.escape(e.id)}"] .slide-table`,
            );
            if (!node) throw new Error("表を計測できません。");
            issues.push(
              ...measureTableFit(node, e.id).map((v) => ({
                ...v,
                pageId: page.id,
              })),
            );
          } else
            issues.push(
              ...chartLayout(e, textMeasure).issues.map((message) => ({
                pageId: page.id,
                elementId: e.id,
                kind: "chart" as const,
                message,
              })),
            );
        }
        if (cache.size > 1500) cache.clear();
        cache.set(key, issues);
        result.push(...issues);
      }
      progress(i + 1);
      if (elements.length || i % 20 === 0)
        await new Promise((r) => setTimeout(r, 0));
    }
    signal.throwIfAborted();
    return result;
  } finally {
    root.unmount();
    host.remove();
  }
}
