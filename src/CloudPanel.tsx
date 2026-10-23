import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  Check,
  Cloud,
  Copy,
  FolderOpen,
  Link2,
  LogOut,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type { Deck } from "./model";
import { api, CloudWorkspace } from "./cloud";
import type { Recipient } from "./preSharing";
import { SharingManager } from "./SharingManager";
import type { SharingMember } from "./SharingManager";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (result: { credential: string }) => void;
          }) => void;
          renderButton: (
            element: HTMLElement,
            options: Record<string, unknown>,
          ) => void;
        };
      };
    };
  }
}
export function CloudPanel({
  cloud,
  deck,
  onLocal,
}: {
  cloud: CloudWorkspace;
  deck: Deck;
  onLocal: () => void;
}) {
  const button = useRef<HTMLDivElement>(null),
    dialog = useRef<HTMLElement>(null),
    closeButton = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState<"library" | "sharing">(
    cloud.active ? "sharing" : "library",
  );
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState("");
  const [members, setMembers] = useState<SharingMember[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loginError, setLoginError] = useState("");
  const [query, setQuery] = useState(""),
    [listFilter, setListFilter] = useState("all");
  const [loadingSharing, setLoadingSharing] = useState(false);
  const requestEpoch = useRef(0);
  const own = !!cloud.active && cloud.active.owner === cloud.user?.id;
  function close() {
    cloud.panel = false;
    cloud.onState();
  }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(""), 2500);
    return () => clearTimeout(timer);
  }, [copied]);
  async function refreshSharing() {
    const id = cloud.active?.id,
      epoch = ++requestEpoch.current;
    if (!id) return;
    setLoadingSharing(true);
    try {
      const [m, r] = await Promise.all([
        api<{ members: SharingMember[] }>(`/api/decks/${id}/members`),
        api<{ recipients: Recipient[] }>(`/api/decks/${id}/recipients`),
      ]);
      if (cloud.active?.id === id && epoch === requestEpoch.current) {
        setMembers(m.members);
        setRecipients(r.recipients);
      }
    } finally {
      if (epoch === requestEpoch.current) setLoadingSharing(false);
    }
  }
  function report(error: unknown) {
    cloud.error = (error as Error).message;
    cloud.onState();
  }
  useEffect(() => {
    setLink("");
    setMembers([]);
    setRecipients([]);
    if (own) void refreshSharing().catch(report);
  }, [cloud.active?.id, cloud.user?.id]);
  useEffect(() => {
    if (cloud.user || !cloud.clientId) return;
    let alive = true;
    function render() {
      if (!alive || !button.current || !window.google) return;
      window.google.accounts.id.initialize({
        client_id: cloud.clientId,
        callback: (result) => void cloud.signIn(result.credential),
      });
      window.google.accounts.id.renderButton(button.current, {
        theme: "outline",
        size: "large",
        locale: "ja",
        text: "signin_with",
      });
    }
    if (window.google) render();
    else {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = render;
      script.onerror = () => {
        if (alive)
          setLoginError(
            "Googleのサインインを読み込めませんでした。接続を確認して開き直してください。",
          );
      };
      document.head.appendChild(script);
      return () => {
        alive = false;
        script.remove();
      };
    }
    return () => {
      alive = false;
    };
  }, [cloud, cloud.user, cloud.clientId]);
  async function copy(value: string, kind: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
    } catch {
      setLoginError("リンク欄を選択してコピーしてください。");
    }
  }
  const works = [...cloud.decks]
    .filter(
      (saved) =>
        (!query.trim() ||
          saved.title.toLowerCase().includes(query.trim().toLowerCase())) &&
        (listFilter === "all" ||
          (saved.owner === cloud.user?.id
            ? listFilter === "own"
            : listFilter === "joined")),
    )
    .sort((a, b) => b.updated - a.updated);
  return createPortal(
    <div
      className="cloud-overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        ref={dialog}
        className="cloud-panel"
        role="dialog"
        aria-modal="true"
        aria-label="クラウドの作品"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          }
          if (event.key === "Tab") {
            const items = [
              ...(dialog.current?.querySelectorAll<HTMLElement>(
                'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],summary,[tabindex="0"]',
              ) ?? []),
            ].filter((e) => e.offsetParent !== null);
            const first = items[0],
              last = items.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header className="cloud-panel-heading">
          <div>
            <h2>
              <Cloud size={24} />
              クラウドの作品
            </h2>
            <p>作品を開く・共有する・編集できる範囲を決める</p>
          </div>
          {cloud.user && (
            <div className="cloud-account">
              <span className="cloud-account-name">
                <span className="account-avatar">
                  {cloud.user.name.slice(0, 1)}
                </span>
                <span>
                  {cloud.user.name}
                  <small>{cloud.user.email}</small>
                </span>
              </span>
              <button
                className="quiet"
                aria-label="サインアウト"
                disabled={cloud.busy}
                onClick={() =>
                  void cloud.signOut().then(() => {
                    if (!cloud.user) onLocal();
                  })
                }
              >
                <LogOut size={15} />
                <span>サインアウト</span>
              </button>
            </div>
          )}
          <button
            ref={closeButton}
            className="icon-button"
            aria-label="クラウドの作品を閉じる"
            onClick={close}
          >
            <X size={22} />
          </button>
        </header>
        {cloud.user && (
          <>
            {cloud.active && (
              <div className="cloud-current-work">
                <div>
                  <span className="cloud-eyebrow">開いている作品</span>
                  <strong>{deck.title}</strong>
                </div>
                <span className="cloud-role">
                  <ShieldCheck size={15} />
                  {own ? "ホスト" : "参加中"}
                </span>
              </div>
            )}
            <div
              className="cloud-tabs"
              role="tablist"
              aria-label="クラウド画面の切り替え"
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? "library"
                    : event.key === "End"
                      ? "sharing"
                      : tab === "library"
                        ? "sharing"
                        : "library";
                setTab(next);
                document.getElementById(`cloud-${next}-tab`)?.focus();
              }}
            >
              <button
                id="cloud-library-tab"
                role="tab"
                aria-selected={tab === "library"}
                tabIndex={tab === "library" ? 0 : -1}
                aria-controls="cloud-library"
                onClick={() => setTab("library")}
              >
                <FolderOpen size={18} />
                作品一覧<span>{cloud.decks.length}</span>
              </button>
              <button
                id="cloud-sharing-tab"
                role="tab"
                aria-selected={tab === "sharing"}
                tabIndex={tab === "sharing" ? 0 : -1}
                aria-controls="cloud-sharing"
                onClick={() => setTab("sharing")}
              >
                <Users size={18} />
                共有管理
              </button>
            </div>
          </>
        )}
        <div className="cloud-panel-feedback">
          {cloud.busy && <p role="status">処理しています…</p>}
          {cloud.error && (
            <p className="cloud-error" role="alert">
              {cloud.error}
            </p>
          )}
          {loginError && (
            <p className="cloud-error" role="alert">
              {loginError}
            </p>
          )}
        </div>
        <div className="cloud-panel-body">
          {!cloud.user ? (
            <div className="cloud-welcome">
              <Cloud size={42} />
              <h3>作品を保存して、みんなでつくろう</h3>
              <p>
                Googleアカウントでサインインすると、作品の保存や共同編集ができます。
              </p>
              {cloud.clientId ? (
                <div ref={button} className="google-signin" />
              ) : (
                <p role="status">
                  クラウド機能は準備中です。端末での編集とJSON保存はそのまま使えます。
                </p>
              )}
            </div>
          ) : (
            <>
              <section
                id="cloud-library"
                role="tabpanel"
                aria-labelledby="cloud-library-tab"
                hidden={tab !== "library"}
              >
                <div className="cloud-library-heading">
                  <div>
                    <h3>保存した作品・参加した作品</h3>
                    <p>作品カードの「開く」から編集を始められます。</p>
                  </div>
                  <button
                    className="button primary"
                    disabled={cloud.busy}
                    onClick={() => void cloud.create(deck)}
                  >
                    <Cloud size={17} />
                    {cloud.active
                      ? "この作品のコピーを作る"
                      : "この作品をクラウドに保存"}
                  </button>
                </div>
                <div className="cloud-library-tools">
                  <label className="cloud-search">
                    <Search size={17} />
                    <input
                      aria-label="クラウドの作品を検索"
                      placeholder="作品名で検索"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <select
                    aria-label="作品の表示対象"
                    value={listFilter}
                    onChange={(e) => setListFilter(e.target.value)}
                  >
                    <option value="all">すべての作品</option>
                    <option value="own">自分の作品</option>
                    <option value="joined">参加している作品</option>
                  </select>
                  <button
                    className="quiet"
                    disabled={cloud.busy}
                    onClick={() => void cloud.run(() => cloud.refresh())}
                  >
                    <RefreshCw size={16} />
                    作品一覧を更新
                  </button>
                </div>
                <div className="cloud-deck-list">
                  {works.map((saved) => (
                    <article
                      className="cloud-deck"
                      data-current={cloud.active?.id === saved.id}
                      key={saved.id}
                    >
                      <button
                        className="cloud-deck-open"
                        disabled={cloud.busy}
                        aria-label={`作品を開く：${saved.title}`}
                        onClick={() => {
                          const reset =
                            cloud.active?.id === saved.id &&
                            cloud.needsAttention;
                          if (
                            !reset ||
                            window.confirm(
                              "未反映の変更は置き換わります。必要なJSONを保存してから、クラウドの内容を開き直してください。",
                            )
                          )
                            void cloud.run(() => cloud.open(saved.id, reset));
                        }}
                      >
                        <span className="cloud-deck-type">
                          <FolderOpen size={20} />
                          {saved.owner === cloud.user?.id
                            ? "自分の作品"
                            : "参加している作品"}
                          {cloud.active?.id === saved.id && (
                            <span>開いています</span>
                          )}
                        </span>
                        <strong>{saved.title}</strong>
                        <small>
                          更新：
                          {new Date(saved.updated).toLocaleString("ja-JP", {
                            month: "numeric",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </small>
                        <span className="cloud-deck-cta">
                          開く
                          <ArrowRight size={18} />
                        </span>
                      </button>
                      {saved.owner === cloud.user?.id && (
                        <button
                          className="icon-button cloud-deck-delete"
                          disabled={cloud.busy}
                          aria-label={`${saved.title}をクラウドから削除`}
                          title="作品を削除"
                          onClick={() => {
                            if (
                              window.confirm(
                                `「${saved.title}」をクラウドから削除します。共同編集者も開けなくなります。JSONを保存してから削除してください。`,
                              )
                            )
                              void cloud.run(async () => {
                                await api(`/api/decks/${saved.id}`, {
                                  method: "DELETE",
                                });
                                if (cloud.active?.id === saved.id) onLocal();
                                await cloud.refresh();
                              });
                          }}
                        >
                          <Trash2 size={17} />
                        </button>
                      )}
                    </article>
                  ))}
                </div>
                {!works.length && (
                  <div className="cloud-empty">
                    <FolderOpen size={32} />
                    <strong>
                      {cloud.decks.length
                        ? "一致する作品がありません"
                        : "まだ作品がありません"}
                    </strong>
                    <p>
                      {cloud.decks.length
                        ? "検索条件を変えてみてください。"
                        : "今つくっている作品をクラウドに保存すると、ここに並びます。"}
                    </p>
                  </div>
                )}
              </section>
              <section
                id="cloud-sharing"
                role="tabpanel"
                aria-labelledby="cloud-sharing-tab"
                hidden={tab !== "sharing"}
              >
                {!cloud.active ? (
                  <div className="cloud-empty">
                    <Users size={32} />
                    <strong>まず作品を開いてください</strong>
                    <p>
                      クラウドに保存した作品を開くと、共有相手や権限を設定できます。
                    </p>
                    <button
                      className="button outline"
                      onClick={() => setTab("library")}
                    >
                      作品一覧を見る
                    </button>
                  </div>
                ) : !own ? (
                  <div className="cloud-empty">
                    <ShieldCheck size={32} />
                    <h3>共有された作品です</h3>
                    <p>
                      {cloud.access.mode === "none"
                        ? "現在は閲覧のみです。編集の権限はホストが設定します。"
                        : cloud.access.mode === "scoped"
                          ? "ホストが指定した範囲を編集できます。"
                          : "すべてのスライドを編集できます。"}
                    </p>
                    <small>共有相手の追加や権限変更はホストが行います。</small>
                  </div>
                ) : (
                  <div className="cloud-sharing-grid">
                    <div>
                      {loadingSharing && (
                        <p role="status">共有アカウントを読み込んでいます…</p>
                      )}
                      <SharingManager
                        key={cloud.active.id}
                        cloud={cloud}
                        deck={deck}
                        members={members}
                        recipients={recipients}
                        refresh={refreshSharing}
                        onRecipients={(items) => {
                          setRecipients(items);
                          void refreshSharing().catch(report);
                        }}
                      />
                    </div>
                    <aside className="cloud-link-panel" aria-label="共有リンク">
                      <h3>
                        <Link2 size={18} />
                        リンクを共有
                      </h3>
                      <p>
                        登録したアカウントには、この作品のリンクを伝えてください。
                      </p>
                      <label>
                        作品リンク
                        <input
                          aria-label="事前共有した作品のリンク"
                          readOnly
                          value={`${location.origin}/?room=${cloud.active.id}`}
                          onFocus={(e) => e.currentTarget.select()}
                        />
                      </label>
                      <button
                        className="button outline"
                        onClick={() =>
                          void copy(
                            `${location.origin}/?room=${cloud.active!.id}`,
                            "work",
                          )
                        }
                      >
                        <Copy size={16} />
                        作品リンクをコピー
                      </button>
                      <span role="status" className="cloud-copy-feedback">
                        {copied === "work" ? "コピーしました" : ""}
                      </span>
                      <div className="cloud-invite-section">
                        <h4>招待リンクから参加</h4>
                        <p>
                          未登録の相手も参加できます。最初は閲覧・付箋コメントのみで、編集権限は後から設定します。
                        </p>
                        <button
                          className="button outline"
                          disabled={cloud.busy}
                          onClick={() =>
                            void cloud.run(async () => {
                              setLink(
                                (
                                  await api<{ url: string }>(
                                    `/api/decks/${cloud.active!.id}/invite`,
                                    { method: "POST" },
                                  )
                                ).url,
                              );
                            })
                          }
                        >
                          共同編集の招待リンクを作る
                        </button>
                        {link && (
                          <div className="cloud-invite">
                            <input
                              aria-label="共同編集の招待リンク"
                              readOnly
                              value={link}
                              onFocus={(e) => e.currentTarget.select()}
                            />
                            <button
                              className="icon-button"
                              aria-label="招待リンクをコピー"
                              onClick={() => void copy(link, "invite")}
                            >
                              {copied === "invite" ? (
                                <Check size={18} />
                              ) : (
                                <Copy size={18} />
                              )}
                            </button>
                          </div>
                        )}
                        <span role="status" className="cloud-copy-feedback">
                          {copied === "invite" ? "コピーしました" : ""}
                        </span>
                        <button
                          className="quiet"
                          disabled={cloud.busy}
                          onClick={() =>
                            void cloud.run(async () => {
                              await api(
                                `/api/decks/${cloud.active!.id}/invite`,
                                { method: "DELETE" },
                              );
                              setLink("");
                              setCopied("revoked");
                            })
                          }
                        >
                          招待リンクを無効にする
                        </button>
                        {copied === "revoked" && (
                          <small role="status">
                            招待リンクを無効にしました
                          </small>
                        )}
                        <small>
                          作り直すと、以前の招待リンクは使えなくなります。
                        </small>
                      </div>
                    </aside>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
        <footer className="cloud-panel-footer">
          {cloud.notice && (
            <details>
              <summary>保存容量とご利用について</summary>
              <p>{cloud.notice}</p>
            </details>
          )}
          {cloud.active && (
            <button className="quiet" disabled={cloud.busy} onClick={onLocal}>
              端末の作品へ戻る
            </button>
          )}
          <span>JSONで端末にも保存できます</span>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
