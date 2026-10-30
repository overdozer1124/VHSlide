import { assignmentReadiness } from "./assignmentReadiness";
import type { Deck } from "./model";
import type { EditAccess } from "./permissions";
export function AssignmentStatus({
  book,
  access,
}: {
  book: Deck;
  access: EditAccess;
}) {
  const state = assignmentReadiness(book, access);
  return (
    <small className="assignment-status" data-state={state.kind}>
      {state.summary}
      {!!state.pending.length && (
        <span>
          担当ページの準備待ち：{state.pending.join(" / ")}
          。ページは自動作成されません。
        </span>
      )}
      {!!state.missing.length && (
        <span>削除済みの担当範囲があります。編集権限を確認してください。</span>
      )}
    </small>
  );
}
