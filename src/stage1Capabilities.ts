import {
  defaultAccess,
  hostAccess,
  parseAccess,
  type EditAccess,
} from "./permissions.ts";

/** Participant-facing capability snapshot (never includes is_super_admin). */
export type DeckCapability = {
  deckId: string;
  userId: string;
  kind: "general";
  member: boolean;
  host: boolean;
  access: EditAccess;
};

/**
 * General-deck access — same rules as today's Node/CF permissions():
 * owner → hostAccess(); else grant JSON → parseAccess; else defaultAccess().
 * School decks (organization_id / space_id) are out of scope until stage ② columns exist.
 */
export function generalDeckAccess(input: {
  deckId: string;
  userId: string;
  ownerId: string;
  isMember: boolean;
  grantJson?: string | null;
}): DeckCapability {
  const host = input.ownerId === input.userId;
  let access: EditAccess = defaultAccess();
  if (host) access = hostAccess();
  else if (input.grantJson) {
    try {
      access = parseAccess(JSON.parse(input.grantJson));
    } catch {
      access = defaultAccess();
    }
  }
  return {
    deckId: input.deckId,
    userId: input.userId,
    kind: "general",
    member: input.isMember || host,
    host,
    access,
  };
}

/** True when STAGE1_FEATURES is explicitly enabled (verify env only). */
export function stage1FeaturesEnabled(
  env: Record<string, string | undefined> | { STAGE1_FEATURES?: string },
): boolean {
  const value =
    "STAGE1_FEATURES" in env
      ? env.STAGE1_FEATURES
      : (env as Record<string, string | undefined>).STAGE1_FEATURES;
  return value === "1" || value === "true";
}
