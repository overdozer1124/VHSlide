import * as Y from "yjs";
import { readSharedDeck } from "./sharedDeck.ts";
import { AccessError, assertDeckAccess, canEdit } from "./permissions.ts";
import type { EditAccess } from "./permissions.ts";

/** Check both materialised slides and every touched CRDT type, including hidden/deleted types. */
export function applyAuthorizedUpdate(
  before: Y.Doc,
  candidate: Y.Doc,
  update: Uint8Array,
  access: EditAccess,
  host: boolean,
) {
  readSharedDeck(candidate);
  const changed = new Map<Y.AbstractType<any>, Set<string | null>>();
  const collect = (transaction: Y.Transaction) => {
    for (const [type, keys] of transaction.changed) {
      const all = changed.get(type) ?? new Set<string | null>();
      for (const key of keys) all.add(key);
      changed.set(type, all);
    }
  };
  candidate.on("afterTransaction", collect);
  try {
    Y.applyUpdate(candidate, update);
  } finally {
    candidate.off("afterTransaction", collect);
  }
  // Never persist an unresolved update which could later alter a protected slide.
  if (candidate.store.pendingStructs || candidate.store.pendingDs)
    throw new AccessError();
  if (host) return;
  const oldDeck = readSharedDeck(before),
    nextDeck = readSharedDeck(candidate);
  assertDeckAccess(oldDeck, nextDeck, access, false);
  const allowed = (id: string) => {
    const a = oldDeck.slides.find((s) => s.id === id),
      b = nextDeck.slides.find((s) => s.id === id);
    return (
      !!(a || b) &&
      (!a || canEdit(access, a, oldDeck)) &&
      (!b || canEdit(access, b, nextDeck))
    );
  };
  const root = candidate.getMap("slides");
  for (const [type, keys] of changed) {
    if (type === root) {
      for (const id of keys) if (!id || !allowed(id)) throw new AccessError();
      continue;
    }
    let node = type;
    while (node._item && node._item.parent !== root) {
      const parent = node._item.parent;
      if (!(parent instanceof Y.AbstractType)) throw new AccessError();
      node = parent;
    }
    if (
      !node._item ||
      node._item.parent !== root ||
      !node._item.parentSub ||
      !allowed(node._item.parentSub)
    )
      throw new AccessError();
  }
}
