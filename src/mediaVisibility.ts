import type { Deck } from "./model.ts";
import type { SlideComment } from "./permissions.ts";
import { AccessError } from "./permissions.ts";
export const pendingAssetSchema = `CREATE TABLE IF NOT EXISTS pending_asset_access(asset TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE, user_id TEXT NOT NULL);`;
export function imageSources(deck: Deck): Set<string> {
  return new Set(
    deck.slides.flatMap((s) =>
      s.elements.filter((e) => e.type === "image").map((e) => e.src!),
    ),
  );
}
export function visibleComments(
  deck: Deck,
  notes: SlideComment[],
  host: boolean,
) {
  if (host) return notes;
  const ids = new Set(deck.slides.map((s) => s.id));
  return notes.filter((n) => ids.has(n.slide));
}
export class RetiredMediaError extends AccessError {
  constructor() {
    super();
    this.message = "削除済みの画像・付箋を戻す操作はホストに依頼してください。";
  }
}
/** Prevent rebuilding a current reference merely to unlock a historical asset or note. */
export function assertMediaReferences(
  before: Deck,
  after: Deck,
  host: boolean,
  pendingOwned: (source: string) => boolean,
  hasArchivedNotes: (slide: string) => boolean,
) {
  if (host) return;
  const oldSources = imageSources(before),
    oldIds = new Set(before.slides.map((s) => s.id));
  for (const src of imageSources(after))
    if (!oldSources.has(src) && !pendingOwned(src))
      throw new RetiredMediaError();
  for (const slide of after.slides)
    if (!oldIds.has(slide.id) && hasArchivedNotes(slide.id))
      throw new RetiredMediaError();
}
export function consumePendingAssets(
  sql: (q: string, ...args: string[]) => Iterable<Record<string, any>>,
  sources: Set<string>,
) {
  const ids = new Set([...sources].map((s) => s.split("/").at(-1)!));
  for (const row of sql("SELECT asset FROM pending_asset_access"))
    if (ids.has(row.asset))
      sql("DELETE FROM pending_asset_access WHERE asset=?", row.asset);
}
