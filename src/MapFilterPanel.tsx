import type { Deck } from "./model";
import type { AssignmentReadiness } from "./assignmentReadiness";
import { emptyFilter, matchesFilter } from "./mapFilter";
import type { MapFilter } from "./mapFilter";
export function MapFilterPanel({
  deck,
  assignedIds,
  value,
  onChange,
  onApply,
  onClose,
  editor,
  onEditorChange,
  assignment,
  assignmentChecking,
  onAssignmentSheet,
}: {
  deck: Deck;
  assignedIds: string[];
  value: MapFilter;
  onChange: (filter: MapFilter) => void;
  onApply: () => void;
  onClose: () => void;
  editor: boolean;
  onEditorChange: (value: boolean) => void;
  assignment?: AssignmentReadiness;
  assignmentChecking?: boolean;
  onAssignmentSheet?: (id: string) => void;
}) {
  const count = deck.slides.filter((s) => matchesFilter(s, value)).length;
  return (
    <div
      className="filter-selection-bar"
      role="region"
      aria-label="マップのフィルタ設定"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div>
        <strong>マップから選ぶ</strong>
        <span>
          行・列の番号やスライドを押して選択。もう一度押すと解除できます。
        </span>
      </div>
      <button
        className="button outline"
        disabled={assignmentChecking || !assignedIds.length}
        onClick={() =>
          onChange({
            assigned: true,
            assignedIds,
            ids: [],
            rows: [],
            columns: [],
          })
        }
      >
        自分の担当を選択（{assignedIds.length}枚）
      </button>
      {assignmentChecking ? (
        <span role="status">担当範囲を確認しています…</span>
      ) : (
        <>
          {!!assignment?.pending.length && (
            <span>
              担当ページの準備待ち：{assignment.pending.join(" / ")}
              。ホストがページを作成すると選択できます。
            </span>
          )}
          {!!assignment?.missing.length && (
            <span>
              担当していた範囲が削除されています。ホストに確認してください。
            </span>
          )}
          {!assignedIds.length &&
            !assignment?.pending.length &&
            !assignment?.missing.length && (
              <span>
                {assignment?.kind === "view"
                  ? "閲覧のみです。編集範囲はホストが設定します。"
                  : "このシートに編集できる担当はありません。"}
              </span>
            )}
          {assignment?.otherSheets.map((s) => (
            <button key={s.id} onClick={() => onAssignmentSheet?.(s.id)}>
              {s.name}の担当へ（{s.count}枚）
            </button>
          ))}
        </>
      )}
      <label>
        <input
          type="checkbox"
          checked={editor}
          onChange={(e) => onEditorChange(e.target.checked)}
        />
        編集画面にもフィルタを適用
      </label>
      <div className="filter-selection-actions">
        <strong aria-live="polite">{count}ページ選択中</strong>
        <button onClick={() => onChange(emptyFilter())}>選択をクリア</button>
        <button onClick={onClose}>キャンセル</button>
        <button className="button primary" disabled={!count} onClick={onApply}>
          フィルタを適用
        </button>
      </div>
    </div>
  );
}
