import { useState } from "react";
export function CloudRecoveryNotice({
  save,
  resume,
}: {
  save: () => Promise<boolean>;
  resume: () => void;
}) {
  const [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false);
  return (
    <section className="cloud-recovery-notice" aria-label="未送信の作品の復元">
      <strong>以前の画面で保存されていない配置変更が見つかりました</strong>
      <p>
        旧版の未送信の配置変更を端末から復元しました。
        今は端末に残っていた作品を読み取り専用で表示しています。まずJSONを保存して変更を残し、次にクラウドの作品を開き直してください。
      </p>
      <div className="backup-actions">
        <button
          className="button outline"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void save()
              .then(setSaved)
              .finally(() => setBusy(false));
          }}
        >
          1. 未送信の作品をJSONで保存
        </button>
        <button
          className="button primary"
          disabled={!saved || busy}
          onClick={resume}
        >
          2. クラウドの作品に戻る
        </button>
      </div>
    </section>
  );
}
