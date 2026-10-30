import { useEffect, useRef, useState } from "react";
import { api } from "./cloud";
import type { CloudWorkspace } from "./cloud";
type Request = { id: string; name: string; email: string; created: number };
export function JoinRequests({
  cloud,
  workId,
  onApproved,
}: {
  cloud: CloudWorkspace;
  workId: string;
  onApproved: () => Promise<void>;
}) {
  const [requests, setRequests] = useState<Request[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const alive = useRef(true),
    fetching = useRef(false);
  async function refresh() {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const data = await api<{ requests: Request[] }>(
        `/api/decks/${workId}/join-requests`,
      );
      if (alive.current) {
        setRequests(data.requests);
        setSelected((ids) =>
          ids.filter((id) => data.requests.some((r) => r.id === id)),
        );
      }
    } catch (e) {
      if (alive.current) setMessage((e as Error).message);
    } finally {
      fetching.current = false;
    }
  }
  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 5000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [workId]);
  async function decide(ids: string[], approve = true) {
    setBusy(true);
    setMessage("");
    try {
      await api(
        `/api/decks/${workId}/join-requests/${approve ? "approve" : "reject"}`,
        { method: "POST", body: JSON.stringify({ requestIds: ids }) },
      );
      if (alive.current) {
        setSelected((previous) => previous.filter((id) => !ids.includes(id)));
        setMessage(
          `${ids.length}人の参加を${approve ? "承認" : "拒否"}しました。`,
        );
      }
      await onApproved();
    } catch (e) {
      if (alive.current) setMessage((e as Error).message);
    } finally {
      await refresh();
      if (alive.current) setBusy(false);
    }
  }
  const all = requests.length > 0 && selected.length === requests.length;
  return (
    <section className="join-requests" aria-label="参加待ちのアカウント">
      <div className="join-heading">
        <h3>
          参加待ち <span>{requests.length}人</span>
        </h3>
        <button
          className="quiet"
          disabled={busy || cloud.busy}
          onClick={() => void refresh()}
        >
          参加待ちを更新
        </button>
      </div>
      <p>
        氏名とメールアドレスを確認してください。承認するまで作品は見えません。承認後は作品全体の閲覧・保存と付箋コメントが可能になり、編集権限は下の共有一覧で設定します。
      </p>
      {!requests.length ? (
        <p>参加待ちのアカウントはありません。</p>
      ) : (
        <>
          <div className="join-bulk">
            <label>
              <input
                type="checkbox"
                aria-label="参加待ちを全選択"
                checked={all}
                ref={(el) => {
                  if (el) el.indeterminate = !!selected.length && !all;
                }}
                disabled={busy || cloud.busy}
                onChange={(e) =>
                  setSelected(e.target.checked ? requests.map((r) => r.id) : [])
                }
              />
              全選択
            </label>
            <span>{selected.length}人を選択</span>
            <button
              className="button primary"
              disabled={busy || cloud.busy || !selected.length}
              onClick={() => void decide(selected)}
            >
              選択したアカウントを承認
            </button>
            <button
              className="quiet"
              disabled={busy || cloud.busy || !selected.length}
              onClick={() => void decide(selected, false)}
            >
              選択したアカウントを拒否
            </button>
          </div>
          <ul>
            {requests.map((r) => (
              <li key={r.id}>
                <label>
                  <input
                    type="checkbox"
                    aria-label={`${r.email}の参加申請を選択`}
                    checked={selected.includes(r.id)}
                    disabled={busy || cloud.busy}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, r.id]
                          : selected.filter((id) => id !== r.id),
                      )
                    }
                  />
                  <span>
                    <strong>{r.name}</strong>
                    <span>{r.email}</span>
                    <small>{new Date(r.created).toLocaleString("ja-JP")}</small>
                  </span>
                </label>
                <button
                  className="button outline"
                  aria-label={`${r.email}の参加を承認`}
                  disabled={busy || cloud.busy}
                  onClick={() => void decide([r.id])}
                >
                  承認
                </button>
                <button
                  className="quiet"
                  aria-label={`${r.email}の参加を拒否`}
                  disabled={busy || cloud.busy}
                  onClick={() => void decide([r.id], false)}
                >
                  拒否
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
