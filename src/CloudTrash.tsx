import { useEffect, useState } from "react";
import { api } from "./cloud";
import type { CloudWorkspace } from "./cloud";
export function CloudTrash({ cloud }: { cloud: CloudWorkspace }) {
  const [items, setItems] = useState<
      { id: string; title: string; created: number; purging?: number }[]
    >([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function refresh() {
    setItems((await api<{ decks: typeof items }>("/api/trash")).decks);
  }
  useEffect(() => {
    void refresh().catch((error) => setMessage(error.message));
  }, [cloud.user?.id, cloud.decks]);
  async function action(id: string, permanent = false) {
    if (
      permanent &&
      !window.confirm(
        "写真・保存した版も完全に削除します。この操作は元に戻せません。",
      )
    )
      return;
    setBusy(true);
    try {
      await api(`/api/decks/${id}${permanent ? "" : "/untrash"}`, {
        method: permanent ? "DELETE" : "POST",
      });
      await cloud.refresh();
      await refresh();
      setMessage(permanent ? "完全に削除しました。" : "作品一覧に戻しました。");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="クラウド作品のごみ箱">
      <h3>クラウド作品のごみ箱</h3>
      <p>
        共同編集者からは開けません。容量と作品数の上限には含まれます。作品一覧に戻すと元の共有メンバーの権限も再び有効になります。招待リンクは再発行が必要です。
      </p>
      {!items.length && <p>ごみ箱は空です。</p>}
      {items.map((item) => (
        <article className="backup-preview" key={item.id}>
          <strong>{item.title}</strong>
          <p>{new Date(item.created).toLocaleString("ja-JP")}</p>
          {!!item.purging && (
            <p>完全削除の途中です。削除を再試行してください。</p>
          )}
          <button
            className="button outline"
            disabled={busy || !!item.purging}
            onClick={() => void action(item.id)}
          >
            作品一覧に戻す
          </button>
          <button
            className="quiet"
            disabled={busy}
            onClick={() => void action(item.id, true)}
          >
            {item.purging ? "完全削除を再試行" : "完全に削除"}
          </button>
        </article>
      ))}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
