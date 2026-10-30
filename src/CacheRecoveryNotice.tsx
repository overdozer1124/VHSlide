import type { CloudWorkspace } from "./cloud";
export function CacheRecoveryNotice({
  cloud,
  compact = false,
}: {
  cloud: CloudWorkspace;
  compact?: boolean;
}) {
  const issue = cloud.cacheRecovery;
  if (!issue || (!compact && issue.dismissed)) return null;
  return (
    <section
      className="cache-recovery-notice"
      aria-label="端末の一時保存の保護"
      role="status"
    >
      <strong>
        {issue.stored
          ? "読み込めなかった一時保存を、この端末に退避しました"
          : "一時保存を保護するまでスライドは読み取り専用です"}
      </strong>
      <p>
        {issue.stored
          ? "クラウドに保存済みの内容を開いています。読み込めなかった未送信の変更は削除せずに保管し、クラウドへ送信していません。"
          : "端末への退避に失敗したため、元の一時保存を変更せず、クラウドに保存済みの内容だけを表示しています。"}
      </p>
      <div className="backup-actions">
        <button
          className="button outline"
          disabled={cloud.busy}
          onClick={() => void cloud.run(() => cloud.downloadCacheRecovery())}
        >
          復旧用データをダウンロード
        </button>
        {!issue.stored && (
          <button
            className="button outline"
            disabled={cloud.busy}
            onClick={() => void cloud.run(() => cloud.open(cloud.active!.id))}
          >
            一時保存の保護を再試行
          </button>
        )}
        {issue.stored && !compact && (
          <button
            className="quiet"
            aria-label="復旧の案内を閉じる"
            disabled={cloud.busy}
            onClick={() => void cloud.run(() => cloud.dismissCacheRecovery())}
          >
            閉じる
          </button>
        )}
      </div>
      <small>
        復旧用ファイルは通常の作品JSONとは異なります。作品の内容を含みます。閉じた後も「クラウド」の作品一覧から保存できます。
      </small>
    </section>
  );
}
