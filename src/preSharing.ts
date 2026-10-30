import type { Deck } from "./model.ts";
import { axisGrant } from "./axes.ts";
import { defaultAccess, parseAccess } from "./permissions.ts";
import type { EditAccess } from "./permissions.ts";
export type Recipient = {
  email: string;
  access: EditAccess;
  userId?: string;
  name?: string;
};
export const normalizeEmail = (email: string) => email.trim().toLowerCase();
const emailPattern =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
export function validEmail(value: string) {
  return value.length <= 254 && emailPattern.test(value);
}
/** Spreadsheet rows, Workspace-style Name <email>, commas and newlines retain paste order. */
export function parseAccountEmails(text: string): string[] {
  if (text.length > 100_000)
    throw new Error("一度に追加できるアカウントは100件までです。");
  const namesRemoved = text.replace(
    /(?:"[^"\r\n]*"|[^,;\n\r\t<>]+)?<([^<>]+)>/g,
    "$1",
  );
  const emails = namesRemoved
    .split(/[\s,;、，；]+/)
    .filter(Boolean)
    .map(normalizeEmail);
  const invalid = emails.find((email) => !validEmail(email));
  if (invalid)
    throw new Error(
      `メールアドレスを確認してください：${invalid.slice(0, 80)}`,
    );
  const unique = [...new Set(emails)];
  if (!unique.length || unique.length > 100)
    throw new Error("メールアドレスを1〜100件貼り付けてください。");
  return unique;
}
export function sequentialRecipients(
  emails: string[],
  sheetId: string,
  startRow: number,
  comment = true,
  deck?: Deck,
): Recipient[] {
  if (
    !sheetId ||
    !Number.isInteger(startRow) ||
    startRow < 0 ||
    startRow + emails.length > 100
  )
    throw new Error(
      "割り当てる行が100行を超えます。開始行または人数を調整してください。",
    );
  return emails.map((email, index) => ({
    email,
    access: {
      ...defaultAccess(),
      mode: "scoped",
      comment,
      rows: [
        deck
          ? axisGrant(deck, sheetId, "rows", startRow + index)
          : { sheetId, index: startRow + index },
      ],
    },
  }));
}
export function parseRecipients(
  value: unknown,
  ownerEmail: string,
): Recipient[] {
  const items = (value as { recipients?: unknown })?.recipients;
  if (!Array.isArray(items) || !items.length || items.length > 100)
    throw new Error("アカウントは1〜100件ずつ追加してください。");
  const seen = new Set<string>();
  return items.map((item) => {
    if (!item || typeof item.email !== "string")
      throw new Error("メールアドレスを確認してください。");
    const email = normalizeEmail(item.email);
    if (!validEmail(email) || seen.has(email))
      throw new Error("メールアドレスが正しくないか重複しています。");
    if (email === normalizeEmail(ownerEmail))
      throw new Error(
        "ホスト自身のアカウントは追加せず、共有相手だけを入力してください。",
      );
    seen.add(email);
    return { email, access: parseAccess(item.access) };
  });
}

export type RowAccounts = Record<string, Record<string, string[]>>;
export type AccountLabels = {
  rows: RowAccounts;
  columns: RowAccounts;
  slides: Record<string, string[]>;
  all: string[];
};
export const emptyAccountLabels = (): AccountLabels => ({
  rows: {},
  columns: {},
  slides: {},
  all: [],
});
type DisplayRecipient = Omit<Recipient, "name"> & { name?: string | null };
type DisplayMember = { id: string; name: string; access: EditAccess };
/** Return only display names and their assigned positions, without contact
 * addresses, account IDs or permission settings. */
export function sharedAccountNames(
  recipients: DisplayRecipient[],
  members: DisplayMember[],
): AccountLabels {
  const result: AccountLabels = {
    rows: Object.create(null),
    columns: Object.create(null),
    slides: Object.create(null),
    all: [],
  };
  const claimed = new Set(
    recipients.flatMap((r) => (r.userId ? [r.userId] : [])),
  );
  const people = [
    ...recipients.map((r) => ({
      name: r.name || r.email.split("@")[0],
      access: r.access,
    })),
    ...members.filter((m) => !claimed.has(m.id)),
  ];
  for (const person of people) {
    if (person.access.mode === "all") {
      result.all.push(person.name);
      continue;
    }
    if (person.access.mode !== "scoped") continue;
    for (const axis of ["rows", "columns"] as const)
      for (const row of person.access[axis]) {
        const sheet = (result[axis][row.sheetId] ??= Object.create(null));
        (sheet[row.axisId ?? String(row.index)] ??= []).push(person.name);
      }
    for (const id of person.access.slides)
      (result.slides[id] ??= []).push(person.name);
  }
  return result;
}
export function rowAccountNames(
  recipients: DisplayRecipient[],
  members: DisplayMember[],
): RowAccounts {
  return sharedAccountNames(recipients, members).rows;
}
