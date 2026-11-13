import { useState } from "react";
import type { DeckGroup } from "./groups";

/** Group switcher shared by group-aware activities: chips view every
 * group's board, the guest's own group is the only writable one, and
 * joining (or switching) happens here too. Hosts just switch views. */
export function GroupBar({
  groups,
  myGroupId,
  host,
  activeGroupId,
  onSelect,
  onJoin,
}: {
  groups: DeckGroup[];
  myGroupId?: string;
  host?: boolean;
  activeGroupId?: string;
  onSelect: (groupId: string) => void;
  onJoin: (groupId: string) => Promise<void>;
}) {
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState("");
  if (!groups.length) return null;
  const joined = !!myGroupId;
  const joinMode = !host && (!joined || changing);
  async function join(groupId: string) {
    setError("");
    try {
      await onJoin(groupId);
      setChanging(false);
      onSelect(groupId);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="group-bar">
      <div className="group-bar-chips" role="tablist" aria-label="グループ切替">
        {groups.map((group) => {
          const mine = group.id === myGroupId;
          const active = group.id === activeGroupId;
          return joinMode ? (
            <button
              key={group.id}
              type="button"
              className="group-chip is-join"
              onClick={() => void join(group.id)}
            >
              {group.name}に参加
              {group.memberCount > 0 && (
                <span className="group-chip-count">{group.memberCount}人</span>
              )}
            </button>
          ) : (
            <button
              key={group.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`group-chip ${active ? "is-active" : ""} ${mine ? "is-mine" : ""}`}
              onClick={() => onSelect(group.id)}
            >
              {group.name}
              {mine && <span className="group-chip-mine">自分</span>}
              {group.memberCount > 0 && (
                <span className="group-chip-count">{group.memberCount}人</span>
              )}
            </button>
          );
        })}
        {!host && joined && !changing && groups.length > 1 && (
          <button
            type="button"
            className="group-chip is-change"
            onClick={() => setChanging(true)}
          >
            グループを変更
          </button>
        )}
        {!host && changing && (
          <button
            type="button"
            className="group-chip is-change"
            onClick={() => setChanging(false)}
          >
            やめる
          </button>
        )}
      </div>
      {!host && !joined && (
        <p className="group-bar-note">
          自分のグループに参加すると、そのグループのマップに書き込めます。他のグループは見るだけです。
        </p>
      )}
      {error && (
        <p className="group-bar-note" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
