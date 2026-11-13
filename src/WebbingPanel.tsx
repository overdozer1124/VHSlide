import { useEffect, useRef, useState } from "react";
import { useActivityPanel } from "./ActivitiesPanel";
import { useWebbing } from "./WebbingContext";
import { useGroups } from "./GroupsContext";
import type { WebbingView } from "./webbing";
import { usePageVisible } from "./usePageVisible";

export function WebbingPanel({
  host,
  onEmbed,
}: {
  host: boolean;
  onEmbed?: (map: WebbingView) => void;
}) {
  const ctx = useWebbing();
  const groupsCtx = useGroups();
  const activity = useActivityPanel();
  const open = activity.open && activity.active === "webbing";
  const visible = usePageVisible();
  const [title, setTitle] = useState("");
  const [grouped, setGrouped] = useState(false);
  const [groupNames, setGroupNames] = useState(
    "グループ1\nグループ2\nグループ3\nグループ4",
  );
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteId, setDeleteId] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!open || !ctx.enabled || !visible) return;
    void ctx.refresh().catch((e: Error) => {
      if (alive.current) setError(e.message);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ctx.enabled, visible]);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      if (alive.current) setMessage(done);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return (
    <div className="webbing-panel">
      <p className="webbing-panel-note">
        1つのマップに全員で書き込む「ウェビングマップ」です。書き込みは、書いた本人とホストだけが編集・削除できます。誰かが編集中の項目はロックされ、他の人は触れません。
      </p>
      {ctx.error && (
        <p role="alert" className="webbing-panel-error">
          {ctx.error}
        </p>
      )}
      {host && groupsCtx.enabled && (
        <div className="webbing-groups-summary">
          {groupsCtx.groups.length ? (
            <p>
              この作品のグループ：
              {groupsCtx.groups
                .map((g) => `${g.name}（${g.memberCount}人）`)
                .join("、")}
              <br />
              グループは作品全体で共通です。グループ分けを使う活動（ウェビングマップなど）すべてで、同じグループ・同じ参加者が使われます。
            </p>
          ) : (
            <p>
              この作品にはまだグループがありません。グループ分けのマップを作るときに設定できます。
            </p>
          )}
        </div>
      )}
      {host && (
        <form
          className="webbing-create"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            void run(
              async () => {
                await ctx.command(undefined, undefined, {
                  title: title.trim(),
                  grouped,
                });
                setTitle("");
              },
              "ウェビングマップを作成しました。受付を開始すると配置できます。",
            );
          }}
        >
          <label>
            中心のテーマ
            <input
              value={title}
              maxLength={100}
              placeholder="例：将来の夢"
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="webbing-grouped-toggle">
            <input
              type="checkbox"
              checked={grouped}
              onChange={(e) => setGrouped(e.target.checked)}
            />
            グループごとに分ける（自分のグループだけで書き込み、他のグループは見るだけ）
          </label>
          {grouped && !groupsCtx.groups.length && (
            <div className="webbing-group-setup">
              <label>
                グループ名（1行に1つ）
                <textarea
                  value={groupNames}
                  rows={4}
                  onChange={(e) => setGroupNames(e.target.value)}
                />
              </label>
              <button
                className="button outline"
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      groupsCtx.command("create", {
                        names: groupNames
                          .split("\n")
                          .map((n) => n.trim())
                          .filter(Boolean),
                      }),
                    "グループを作成しました。",
                  )
                }
              >
                この内容でグループを作成
              </button>
              <p className="webbing-map-meta">
                グループを作成してから、マップを作成してください。
              </p>
            </div>
          )}
          <button
            className="button"
            type="submit"
            disabled={busy || !title.trim() || (grouped && !groupsCtx.groups.length)}
          >
            マップを作成
          </button>
        </form>
      )}
      {!ctx.enabled && (
        <p>クラウド作品を開くと、ウェビングマップを使えます。</p>
      )}
      {ctx.enabled && ctx.maps.length === 0 && (
        <p>
          {host
            ? "まだマップがありません。中心のテーマを決めて作成してください。"
            : "開いているマップはまだありません。"}
        </p>
      )}
      <div className="webbing-map-list">
        {ctx.maps.map((map) => (
          <article key={map.id} className="webbing-map-card">
            <header>
              <h3>{map.title}</h3>
              <span
                className={`webbing-chip ${map.status === "open" ? "is-open" : ""}`}
              >
                {map.status === "open"
                  ? "書き込み受付中"
                  : map.status === "closed"
                    ? "受付終了"
                    : "準備中"}
              </span>
              {map.grouped && <span className="webbing-chip">グループ別</span>}
            </header>
            <p className="webbing-map-meta">
              書き込み{map.nodes.length}件（中心のテーマを含む）
            </p>
            {host && (
              <div className="webbing-map-actions">
                {map.status !== "open" ? (
                  <button
                    className="button"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => ctx.command(map.id, "status", { status: "open" }),
                        "書き込みの受付を開始しました。",
                      )
                    }
                  >
                    受付を開始
                  </button>
                ) : (
                  <button
                    className="button outline"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          ctx.command(map.id, "status", { status: "closed" }),
                        "書き込みの受付を終了しました。",
                      )
                    }
                  >
                    受付を終了
                  </button>
                )}
                <button
                  className="button outline"
                  type="button"
                  disabled={busy || map.status === "draft"}
                  title={
                    map.status === "draft"
                      ? "受付を開始してから配置してください"
                      : undefined
                  }
                  onClick={() => {
                    try {
                      onEmbed?.(map);
                      activity.close();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  このマップをスライドに配置
                </button>
                {deleteId === map.id ? (
                  <>
                    <span className="webbing-confirm-text">
                      書き込みもすべて消えます。削除しますか？
                    </span>
                    <button
                      className="button danger"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await ctx.command(map.id, undefined, {}, "DELETE");
                          setDeleteId("");
                        }, "マップを削除しました。")
                      }
                    >
                      削除する
                    </button>
                    <button
                      className="button outline"
                      type="button"
                      onClick={() => setDeleteId("")}
                    >
                      やめる
                    </button>
                  </>
                ) : (
                  <button
                    className="button outline"
                    type="button"
                    disabled={busy}
                    onClick={() => setDeleteId(map.id)}
                  >
                    削除
                  </button>
                )}
              </div>
            )}
            {!host && (
              <p className="webbing-map-meta">
                書き込みは、スライド上のマップから行います。
              </p>
            )}
          </article>
        ))}
      </div>
      {error && (
        <p role="alert" className="webbing-panel-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="webbing-panel-message">
          {message}
        </p>
      )}
    </div>
  );
}
