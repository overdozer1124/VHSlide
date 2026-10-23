import { PreSharePanel } from "./PreSharePanel";
import type { Recipient } from "./preSharing";
import { PermissionPicker } from "./PermissionPicker";
import { defaultAccess } from "./permissions";
import type { EditAccess } from "./permissions";
import { useEffect, useRef, useState } from "react";
import { Cloud, Copy, LogOut, Trash2, X } from "lucide-react";
import type { Deck } from "./model";
import { api, CloudWorkspace } from "./cloud";
import type { CloudUser } from "./cloud";

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
  const button = useRef<HTMLDivElement>(null);
  const [link, setLink] = useState("");
  const [members, setMembers] = useState<
    (CloudUser & { access?: EditAccess })[]
  >([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  async function refreshSharing() {
    const id = cloud.active?.id;
    if (!id) return;
    const [m, r] = await Promise.all([
      api<{ members: (CloudUser & { access?: EditAccess })[] }>(
        `/api/decks/${id}/members`,
      ),
      api<{ recipients: Recipient[] }>(`/api/decks/${id}/recipients`),
    ]);
    if (cloud.active?.id === id) {
      setMembers(m.members);
      setRecipients(r.recipients);
    }
  }
  const [editingMember, setEditingMember] = useState<string>();
  const [grant, setGrant] = useState<EditAccess>(defaultAccess);
  const [loginError, setLoginError] = useState("");
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
  useEffect(() => {
    setLink("");
    setMembers([]);
    setRecipients([]);
    if (cloud.active?.owner === cloud.user?.id && cloud.active)
      void refreshSharing().catch(() => {});
  }, [cloud.active?.id, cloud.user?.id]);
  const own = cloud.active && cloud.active.owner === cloud.user?.id;
  return (
    <div
      className="cloud-overlay"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          cloud.panel = false;
          cloud.onState();
        }
      }}
    >
      <section
        className="cloud-panel"
        role="dialog"
        aria-modal="true"
        aria-label="クラウドの作品"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            cloud.panel = false;
            cloud.onState();
          }
        }}
      >
        <div className="cloud-panel-heading">
          <h2>
            <Cloud size={20} />
            クラウドの作品
          </h2>
          <button
            className="icon-button"
            aria-label="クラウドの作品を閉じる"
            onClick={() => {
              cloud.panel = false;
              cloud.onState();
            }}
          >
            <X size={20} />
          </button>
        </div>
        {cloud.notice && <p role="status">{cloud.notice}</p>}
        {!cloud.user ? (
          <>
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
            {loginError && <p role="alert">{loginError}</p>}
          </>
        ) : (
          <>
            <div className="cloud-account">
              <span>{cloud.user.name}</span>
              <button
                className="quiet"
                disabled={cloud.busy}
                onClick={() =>
                  void cloud.signOut().then(() => {
                    if (!cloud.user) onLocal();
                  })
                }
              >
                <LogOut size={15} />
                サインアウト
              </button>
            </div>
            <button
              className="button primary"
              disabled={cloud.busy}
              onClick={() => void cloud.create(deck)}
            >
              {cloud.active
                ? "この作品のコピーを作る"
                : "この作品をクラウドに保存"}
            </button>
            {cloud.active && (
              <div className="cloud-sharing">
                <strong>開いている作品</strong>
                <p>{deck.title}</p>
                {own ? (
                  <>
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
                    <small>
                      新しく参加した人は閲覧・付箋コメントのみです。参加後、下の参加者一覧で編集権限を設定してください。作り直すと以前のリンクは使えなくなります。
                    </small>
                    {link && (
                      <div className="cloud-invite">
                        <input
                          aria-label="共同編集の招待リンク"
                          readOnly
                          value={link}
                          onFocus={(event) => event.currentTarget.select()}
                        />
                        <button
                          className="icon-button"
                          aria-label="招待リンクをコピー"
                          onClick={() =>
                            void navigator.clipboard
                              .writeText(link)
                              .catch(() =>
                                setLoginError(
                                  "リンク欄を選択してコピーしてください。",
                                ),
                              )
                          }
                        >
                          <Copy size={18} />
                        </button>
                      </div>
                    )}
                    <button
                      className="quiet"
                      disabled={cloud.busy}
                      onClick={() =>
                        void cloud.run(async () => {
                          await api(`/api/decks/${cloud.active!.id}/invite`, {
                            method: "DELETE",
                          });
                          setLink("");
                        })
                      }
                    >
                      招待リンクを無効にする
                    </button>
                    <button
                      className="quiet"
                      onClick={() => void cloud.run(refreshSharing)}
                    >
                      参加者一覧を更新
                    </button>
                    <PreSharePanel
                      cloud={cloud}
                      deck={deck}
                      recipients={recipients}
                      onChange={(rows) => {
                        setRecipients(rows);
                        void refreshSharing().catch(() => {});
                      }}
                    />
                    {members
                      .filter(
                        (member) =>
                          member.id !== cloud.user?.id &&
                          !recipients.some((r) => r.userId === member.id),
                      )
                      .map((member) => (
                        <div className="cloud-member" key={member.id}>
                          <span>
                            {member.name}
                            <small>{member.email}</small>
                          </span>
                          <button
                            className="quiet"
                            aria-label={`${member.name}の編集権限を設定`}
                            onClick={() => {
                              setEditingMember(
                                editingMember === member.id
                                  ? undefined
                                  : member.id,
                              );
                              setGrant(member.access ?? defaultAccess());
                            }}
                          >
                            編集権限を設定
                          </button>
                          {editingMember === member.id && (
                            <div className="member-permissions">
                              <PermissionPicker
                                deck={deck}
                                value={grant}
                                onChange={setGrant}
                              />
                              <button
                                className="button primary"
                                disabled={cloud.busy}
                                onClick={() =>
                                  void cloud.run(async () => {
                                    await api(
                                      `/api/decks/${cloud.active!.id}/members/${encodeURIComponent(member.id)}`,
                                      {
                                        method: "PATCH",
                                        body: JSON.stringify(grant),
                                      },
                                    );
                                    setMembers((items) =>
                                      items.map((m) =>
                                        m.id === member.id
                                          ? { ...m, access: grant }
                                          : m,
                                      ),
                                    );
                                    setEditingMember(undefined);
                                  })
                                }
                              >
                                権限を保存
                              </button>
                              <button
                                className="quiet"
                                onClick={() => setEditingMember(undefined)}
                              >
                                取り消す
                              </button>
                            </div>
                          )}
                          <button
                            className="quiet"
                            disabled={cloud.busy}
                            aria-label={`${member.name}の参加を解除`}
                            onClick={() =>
                              void cloud.run(async () => {
                                await api(
                                  `/api/decks/${cloud.active!.id}/members/${encodeURIComponent(member.id)}`,
                                  { method: "DELETE" },
                                );
                                setMembers((current) =>
                                  current.filter((m) => m.id !== member.id),
                                );
                              })
                            }
                          >
                            参加を解除
                          </button>
                        </div>
                      ))}
                  </>
                ) : (
                  <small>
                    共有された作品です。
                    {cloud.access.mode === "none"
                      ? "現在は閲覧のみです。編集の権限はホストが設定します。"
                      : cloud.access.mode === "scoped"
                        ? "ホストが指定した範囲を編集できます。"
                        : "すべてのスライドを編集できます。"}
                  </small>
                )}
                <button
                  className="quiet"
                  disabled={cloud.busy}
                  onClick={onLocal}
                >
                  端末の作品へ戻る
                </button>
              </div>
            )}
            <h3>保存した作品・参加した作品</h3>
            <button
              className="quiet"
              disabled={cloud.busy}
              onClick={() => void cloud.run(() => cloud.refresh())}
            >
              作品一覧を更新
            </button>
            <div className="cloud-deck-list">
              {cloud.decks.length ? (
                cloud.decks.map((saved) => (
                  <div className="cloud-deck" key={saved.id}>
                    <button
                      disabled={cloud.busy}
                      aria-label={`作品を開く：${saved.title}`}
                      onClick={() => {
                        const reset =
                          cloud.active?.id === saved.id && cloud.needsAttention;
                        if (
                          !reset ||
                          window.confirm(
                            "未反映の変更は置き換わります。必要なJSONを保存してから、クラウドの内容を開き直してください。",
                          )
                        )
                          void cloud.run(() => cloud.open(saved.id, reset));
                      }}
                    >
                      <strong>{saved.title}</strong>
                      <small>
                        {saved.owner === cloud.user?.id
                          ? "自分の作品"
                          : "参加している作品"}
                      </small>
                    </button>
                    {saved.owner === cloud.user?.id && (
                      <button
                        className="icon-button"
                        disabled={cloud.busy}
                        aria-label={`${saved.title}をクラウドから削除`}
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
                  </div>
                ))
              ) : (
                <p>まだ作品がありません。</p>
              )}
            </div>
          </>
        )}
        {cloud.busy && <p role="status">処理しています…</p>}
        {cloud.error && (
          <p className="cloud-error" role="alert">
            {cloud.error}
          </p>
        )}
      </section>
    </div>
  );
}
