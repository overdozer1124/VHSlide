import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { BackupPanel } from "./BackupPanel";
import { SaveState } from "./SaveState";
import type { CloudWorkspace } from "./cloud";
export function BackupDialog({
  cloud,
  close,
  openLibrary,
}: {
  cloud: CloudWorkspace;
  close: () => void;
  openLibrary: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current!,
      previous = document.activeElement as HTMLElement | null;
    node.showModal();
    return () => {
      node.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className="tools-dialog backup-dialog"
      aria-label="完全バックアップと復元"
      onCancel={close}
    >
      <header>
        <div>
          <h2>完全バックアップと復元</h2>
          <p>付箋や共有設定も含めて保管し、新しい作品へ復元します。</p>
        </div>
        <button className="button outline" onClick={close}>
          閉じる
        </button>
      </header>
      <SaveState cloud={cloud} />
      <details className="save-format-guide">
        <summary>JSON・PDF・ZIPの違い</summary>
        <dl>
          <dt>編集用ファイル（JSON）</dt>
          <dd>
            全シートのページ・写真・見出し・発表ルート。付箋・共有設定・過去の版は含みません。
          </dd>
          <dt>配布用（PDF）</dt>
          <dd>
            選んだページの見た目。再編集・共同編集用のデータは含みません。
          </dd>
          <dt>完全バックアップ（ZIP）</dt>
          <dd>
            全シートのページ・写真・付箋・共有設定。招待リンク・認証情報・過去の版は含みません。
          </dd>
        </dl>
      </details>
      {cloud.user ? (
        <BackupPanel cloud={cloud} />
      ) : (
        <section className="backup-preview">
          <h3>クラウドへサインインしてください</h3>
          <p>
            完全バックアップの作成と復元にはクラウドを使用します。JSONの保存はログインなしでも使えます。
          </p>
          <button className="button primary" onClick={openLibrary}>
            クラウドの作品を開く
          </button>
        </section>
      )}
    </dialog>,
    document.body,
  );
}
