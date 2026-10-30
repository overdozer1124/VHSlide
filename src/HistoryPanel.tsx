import { digestText, validDigest } from "./backupProtocol";
import { useEffect, useRef, useState } from "react";
import type { Deck } from "./model";
import { CloudWorkspace, api } from "./cloud";
import type { HistoryEntry } from "./historyStore";
import type { BackupSnapshot } from "./backupData";
import { localVersions, saveLocalVersion } from "./localHistory";

import { restoreFullBackup } from "./backupClient";
import { slideLabel } from "./learningTools";
import { Canvas } from "./Canvas";
export function HistoryPanel({
  book,
  cloud,
  onLocalRestore,
}: {
  book: Deck;
  cloud: CloudWorkspace;
  onLocalRestore?: (book: Deck) => void;
}) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]),
    [label, setLabel] = useState("保存した版"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<BackupSnapshot>();
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => controller.current?.abort(), []);
  const id = cloud.active?.id;
  const host = !id || cloud.isHost;
  const contextKey = `${cloud.user?.id ?? ""}/${id ?? "local"}`;
  const contextRef = useRef(contextKey);
  contextRef.current = contextKey;
  async function refresh() {
    if (id && !host) return;
    const result = id
      ? (await api<{ entries: HistoryEntry[] }>(`/api/decks/${id}/history`))
          .entries
      : await localVersions();
    if (contextRef.current === contextKey) setEntries(result);
  }
  useEffect(() => {
    setEntries([]);
    setPreview(undefined);
    void refresh().catch((error) => {
      if (contextRef.current === contextKey) setMessage(error.message);
    });
  }, [contextKey]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("処理しています…");
    try {
      await action();
      await refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h3>作品の版を保存・復元</h3>
      <p>
        削除前と定期的な自動保存、名前を付けた版から戻せます。最大10版・20MBです。古い版は順に整理されます。復元は別作品として作成し、共有権限は引き継ぎません。
      </p>
      {!host ? (
        <p>保存した版の確認・復元はホストだけが行えます。</p>
      ) : (
        <>
          <div className="backup-actions">
            <button
              className="button outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setMessage("版一覧を更新しました。");
                })
              }
            >
              版一覧を更新
            </button>
            <input
              aria-label="保存する版の名前"
              value={label}
              maxLength={80}
              onChange={(e) => setLabel(e.target.value)}
            />
            <button
              className="button primary"
              disabled={busy || !label.trim()}
              onClick={() =>
                void run(async () => {
                  if (id) {
                    await cloud.prepareBackup();
                    await api(`/api/decks/${id}/history`, {
                      method: "POST",
                      body: JSON.stringify({ label: label.trim() }),
                    });
                  } else await saveLocalVersion(book, label.trim());
                  setMessage("版を保存しました。");
                })
              }
            >
              版を保存
            </button>
          </div>
          {!entries.length && <p>保存した版はまだありません。</p>}
          {entries.map((e) => (
            <article className="backup-preview" key={e.id}>
              <strong>
                {e.reason} · {e.title}
              </strong>
              <p>
                {new Date(e.created).toLocaleString("ja-JP")} ·{" "}
                {(e.bytes / 1e6).toFixed(2)}MB
              </p>
              <button
                className="button outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    setPreview(
                      id
                        ? (
                            await api<{ snapshot: BackupSnapshot }>(
                              `/api/decks/${id}/history/${e.id}`,
                            )
                          ).snapshot
                        : (await localVersions()).find((v) => v.id === e.id)!
                            .snapshot,
                    );
                    setMessage("保存した版を表示しています。");
                  })
                }
              >
                この版を確認
              </button>
            </article>
          ))}
          {preview && (
            <section className="backup-preview" aria-label="過去の版の確認">
              <h4>
                {preview.deck.title} · {preview.deck.slides.length}枚 / 付箋
                {preview.comments.length}枚
              </h4>
              <div className="history-preview-pages">
                {preview.deck.slides.map((s) => (
                  <div key={s.id}>
                    <span>{slideLabel(preview.deck, s)}</span>
                    {!book.slides.some((p) => p.id === s.id) && (
                      <strong> 削除されたページ</strong>
                    )}
                  </div>
                ))}
              </div>
              <Canvas slide={preview.deck.slides[0]} zoom={0.35} />
              <button
                className="button primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (id) {
                      controller.current = new AbortController();
                      const signal = controller.current.signal;
                      await cloud.prepareBackup();
                      const { createBackupInWorker, readBackupInWorker } =
                        await import("./backupWorker");
                      const blob = await createBackupInWorker(
                        preview,
                        id,
                        setMessage,
                        signal,
                      );
                      const loaded = await readBackupInWorker(blob, signal);
                      const intentKey = `vhslide-history-restore:${cloud.user!.id}:${id}:${loaded.fingerprint}`;
                      let intent: { key: string; job?: string };
                      try {
                        intent = JSON.parse(
                          localStorage.getItem(intentKey) ?? "null",
                        );
                      } catch {
                        intent = { key: "" };
                      }
                      if (intent?.job) {
                        const status = await api<{ status: string }>(
                          `/api/restores/${intent.job}`,
                        ).catch(() => undefined);
                        if (
                          status?.status === "cancelled" ||
                          status?.status === "cancelling"
                        )
                          intent = { key: "" };
                      }
                      if (!intent || !validDigest(intent.key))
                        intent = { key: await digestText(crypto.randomUUID()) };
                      // Persist before creating a server job; reload/retry reuses this key.
                      localStorage.setItem(intentKey, JSON.stringify(intent));
                      const target = await restoreFullBackup(
                        loaded,
                        false,
                        setMessage,
                        signal,
                        {
                          newCopy: true,
                          requestKey: intent.key,
                          onJob: (job) => {
                            try {
                              localStorage.setItem(
                                intentKey,
                                JSON.stringify({ ...intent, job }),
                              );
                            } catch {
                              /* The original key remains usable. */
                            }
                          },
                        },
                      );
                      signal.throwIfAborted();
                      await cloud.refresh();
                      await cloud.open(target);
                      localStorage.removeItem(intentKey);
                    } else {
                      await saveLocalVersion(book, "復元前の作品");
                      onLocalRestore?.({
                        ...preview.deck,
                        title: `${preview.deck.title.slice(0, 190)}（復元）`,
                      });
                    }
                    setPreview(undefined);
                    setMessage("別作品として復元しました。");
                  })
                }
              >
                この版を別作品に復元
              </button>
              <button className="quiet" onClick={() => setPreview(undefined)}>
                確認を閉じる
              </button>
            </section>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
