import { useEffect, useMemo, useState } from "react";
import type { Deck } from "./model";
import { activeSheet, sheetList } from "./workbook";
import { api } from "./cloud";
import type { CloudWorkspace } from "./cloud";
import { defaultAccess } from "./permissions";
import type { EditAccess } from "./permissions";
import { parseAccountEmails, sequentialRecipients } from "./preSharing";
import type { Recipient } from "./preSharing";
import { PermissionPicker } from "./PermissionPicker";
export function PreSharePanel({
  cloud,
  deck,
  recipients,
  onChange,
}: {
  cloud: CloudWorkspace;
  deck: Deck;
  recipients: Recipient[];
  onChange: (rows: Recipient[]) => void;
}) {
  const [expanded, setExpanded] = useState(false),
    [text, setText] = useState("");
  const [mode, setMode] = useState("rows"),
    [sheet, setSheet] = useState(activeSheet(deck).id);
  const [start, setStart] = useState(0),
    [manual, setManual] = useState(false);
  const [common, setCommon] = useState<EditAccess>(defaultAccess);
  useEffect(() => {
    if (manual) return;
    const used = recipients.flatMap((r) =>
      r.access.mode === "scoped"
        ? r.access.rows
            .filter((row) => row.sheetId === sheet)
            .map((row) => row.index)
        : [],
    );
    setStart(used.length ? Math.max(...used) + 1 : 0);
  }, [recipients, sheet, manual]);
  const draft = useMemo(() => {
    if (!text.trim()) return { rows: [] as Recipient[], error: "" };
    try {
      const emails = parseAccountEmails(text);
      if (emails.includes(cloud.user!.email.trim().toLowerCase()))
        throw new Error("ホスト自身を除き、共有相手だけを入力してください。");
      return {
        rows:
          mode === "rows"
            ? sequentialRecipients(emails, sheet, start)
            : emails.map((email) => ({ email, access: common })),
        error: "",
      };
    } catch (error) {
      return { rows: [] as Recipient[], error: (error as Error).message };
    }
  }, [text, mode, sheet, start, common, cloud.user]);
  function label(access: EditAccess) {
    if (access.mode === "none") return "閲覧のみ";
    if (access.mode === "all") return "すべてのスライドを編集";
    if (
      access.rows.length === 1 &&
      !access.columns.length &&
      !access.slides.length
    ) {
      const row = access.rows[0];
      return `${sheetList(deck).find((s) => s.id === row.sheetId)?.name ?? "シート"}・${row.index + 1}行目`;
    }
    return `${access.rows.length}行・${access.columns.length}列・${access.slides.length}枚を指定`;
  }
  return (
    <section className="pre-sharing" aria-label="アカウントの事前共有">
      <button
        className="button outline"
        aria-label="共有するアカウントを追加"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        共有するアカウントを追加
      </button>
      {expanded && (
        <>
          <p>
            Googleアカウントのメールアドレスを貼り付けて、参加前に編集権限を設定できます。メール通知は送信しません。
          </p>
          <label>
            共有するアカウント
            <textarea
              aria-label="事前共有するメールアドレス"
              rows={4}
              value={text}
              disabled={cloud.busy}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                "student01@school.example.jp\nstudent02@school.example.jp"
              }
            />
          </label>
          <small>
            改行・カンマ・空白区切りや「名前
            &lt;メールアドレス&gt;」を使えます。重複は最初の1件にまとめます（1回100件まで）。
          </small>
          <label>
            権限の割り当て
            <select
              aria-label="事前共有の割り当て方法"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="rows">貼り付け順に1行ずつ割り当てる</option>
              <option value="common">全員に同じ編集権限を設定する</option>
            </select>
          </label>
          {mode === "rows" ? (
            <>
              <label>
                割り当て先のシート
                <select
                  aria-label="行を割り当てるシート"
                  value={sheet}
                  onChange={(e) => {
                    setSheet(e.target.value);
                    setManual(false);
                  }}
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
                  aria-label="割り当てを開始する行"
                  value={start}
                  onChange={(e) => {
                    setManual(true);
                    setStart(Number(e.target.value));
                  }}
                >
                  {start >= 100 && (
                    <option value={start}>空いている行がありません</option>
                  )}
                  {Array.from({ length: 100 }, (_, index) => (
                    <option value={index} key={index}>
                      {index + 1}行目
                    </option>
                  ))}
                </select>
              </label>
              <small>
                未作成の行も指定できます。スライドは増やさず、その行に作成したスライドを編集できる設定になります。
              </small>
            </>
          ) : (
            <PermissionPicker deck={deck} value={common} onChange={setCommon} />
          )}
          {draft.error && (
            <p className="cloud-error" role="alert">
              {draft.error}
            </p>
          )}
          {draft.rows.length > 0 && (
            <div
              className="pre-share-preview"
              role="region"
              aria-label="事前共有のプレビュー"
            >
              <strong>{draft.rows.length}アカウントの割り当て</strong>
              <ol>
                {draft.rows.map((r) => (
                  <li key={r.email}>
                    <span>{r.email}</span>
                    <strong>{label(r.access)}</strong>
                    {recipients.some((old) => old.email === r.email) && (
                      <small>設定済みの権限を更新します</small>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}
          <button
            className="button primary"
            disabled={cloud.busy || !draft.rows.length}
            onClick={() =>
              void cloud.run(async () => {
                const result = await api<{ recipients: Recipient[] }>(
                  `/api/decks/${cloud.active!.id}/recipients`,
                  {
                    method: "POST",
                    body: JSON.stringify({ recipients: draft.rows }),
                  },
                );
                onChange(result.recipients);
                setText("");
                setManual(false);
              })
            }
          >
            事前共有を保存
          </button>
          <small>
            保存後はこの作品のリンクを相手に伝えてください。登録されたアカウントでサインインすると作品を開けます。招待リンクから参加した場合も事前設定が適用されます。
          </small>
        </>
      )}
    </section>
  );
}
