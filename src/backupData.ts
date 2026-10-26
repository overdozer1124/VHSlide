import { parseDeck } from "./model.ts";
import type { Deck } from "./model.ts";
import { parseAccess, parseComment } from "./permissions.ts";
import type { EditAccess, SlideComment } from "./permissions.ts";
import { normalizeEmail, validEmail } from "./preSharing.ts";
import type { Recipient } from "./preSharing.ts";
export const MAX_BACKUP_BYTES = 300_000_000;
export const BACKUP_METADATA_BYTES = 12_000_000;
export type BackupComment = Omit<SlideComment, "id" | "author" | "name"> & {
  authorName: string;
};
export type BackupPerson = { email: string; name?: string; access: EditAccess };
export type BackupSnapshot = {
  format: "vhslide-backup";
  version: 1;
  createdAt: string;
  deck: Deck;
  comments: BackupComment[];
  sharing: BackupPerson[];
};
export function parseBackupSnapshot(raw: unknown): BackupSnapshot {
  const v = raw as BackupSnapshot;
  const fail = (): never => {
    throw new Error("バックアップの形式または内容が正しくありません。");
  };
  if (
    !v ||
    v.format !== "vhslide-backup" ||
    v.version !== 1 ||
    typeof v.createdAt !== "string" ||
    !Number.isFinite(Date.parse(v.createdAt))
  )
    fail();
  const deck = parseDeck(JSON.stringify(v.deck));
  if (
    !Array.isArray(v.comments) ||
    v.comments.length > 2000 ||
    !Array.isArray(v.sharing) ||
    v.sharing.length > 500
  )
    fail();
  const comments = v.comments.map((c) => {
    if (
      !c ||
      typeof c.authorName !== "string" ||
      c.authorName.length > 200 ||
      !Number.isSafeInteger(c.created) ||
      c.created < 0 ||
      c.created > 8_640_000_000_000_000
    )
      fail();
    return { ...parseComment(c), authorName: c.authorName, created: c.created };
  });
  const seen = new Set<string>();
  const sharing = v.sharing.map((p) => {
    if (
      !p ||
      typeof p.email !== "string" ||
      (p.name !== undefined &&
        (typeof p.name !== "string" || p.name.length > 200))
    )
      fail();
    const email = normalizeEmail(p.email);
    if (!validEmail(email) || seen.has(email)) fail();
    seen.add(email);
    return {
      email,
      ...(p.name === undefined ? {} : { name: p.name }),
      access: parseAccess(p.access),
    };
  });
  return {
    format: "vhslide-backup",
    version: 1,
    createdAt: v.createdAt,
    deck,
    comments,
    sharing,
  };
}
export function backupSnapshot(
  deck: Deck,
  comments: SlideComment[],
  recipients: (Omit<Recipient, "name"> & { name?: string | null })[],
  members: BackupPerson[],
): BackupSnapshot {
  const people = new Map<string, BackupPerson>();
  for (const p of [...recipients, ...members]) {
    const email = normalizeEmail(p.email);
    if (!people.has(email))
      people.set(email, {
        email,
        ...(p.name ? { name: p.name } : {}),
        access: p.access,
      });
  }
  return parseBackupSnapshot({
    format: "vhslide-backup",
    version: 1,
    createdAt: new Date().toISOString(),
    deck,
    comments: comments.map((c) => ({ ...c, authorName: c.name })),
    sharing: [...people.values()],
  });
}
/** Restored notes retain attribution; original account IDs never confer privileges. */
export function restoredComments(
  comments: BackupComment[],
  owner: string,
): SlideComment[] {
  return comments.map((c) => ({
    ...parseComment(c),
    id: crypto.randomUUID(),
    author: owner,
    name: c.authorName.endsWith("（復元）")
      ? c.authorName
      : `${c.authorName.slice(0, 190)}（復元）`,
    created: c.created,
  }));
}
