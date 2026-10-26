import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Slide } from "./model";
import type { FitIssue } from "./contentFit";
import { fontRevision } from "./contentFit";
import {
  acknowledgeFit,
  checkContentFit,
  fitAcknowledged,
  fitKey,
} from "./checkContentFit";
export function FitReview({
  pages,
  onContinue,
  onCancel,
  onEdit,
}: {
  pages: Slide[];
  onContinue: () => void;
  onCancel: () => void;
  onEdit: (issue: FitIssue) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [issues, setIssues] = useState<FitIssue[]>(),
    [done, setDone] = useState(0),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [font, setFont] = useState(fontRevision());
  const key = fitKey(pages),
    latest = useRef(key),
    proceed = useRef(onContinue);
  latest.current = key;
  proceed.current = onContinue;
  useEffect(() => {
    const d = dialog.current!,
      previous = document.activeElement as HTMLElement | null;
    d.showModal();
    return () => {
      d.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    const update = () => setFont(fontRevision());
    document.fonts.addEventListener("loadingdone", update);
    return () => document.fonts.removeEventListener("loadingdone", update);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setIssues(undefined);
    setDone(0);
    setError("");
    if (!pages.length) {
      setError("対象ページがなくなりました。対象範囲を確認してください。");
      return () => controller.abort();
    }
    void checkContentFit(pages, controller.signal, setDone)
      .then((result) => {
        if (controller.signal.aborted || latest.current !== key) return;
        if (!result.length || fitAcknowledged(key)) {
          proceed.current();
          return;
        }
        setIssues(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(`表示を確認できませんでした。${e.message}`);
      });
    return () => controller.abort();
  }, [key, retry, font]);
  return createPortal(
    <dialog
      ref={dialog}
      className="tools-dialog fit-review"
      aria-label="表示チェック"
      onCancel={onCancel}
    >
      <header>
        <h2>表示チェック</h2>
        <button className="button outline" onClick={onCancel}>
          取り消す
        </button>
      </header>
      {error ? (
        <>
          <p role="alert">{error}</p>
          <button
            className="button outline"
            onClick={() => setRetry(retry + 1)}
          >
            確認をやり直す
          </button>
        </>
      ) : !issues ? (
        <p role="status">
          表・グラフを確認しています… {done} / {pages.length}ページ
        </p>
      ) : (
        <>
          <p role="status">
            {new Set(issues.map((i) => i.pageId)).size}
            ページに、表示の見切れ・省略があります。元の内容は変更していません。
          </p>
          <ul>
            {issues.slice(0, 100).map((issue, i) => (
              <li
                key={`${issue.pageId}/${issue.elementId}/${issue.cellKey}/${i}`}
              >
                <span>
                  {pages.find((p) => p.id === issue.pageId)?.title} ·{" "}
                  {issue.message}
                </span>
                <button className="quiet" onClick={() => onEdit(issue)}>
                  内容を確認・修正
                </button>
              </li>
            ))}
          </ul>
          {issues.length > 100 && (
            <p>
              ほか{issues.length - 100}
              件。ページごとに表・グラフを確認してください。
            </p>
          )}
          <p>
            文字を小さくする・要素を大きくする・名称を整理する方法があります。自動では変更しません。
          </p>
          <button
            className="button primary"
            onClick={() => {
              if (latest.current === key) {
                acknowledgeFit(key);
                onContinue();
              }
            }}
          >
            このまま進む
          </button>
          <button
            className="button outline"
            onClick={() => setRetry(retry + 1)}
          >
            再確認
          </button>
        </>
      )}
    </dialog>,
    document.body,
  );
}
