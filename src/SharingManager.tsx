import { axisIndex } from "./axes";
import { AssignmentStatus } from "./AssignmentStatus";
import { useMemo, useState } from "react";
import { Check, Search, Settings2, Trash2, Users } from "lucide-react";
import type { Deck } from "./model";
import { activeSheet, sheetList } from "./workbook";
import { api } from "./cloud";
import type { CloudUser, CloudWorkspace } from "./cloud";
import type { EditAccess } from "./permissions";
import { defaultAccess } from "./permissions";
import { sequentialRecipients } from "./preSharing";
import type { Recipient } from "./preSharing";
import { PermissionPicker } from "./PermissionPicker";
import { PreSharePanel } from "./PreSharePanel";

export type SharingMember = CloudUser & { access?: EditAccess };
type Person = {
  key: string;
  email: string;
  name: string;
  userId?: string;
  access: EditAccess;
  recipient: boolean;
};
export function accessLabel(access: EditAccess, deck: Deck) {
  if (access.mode === "none")
    return access.comment ? "閲覧・付箋コメント" : "閲覧のみ";
  if (access.mode === "all") return "すべてのスライドを編集";
  const sheets = sheetList(deck);
  return (
    [
      ...access.rows.map(
        (r) =>
          `${sheets.find((s) => s.id === r.sheetId)?.name ?? "シート"}・${axisIndex(deck, "rows", r) === undefined ? "削除された行" : `${axisIndex(deck, "rows", r)! + 1}行目`}`,
      ),
      ...access.columns.map(
        (r) =>
          `${sheets.find((s) => s.id === r.sheetId)?.name ?? "シート"}・${axisIndex(deck, "columns", r) === undefined ? "削除された列" : `${axisIndex(deck, "columns", r)! + 1}列目`}`,
      ),
      ...(access.slides.length
        ? [`個別スライド ${access.slides.length}枚`]
        : []),
    ].join(" / ") || "編集範囲の指定なし"
  );
}
export function SharingManager({
  cloud,
  deck,
  members,
  recipients,
  refresh,
  onRecipients,
}: {
  cloud: CloudWorkspace;
  deck: Deck;
  members: SharingMember[];
  recipients: Recipient[];
  refresh: () => Promise<void>;
  onRecipients: (items: Recipient[]) => void;
}) {
  const people = useMemo<Person[]>(
    () => [
      ...recipients.map((r) => ({
        key: `r:${r.email}`,
        email: r.email,
        name: r.name || r.email.split("@")[0],
        userId: r.userId,
        access: r.access,
        recipient: true,
      })),
      ...members
        .filter(
          (m) =>
            m.id !== cloud.user?.id &&
            !recipients.some((r) => r.userId === m.id),
        )
        .map((m) => ({
          key: `m:${m.id}`,
          email: m.email,
          name: m.name,
          userId: m.id,
          access: m.access ?? defaultAccess(),
          recipient: false,
        })),
    ],
    [recipients, members, cloud.user?.id],
  );
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string>();
  const [grant, setGrant] = useState<EditAccess>(defaultAccess);
  const [bulk, setBulk] = useState(false),
    [confirmRemove, setConfirmRemove] = useState(false);
  const [mode, setMode] = useState("common");
  const [sheet, setSheet] = useState(activeSheet(deck).id),
    [start, setStart] = useState(0);
  const [message, setMessage] = useState("");
  const visible = people.filter((p) =>
    `${p.name} ${p.email}`.toLowerCase().includes(query.toLowerCase().trim()),
  );
  // Use registration/list order, never checkbox-click order, for sequential rows.
  const picked = people.filter((p) => selected.has(p.key));
  const allVisible =
    visible.length > 0 && visible.every((p) => selected.has(p.key));
  function toggle(key: string) {
    setSelected((old) => {
      const next = new Set(old);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setConfirmRemove(false);
  }
  function changeSelection() {
    setSelected((old) => {
      const next = new Set(old);
      for (const p of visible) {
        if (allVisible) next.delete(p.key);
        else next.add(p.key);
      }
      return next;
    });
    setConfirmRemove(false);
  }
  async function saveOne(person: Person) {
    const id = cloud.active!.id;
    if (person.recipient)
      await api(`/api/decks/${id}/recipients`, {
        method: "POST",
        body: JSON.stringify({
          recipients: [{ email: person.email, access: grant }],
        }),
      });
    else
      await api(
        `/api/decks/${id}/members/${encodeURIComponent(person.userId!)}`,
        { method: "PATCH", body: JSON.stringify(grant) },
      );
    setEditing(undefined);
    setMessage(`${person.name}の権限を更新しました`);
    await refresh();
  }
  async function remove(person: Person) {
    const id = cloud.active!.id;
    const path = person.recipient
      ? `recipients/${encodeURIComponent(person.email)}`
      : `members/${encodeURIComponent(person.userId!)}`;
    await api(`/api/decks/${id}/${path}`, { method: "DELETE" });
  }
  let rowError = "";
  if (mode === "rows" && picked.length && start + picked.length > 100)
    rowError =
      "割り当てる行が100行を超えます。開始行または選択人数を調整してください。";
  async function perform(removeAll: boolean) {
    const targets = [...picked],
      completed = new Set<string>(),
      id = cloud.active!.id;
    const rights =
      mode === "rows" && !removeAll
        ? sequentialRecipients(
            targets.map((p) => p.email),
            sheet,
            start,
            true,
            deck,
          ).map((r) => r.access)
        : targets.map(() => grant);
    setMessage("");
    try {
      if (removeAll) {
        for (const person of targets) {
          await remove(person);
          completed.add(person.key);
          setMessage(
            `${completed.size} / ${targets.length}件の共有を解除しています…`,
          );
        }
      } else {
        // Existing recipient endpoint commits up to 100 accounts atomically.
        const planned = targets.map((person, i) => ({
          person,
          access: rights[i],
        }));
        const registered = planned.filter((p) => p.person.recipient);
        for (let i = 0; i < registered.length; i += 100) {
          const group = registered.slice(i, i + 100);
          await api(`/api/decks/${id}/recipients`, {
            method: "POST",
            body: JSON.stringify({
              recipients: group.map((p) => ({
                email: p.person.email,
                access: p.access,
              })),
            }),
          });
          group.forEach((p) => completed.add(p.person.key));
          setMessage(
            `${completed.size} / ${targets.length}件の権限を更新しています…`,
          );
        }
        for (const item of planned.filter((p) => !p.person.recipient)) {
          await api(
            `/api/decks/${id}/members/${encodeURIComponent(item.person.userId!)}`,
            { method: "PATCH", body: JSON.stringify(item.access) },
          );
          completed.add(item.person.key);
          setMessage(
            `${completed.size} / ${targets.length}件の権限を更新しています…`,
          );
        }
      }
      setMessage(
        `${completed.size}件の${removeAll ? "共有を解除" : "権限を更新"}しました`,
      );
      setBulk(false);
    } catch (error) {
      setMessage(
        `${targets.length}件中${completed.size}件が完了しました。未完了のアカウントは選択を残しています。`,
      );
      throw error;
    } finally {
      setConfirmRemove(false);
      setSelected(
        (old) => new Set([...old].filter((key) => !completed.has(key))),
      );
      await refresh();
    }
  }
  return (
    <fieldset
      className="sharing-manager"
      disabled={cloud.busy}
      aria-label="共有アカウントの管理"
    >
      <div className="sharing-section-heading">
        <div>
          <h3>
            <Users size={19} />
            共有アカウント <span>{people.length}人</span>
          </h3>
          <p>名前・参加状況・編集できる範囲をまとめて確認できます。</p>
        </div>
      </div>
      <PreSharePanel
        cloud={cloud}
        deck={deck}
        recipients={recipients}
        onChange={onRecipients}
      />
      <div className="sharing-list-tools">
        <label className="cloud-search">
          <Search size={17} />
          <input
            aria-label="共有アカウントを検索"
            placeholder="名前・メールアドレスで検索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button
          className="quiet"
          disabled={cloud.busy}
          onClick={() => void cloud.run(refresh)}
        >
          参加者一覧を更新
        </button>
      </div>
      <div className="sharing-bulk-bar">
        <label>
          <input
            type="checkbox"
            aria-label="表示中のアカウントをすべて選択"
            ref={(node) => {
              if (node)
                node.indeterminate =
                  !allVisible && visible.some((p) => selected.has(p.key));
            }}
            checked={allVisible}
            disabled={cloud.busy || !visible.length}
            onChange={changeSelection}
          />
          すべて選択
        </label>
        <span>{picked.length}人を選択中</span>
        <button
          className="button outline"
          disabled={cloud.busy || !picked.length}
          onClick={() => {
            setBulk(!bulk);
            setConfirmRemove(false);
            setEditing(undefined);
            setGrant(defaultAccess());
          }}
        >
          <Settings2 size={16} />
          一括で権限を設定
        </button>
        <button
          className="button danger-outline"
          disabled={cloud.busy || !picked.length}
          onClick={() => {
            setConfirmRemove(true);
            setBulk(false);
            setEditing(undefined);
          }}
        >
          <Trash2 size={16} />
          選択した共有を解除
        </button>
        {picked.length > 0 && (
          <button
            className="quiet"
            disabled={cloud.busy}
            onClick={() => {
              setSelected(new Set());
              setBulk(false);
              setConfirmRemove(false);
            }}
          >
            選択を解除
          </button>
        )}
      </div>
      {confirmRemove && picked.length > 0 && (
        <div className="bulk-confirm" role="group" aria-label="共有解除の確認">
          <strong>{picked.length}人の共有を解除しますか？</strong>
          <p>
            参加済みの相手も、この作品を開けなくなります。作品とスライドは削除されません。招待リンクが有効な場合は再参加できます。
          </p>
          <button
            className="button danger"
            disabled={cloud.busy}
            onClick={() => void cloud.run(() => perform(true))}
          >
            {picked.length}人の共有を解除する
          </button>
          <button
            className="quiet"
            disabled={cloud.busy}
            onClick={() => setConfirmRemove(false)}
          >
            取り消す
          </button>
        </div>
      )}
      {bulk && picked.length > 0 && (
        <div
          className="member-permissions bulk-permissions"
          role="group"
          aria-label="選択したアカウントの権限設定"
        >
          <h4>{picked.length}人の権限をまとめて設定</h4>
          <label>
            割り当て方法
            <select
              aria-label="一括の割り当て方法"
              value={mode}
              disabled={cloud.busy}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="common">同じ編集権限にする</option>
              <option value="rows">一覧の順に1行ずつ割り当てる</option>
            </select>
          </label>
          {mode === "common" ? (
            <PermissionPicker deck={deck} value={grant} onChange={setGrant} />
          ) : (
            <div className="bulk-row-options">
              <label>
                シート
                <select
                  aria-label="一括で割り当てるシート"
                  value={sheet}
                  onChange={(e) => setSheet(e.target.value)}
                >
                  {sheetList(deck).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                開始する行
                <select
                  aria-label="一括で割り当てを開始する行"
                  value={start}
                  onChange={(e) => setStart(Number(e.target.value))}
                >
                  {Array.from({ length: 100 }, (_, i) => (
                    <option key={i} value={i}>
                      {i + 1}行目
                    </option>
                  ))}
                </select>
              </label>
              <p>
                一覧の上から順に、{start + 1}
                行目から割り当てます。既存の編集範囲は置き換わり、付箋コメントを許可します。
              </p>
              <ol className="bulk-row-preview">
                {picked.map((p, i) => (
                  <li key={p.key}>
                    {p.name} → {start + i + 1}行目
                  </li>
                ))}
              </ol>
            </div>
          )}
          {rowError && (
            <p className="cloud-error" role="alert">
              {rowError}
            </p>
          )}
          <button
            className="button primary"
            disabled={cloud.busy || !!rowError}
            onClick={() => void cloud.run(() => perform(false))}
          >
            <Check size={16} />
            選択した{picked.length}人に適用
          </button>
          <button
            className="quiet"
            disabled={cloud.busy}
            onClick={() => setBulk(false)}
          >
            取り消す
          </button>
        </div>
      )}
      <p className="sharing-feedback" role="status" aria-live="polite">
        {message}
      </p>
      <div
        className="sharing-people"
        role="list"
        aria-label="共有されているアカウント"
      >
        {visible.map((p) => (
          <div
            key={p.key}
            role="listitem"
            className={`sharing-person ${p.recipient ? "pre-share-account" : "cloud-member"}`}
            data-selected={selected.has(p.key)}
          >
            <label className="sharing-person-check">
              <input
                type="checkbox"
                aria-label={`${p.email}を選択`}
                disabled={cloud.busy}
                checked={selected.has(p.key)}
                onChange={() => toggle(p.key)}
              />
            </label>
            <div className="sharing-person-identity">
              <strong>{p.name}</strong>
              <span>{p.email}</span>
              <span className={`sharing-status ${p.userId ? "joined" : ""}`}>
                {p.userId ? "参加済み" : "参加前（承認済み）"}
              </span>
            </div>
            <div className="sharing-person-access">
              <strong>{accessLabel(p.access, deck)}</strong>
              <AssignmentStatus book={deck} access={p.access} />
              <small>
                {p.access.comment ? "付箋コメント可" : "付箋コメント不可"}
              </small>
            </div>
            <div className="sharing-person-actions">
              <button
                className="button outline"
                aria-label={
                  p.recipient
                    ? `${p.email}の事前編集権限を設定`
                    : `${p.name}の編集権限を設定`
                }
                disabled={cloud.busy}
                onClick={() => {
                  setEditing(editing === p.key ? undefined : p.key);
                  setGrant(p.access);
                  setBulk(false);
                  setConfirmRemove(false);
                }}
              >
                権限を変更
              </button>
              <button
                className="icon-button"
                title="共有を解除"
                aria-label={
                  p.recipient
                    ? `${p.email}の事前共有を解除`
                    : `${p.name}の参加を解除`
                }
                disabled={cloud.busy}
                onClick={() =>
                  void cloud.run(async () => {
                    await remove(p);
                    setMessage(`${p.name}の共有を解除しました`);
                    await refresh();
                  })
                }
              >
                <Trash2 size={17} />
              </button>
            </div>
            {editing === p.key && (
              <div className="member-permissions">
                <PermissionPicker
                  deck={deck}
                  value={grant}
                  onChange={setGrant}
                />
                <button
                  className="button primary"
                  disabled={cloud.busy}
                  onClick={() => void cloud.run(() => saveOne(p))}
                >
                  {p.recipient ? "事前編集権限を保存" : "権限を保存"}
                </button>
                <button
                  className="quiet"
                  disabled={cloud.busy}
                  onClick={() => setEditing(undefined)}
                >
                  取り消す
                </button>
              </div>
            )}
          </div>
        ))}
        {!visible.length && (
          <div className="cloud-empty">
            <Users size={28} />
            <strong>
              {query
                ? "一致するアカウントがありません"
                : "まだ共有相手がいません"}
            </strong>
            <p>
              {query
                ? "名前やメールアドレスを変えて検索してください。"
                : "「共有するアカウントを追加」から、授業前にまとめて登録できます。"}
            </p>
          </div>
        )}
      </div>
    </fieldset>
  );
}
