import { ActionMenu } from "./ActionMenu";
import { JoinRequests } from "./JoinRequests";
import { CacheRecoveryNotice } from "./CacheRecoveryNotice";
import { CloudTrash } from "./CloudTrash";
import { BackupPanel } from "./BackupPanel";
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
  initialTab,
}: {
  cloud: CloudWorkspace;
  deck: Deck;
  onLocal: () => void;
  initialTab?: "library";
}) {
  const button = useRef<HTMLDivElement>(null),
    dialog = useRef<HTMLElement>(null),
    closeButton = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState<"library" | "sharing">(
    initialTab ??
      (cloud.active && !cloud.needsAttention ? "sharing" : "library"),
  );
  const [trashOpen, setTrashOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const backupArea = useRef<HTMLDivElement>(null);
  const trashArea = useRef<HTMLDivElement>(null);
  function returnToLibraryMore() {
    requestAnimationFrame(() =>
      dialog.current
        ?.querySelector<HTMLButtonElement>('[aria-label="作品一覧のその他"]')
        ?.focus({ preventScroll: true }),
    );
  }
  useEffect(() => {
    if (backupOpen)
      backupArea.current
        ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
        ?.focus({ preventScroll: true });
  }, [backupOpen]);
  useEffect(() => {
    if (trashOpen)
      trashArea.current
        ?.querySelector<HTMLHeadingElement>("h3")
        ?.focus({ preventScroll: true });
  }, [trashOpen]);
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState("");
  const [members, setMembers] = useState<SharingMember[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loginError, setLoginError] = useState("");
  const [loginType, setLoginType] = useState<"general" | "school">("general");
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
  useEffect(() => {
    if (!cloud.user || tab !== "library") return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        void cloud.refresh().catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [cloud, cloud.user?.id, tab]);
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
    const selectedClientId =
      loginType === "school" && cloud.schoolClientId
        ? cloud.schoolClientId
        : cloud.clientId;
    let alive = true;
    function render() {
      if (!alive || !button.current || !window.google) return;
      window.google.accounts.id.initialize({
        client_id: selectedClientId,
        callback: (result) => void cloud.signIn(result.credential),
      });
      button.current.replaceChildren();
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
  }, [
    cloud,
    cloud.user,
    cloud.clientId,
    cloud.schoolClientId,
    cloud.schoolDomain,
    loginType,
  ]);
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
        className={`cloud-panel ${cloud.joinRequest ? "cloud-join-waiting" : ""}`}
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
              {cloud.joinRequest ? "参加申請" : "クラウドの作品"}
            </h2>
            <p>
              {cloud.joinRequest
                ? "ホストの承認後に作品へ参加できます"
                : "作品を開く・共有する・編集できる範囲を決める"}
            </p>
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
            {cloud.joinRequest && (
              <section className="join-waiting" aria-label="参加申請の状況">
                <h3>
                  {cloud.joinRequest.status === "pending"
                    ? "ホストの承認を待っています"
                    : cloud.joinRequest.status === "rejected"
                      ? "参加は承認されませんでした"
                      : "参加申請は失効しました"}
                </h3>
                <p>
                  {cloud.joinRequest.status === "pending"
                    ? "参加を申請しました。承認されると作品が開きます。この画面を閉じている間は自動で切り替わりません。"
                    : "ホストに確認し、必要な場合は新しい招待リンクを受け取ってください。"}
                </p>
                <button
                  className="button outline"
                  disabled={cloud.busy}
                  onClick={() => void cloud.refreshJoinRequest()}
                >
                  承認状況を確認
                </button>
              </section>
            )}
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
            {!cloud.joinRequest && (
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
            )}
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
          {cloud.joinRequest ? null : !cloud.user ? (
            <div className="cloud-welcome">
              <Cloud size={42} />
              <h3>作品を保存して、みんなでつくろう</h3>
              <p>
                Googleアカウントでサインインすると、作品の保存や共同編集ができます。
              </p>
              {cloud.clientId ? (
                <>
                  {cloud.schoolClientId && (
                    <fieldset className="google-account-choice">
                      <legend>使用するアカウント</legend>
                      <label>
                        <input
                          type="radio"
                          name="google-account-type"
                          value="general"
                          checked={loginType === "general"}
                          onChange={() => setLoginType("general")}
                        />
                        一般のGoogleアカウント
                      </label>
                      <label>
                        <input
                          type="radio"
                          name="google-account-type"
                          value="school"
                          checked={loginType === "school"}
                          onChange={() => setLoginType("school")}
                        />
                        加賀市の学校アカウント
                      </label>
                    </fieldset>
                  )}
                  <div ref={button} className="google-signin" />
                </>
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
                  <div className="cloud-library-actions">
                    <ActionMenu
                      label="作品一覧のその他"
                      text="その他"
                      showLabel
                      portal
                      portalContainer={() => dialog.current}
                      items={[
                        {
                          label: "ごみ箱を開く",
                          action: () => setTrashOpen(true),
                        },
                        {
                          label: "バックアップと復元",
                          action: () => setBackupOpen(true),
                        },
                      ]}
                    />
                    <button
                      className="button primary"
                      disabled={
                        cloud.busy ||
                        (!!cloud.active &&
                          !cloud.isHost &&
                          !!deck.restrictGuests)
                      }
                      title={
                        cloud.active && !cloud.isHost && deck.restrictGuests
                          ? "ホストが担当ページのみの表示に設定しています。"
                          : undefined
                      }
                      onClick={() => void cloud.create(deck)}
                    >
                      <Cloud size={17} />
                      {cloud.active
                        ? "この作品のコピーを作る"
                        : "この作品をクラウドに保存"}
                    </button>
                  </div>
                </div>
                <div
                  hidden={!trashOpen}
                  className="cloud-trash-tools"
                  ref={trashArea}
                >
                  <button
                    className="quiet"
                    onClick={() => {
                      setTrashOpen(false);
                      returnToLibraryMore();
                    }}
                  >
                    ごみ箱を閉じる
                  </button>
                  <CloudTrash cloud={cloud} />
                </div>
                <CacheRecoveryNotice cloud={cloud} compact />
                <div ref={backupArea}>
                  <BackupPanel
                    cloud={cloud}
                    collapsed={!backupOpen}
                    onCollapse={() => {
                      setBackupOpen(false);
                      returnToLibraryMore();
                    }}
                  />
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
                          {saved.status === "restoring" && (
                            <span>復元途中（削除してやり直せます）</span>
                          )}
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
                      {!!saved.pendingRequests &&
                        saved.owner === cloud.user?.id && (
                          <button
                            className="join-work-badge"
                            aria-label={`${saved.title}の参加待ち${saved.pendingRequests}人を確認`}
                            onClick={() =>
                              void cloud.run(async () => {
                                await cloud.open(saved.id);
                                cloud.panel = true;
                                setTab("sharing");
                                cloud.onState();
                              })
                            }
                          >
                            参加待ち {saved.pendingRequests}人 · 確認する
                          </button>
                        )}
                      {saved.owner === cloud.user?.id && (
                        <button
                          className="icon-button cloud-deck-delete"
                          disabled={cloud.busy}
                          aria-label={`${saved.title}をクラウドから削除`}
                          title="作品を削除"
                          onClick={() => {
                            const complete =
                              !saved.status || saved.status === "ready";
                            if (
                              window.confirm(
                                complete
                                  ? `「${saved.title}」をごみ箱へ移動します。共同編集者も開けなくなります。クラウドの作品一覧にあるごみ箱から戻せます。`
                                  : `未完成の作品「${saved.title}」を削除します。元の作品は変更しません。`,
                              )
                            )
                              void cloud.run(async () => {
                                await api(
                                  `/api/decks/${saved.id}${complete ? "/trash" : ""}`,
                                  {
                                    method: complete ? "POST" : "DELETE",
                                  },
                                );
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
                      <JoinRequests
                        key={`joins:${cloud.active.id}`}
                        cloud={cloud}
                        workId={cloud.active.id}
                        onApproved={async () => {
                          await refreshSharing();
                          await cloud.refresh();
                        }}
                      />
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
                          リンクを開いた相手は参加待ちになります。氏名・メールアドレスを確認してホストが承認した後に、閲覧・付箋コメントが可能になります。
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
        {!cloud.joinRequest && (
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
        )}
      </section>
    </div>,
    document.body,
  );
}
