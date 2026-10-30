import { accessLabel } from "./SharingManager";
import { useEffect, useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import type { CloudWorkspace } from "./cloud";
import type { LoadedBackup } from "./backupArchive";
import { MAX_BACKUP_BYTES } from "./backupData";
import {
  downloadFullBackup,
  restoreFullBackup,
  listRestoreTasks,
  cancelRestoreTask,
} from "./backupClient";
import type { RestoreTask } from "./backupProtocol";
export function BackupPanel({
  cloud,
  collapsed = false,
  onCollapse,
}: {
  cloud: CloudWorkspace;
  collapsed?: boolean;
  onCollapse?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null),
    controller = useRef<AbortController | undefined>(undefined);
  const [backup, setBackup] = useState<LoadedBackup>(),
    [applySharing, setApplySharing] = useState(false),
    [message, setMessage] = useState(""),
    [working, setWorking] = useState(false),
    [jobs, setJobs] = useState<RestoreTask[]>([]),
    [resume, setResume] = useState<RestoreTask>(),
    [jobId, setJobId] = useState<string>();
  const [jobsError, setJobsError] = useState("");
  async function refreshJobs() {
    try {
      const next = await listRestoreTasks();
      setJobs(next);
      setJobsError("");
      return next;
    } catch (error) {
      setJobsError((error as Error).message);
      throw error;
    }
  }
  useEffect(() => {
    if (cloud.user) void refreshJobs().catch(() => {});
  }, [cloud.user?.id]);
  useEffect(() => () => controller.current?.abort(), []);
  async function read(file: File) {
    if (cloud.busy || working) return;
    setWorking(true);
    setMessage("バックアップを確認しています…");
    setBackup(undefined);
    setApplySharing(false);
    try {
      if (file.size > MAX_BACKUP_BYTES)
        throw new Error("バックアップは300MBまでです。");
      controller.current = new AbortController();
      const { readBackupInWorker } = await import("./backupWorker");
      setBackup(
        await readBackupInWorker(file, controller.current.signal, setMessage),
      );
      setMessage("");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      controller.current = undefined;
      setWorking(false);
    }
  }
  const important =
    working ||
    !!backup ||
    !!message ||
    !!resume ||
    !!jobsError ||
    jobs.some((j) => j.status !== "ready");
  return (
    <section
      className="backup-panel"
      aria-label="完全バックアップと復元"
      hidden={collapsed && !important}
    >
      <div className="backup-panel-heading">
        <h3>バックアップと復元</h3>
        {onCollapse && !important && (
          <button
            className="quiet"
            aria-label="バックアップと復元を閉じる"
            onClick={onCollapse}
          >
            閉じる
          </button>
        )}
      </div>
      {jobsError && (
        <div role="alert" className="backup-job-error">
          <p>未完了の復元を確認できません。{jobsError}</p>
          <button
            className="button outline"
            onClick={() =>
              void refreshJobs()
                .then((next) => {
                  if (collapsed && next.every((j) => j.status === "ready"))
                    onCollapse?.();
                })
                .catch(() => {})
            }
          >
            未完了の復元を再確認
          </button>
        </div>
      )}
      <p>
        写真・付箋・見出し・共有設定をまとめて保存します。元の作品は上書きされません。同じファイルと共有設定で再実行すると、前回の復元先を開きます。
      </p>
      {jobs.some((j) => j.status !== "ready") && (
        <div className="backup-preview" aria-label="未完了の復元">
          <strong>未完了の復元</strong>
          <p>
            同じバックアップファイルを選ぶと、送信済みの写真を再利用して再開できます。共有設定は再度確認してください。
          </p>
          {jobs
            .filter((j) => j.status !== "ready")
            .map((j) => (
              <div key={j.id} className="backup-actions">
                <span>
                  {j.title} · {j.images}点の写真 ·{" "}
                  {j.status === "room_committed"
                    ? "確定待ち"
                    : j.status === "cancelling"
                      ? "取り消し処理中"
                      : "復元途中"}
                  {j.applySharing ? " · 共有設定あり" : " · 共有設定なし"}
                </span>
                {j.status !== "cancelling" && (
                  <button
                    className="button outline"
                    disabled={working || cloud.busy}
                    onClick={() => {
                      setResume(j);
                      setBackup(undefined);
                      input.current?.click();
                    }}
                  >
                    ファイルを選んで再開
                  </button>
                )}
                <button
                  className="quiet"
                  disabled={working || cloud.busy}
                  onClick={() => {
                    void cloud.run(async () => {
                      try {
                        await cancelRestoreTask(j.id);
                        setMessage("復元を取り消しました。");
                        if (resume?.id === j.id) {
                          setResume(undefined);
                          setBackup(undefined);
                        }
                      } finally {
                        await refreshJobs();
                        await cloud.refresh();
                      }
                    });
                  }}
                >
                  この復元を取り消す
                </button>
              </div>
            ))}
        </div>
      )}
      {!cloud.active && (
        <p role="status">
          完全バックアップを作るには、クラウドの作品を開いてください。ファイルからの復元は新しい作品を作成します。
        </p>
      )}
      {cloud.active && !cloud.isHost && (
        <p role="status">
          完全バックアップを作成できるのはホストだけです。JSON・PDFは上部の保存メニューから利用できます。
        </p>
      )}
      {cloud.active && cloud.isHost && !cloud.readyForBackupRestore && (
        <p role="status">
          本文・付箋の保存完了と接続を確認してから、完全バックアップを作成できます。
        </p>
      )}
      <div className="backup-actions">
        {cloud.active && cloud.isHost && (
          <button
            className="button outline"
            disabled={cloud.busy || working || !cloud.readyForBackupRestore}
            onClick={() => {
              setWorking(true);
              controller.current = new AbortController();
              setMessage("バックアップを作成しています…");
              void cloud.run(async () => {
                try {
                  await cloud.prepareBackup();
                  await downloadFullBackup(
                    cloud.active!.id,
                    setMessage,
                    controller.current!.signal,
                  );
                  setMessage(
                    "ZIPファイルを作成しました。ダウンロード先を確認してください（.vhslide.zip）。",
                  );
                } catch (error) {
                  setMessage((error as Error).message);
                } finally {
                  controller.current = undefined;
                  setWorking(false);
                }
              });
            }}
          >
            <Download size={17} />
            完全バックアップを保存
          </button>
        )}
        <button
          className="button outline"
          disabled={cloud.busy || working}
          onClick={() => {
            setResume(undefined);
            input.current?.click();
          }}
        >
          <Upload size={17} />
          バックアップから復元
        </button>
        <input
          ref={input}
          type="file"
          accept=".zip,.vhslide.zip"
          aria-label="復元するバックアップ"
          hidden
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (file) void read(file);
          }}
        />
      </div>
      <small>
        クラウドに保存済みの内容を保存します。保存中・切断中は完了を待ってください。付箋の保存エラーは編集画面で再試行してください。
      </small>
      <small>
        共有アカウントのメールアドレスを含みます。ファイルは大切に保管してください。認証情報・招待リンク・過去の版は含みません。
      </small>
      {backup && (
        <div className="backup-preview" aria-label="復元内容の確認">
          <strong>{backup.snapshot.deck.title}</strong>
          <p>
            {backup.snapshot.deck.slides.length}枚のスライド /{" "}
            {backup.images.size}点の写真 / {backup.snapshot.comments.length}
            枚の付箋 / {backup.snapshot.sharing.length}件の共有設定
          </p>
          <p>
            復元した写真にも保存容量を使用します。空き容量が不足すると復元できません。
          </p>
          <p>
            付箋は元の投稿者名に「復元」を付けて表示し、管理者はあなたになります。
          </p>
          {resume && (
            <p>
              「{resume.title}」を再開します。前回と同じ共有設定（
              {resume.applySharing ? "あり" : "なし"}）を確認してください。
            </p>
          )}
          <label>
            <input
              type="checkbox"
              checked={applySharing}
              disabled={working}
              onChange={(e) => setApplySharing(e.target.checked)}
            />
            共有アカウントと編集権限も確認して復元する
          </label>
          {applySharing && (
            <ul
              className="backup-sharing-preview"
              aria-label="復元する共有アカウント"
            >
              {backup.snapshot.sharing.map((p) => (
                <li key={p.email}>
                  <strong>{p.name || p.email}</strong> {p.email} —{" "}
                  {accessLabel(p.access, backup.snapshot.deck)}
                  {p.access.comment ? "・付箋可" : ""}
                </li>
              ))}
            </ul>
          )}
          <div className="backup-actions">
            <button
              className="button primary"
              disabled={
                cloud.busy ||
                working ||
                (resume?.applySharing !== null &&
                  resume?.applySharing !== undefined &&
                  resume.applySharing !== applySharing)
              }
              onClick={() => {
                if (!cloud.readyForBackupRestore) {
                  setMessage(
                    "現在の作品の保存を待つか、未送信の変更をJSONで保存してから開き直してください。",
                  );
                  return;
                }
                setWorking(true);
                controller.current = new AbortController();
                void cloud.run(async () => {
                  try {
                    await cloud.prepareBackup();
                    const id = await restoreFullBackup(
                      backup,
                      applySharing,
                      setMessage,
                      controller.current!.signal,
                      { resumeId: resume?.id, onJob: setJobId },
                    );
                    setBackup(undefined);
                    setResume(undefined);
                    setMessage("復元先の作品を開きました。");
                    await cloud.refresh();
                    await cloud.open(id);
                  } catch (error) {
                    setMessage(
                      (error as Error).name === "AbortError"
                        ? "復元を中断しました。未完了の復元から再開・取り消しできます。"
                        : (error as Error).message,
                    );
                    await cloud.refresh();
                  } finally {
                    setWorking(false);
                    controller.current = undefined;
                    setJobId(undefined);
                    await refreshJobs();
                  }
                });
              }}
            >
              {resume ? "復元を再開する" : "新しい作品に復元する"}
            </button>
            {working ? (
              <button
                className="button outline"
                disabled={!jobId}
                onClick={() => {
                  controller.current?.abort();
                  if (jobId)
                    void cancelRestoreTask(jobId)
                      .then(async () => {
                        setMessage(
                          "復元を取り消しました。元の作品は変更していません。",
                        );
                        await refreshJobs();
                        await cloud.refresh();
                      })
                      .catch((error) =>
                        setMessage(
                          `${error.message} 作品一覧で状態を確認してください。`,
                        ),
                      );
                }}
              >
                復元を取り消す
              </button>
            ) : (
              <button className="quiet" onClick={() => setBackup(undefined)}>
                閉じる
              </button>
            )}
          </div>
        </div>
      )}
      {working && !jobId && (
        <button
          className="button outline"
          onClick={() => controller.current?.abort()}
        >
          処理を中断する
        </button>
      )}
      {message && (
        <p role="status" className="backup-message">
          {message}
        </p>
      )}
    </section>
  );
}
