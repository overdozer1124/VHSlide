import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { DeckGroup } from "./groups";
import { api } from "./cloud";
import { useDeckPoller } from "./deckPoll";

/** The deck's shared groups （班） and the signed-in user's membership.
 * Group-aware activities (webbing maps today) read this context; the
 * groups themselves are defined once per deck by the host. */
export type GroupsContextValue = {
  deckId?: string;
  userId?: string;
  enabled: boolean;
  host?: boolean;
  error: string;
  groups: DeckGroup[];
  myGroupId?: string;
  refresh: () => Promise<void>;
  command: (
    action: "create" | "add" | "join" | "leave",
    body?: Record<string, unknown>,
  ) => Promise<void>;
  rename: (groupId: string, name: string) => Promise<void>;
};
export const GroupsContext = createContext<GroupsContextValue>({
  enabled: false,
  error: "",
  groups: [],
  refresh: async () => {},
  command: async () => {},
  rename: async () => {},
});
export const useGroups = () => useContext(GroupsContext);
export function GroupsProvider({
  deckId,
  userId,
  host,
  blocked,
  pollActive = false,
  children,
}: {
  deckId?: string;
  userId?: string;
  host: boolean;
  blocked: boolean;
  pollActive?: boolean;
  children?: ReactNode;
}) {
  const scope = `${deckId}:${userId}:${host}:${blocked}`;
  return (
    <GroupsSession
      key={scope}
      {...{ deckId, userId, host, blocked, pollActive }}
    >
      {children}
    </GroupsSession>
  );
}
function GroupsSession({
  deckId,
  userId,
  host,
  blocked,
  pollActive,
  children,
}: {
  deckId?: string;
  userId?: string;
  host: boolean;
  blocked: boolean;
  pollActive: boolean;
  children?: ReactNode;
}) {
  const [groups, setGroups] = useState<DeckGroup[]>([]);
  const [myGroupId, setMyGroupId] = useState<string>();
  const [error, setError] = useState("");
  const alive = useRef(true);
  const generation = useRef(0);
  const enabled = !!deckId && !!userId && !blocked;
  const poller = useDeckPoller();
  function adopt(data: { groups: DeckGroup[]; myGroupId?: string }) {
    if (!alive.current) return;
    generation.current++;
    setGroups(data.groups);
    setMyGroupId(data.myGroupId);
    setError("");
  }
  const listVersion = useRef<number | null>(null);
  async function refresh() {
    if (!enabled) return;
    if (poller) {
      await poller.pollNow();
      return;
    }
    const version = ++generation.current;
    const known = listVersion.current;
    const data = await api<{
      groups: DeckGroup[];
      myGroupId?: string;
      version?: number;
      unchanged?: boolean;
    }>(`/api/decks/${deckId}/groups${known !== null ? `?v=${known}` : ""}`);
    if (typeof data.version === "number") listVersion.current = data.version;
    if (data.unchanged) return;
    if (alive.current && version === generation.current) adopt(data);
  }
  async function command(
    action: "create" | "add" | "join" | "leave",
    body: Record<string, unknown> = {},
  ) {
    const data = await api<{ groups: DeckGroup[]; myGroupId?: string }>(
      action === "create"
        ? `/api/decks/${deckId}/groups`
        : `/api/decks/${deckId}/groups/${action}`,
      { method: "POST", body: JSON.stringify(body) },
    );
    adopt(data);
  }
  async function rename(groupId: string, name: string) {
    const data = await api<{ groups: DeckGroup[]; myGroupId?: string }>(
      `/api/decks/${deckId}/groups/${groupId}/rename`,
      { method: "POST", body: JSON.stringify({ name }) },
    );
    adopt(data);
  }
  useEffect(() => {
    alive.current = true;
    if (!enabled || !poller) return;
    const off = poller.register("groups", {
      guard: generation,
      onData: (p) => {
        if (alive.current)
          adopt({ groups: p.groups ?? [], myGroupId: p.myGroupId });
      },
      onError: (e) => {
        if (alive.current) setError(e.message);
      },
    });
    return () => {
      alive.current = false;
      generation.current++;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poller, enabled, deckId, userId]);
  useEffect(() => {
    poller?.setWant("groups", pollActive ? 5000 : 30000);
  }, [poller, pollActive]);
  return (
    <GroupsContext.Provider
      value={{
        deckId,
        userId,
        host,
        enabled,
        error,
        groups,
        myGroupId,
        refresh,
        command,
        rename,
      }}
    >
      {children}
    </GroupsContext.Provider>
  );
}
