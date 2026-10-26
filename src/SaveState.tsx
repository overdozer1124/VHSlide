import { Check, CloudUpload, AlertCircle } from "lucide-react";
import { describeSaveState } from "./saveState";
import type { CloudWorkspace } from "./cloud";
export function SaveState({
  cloud,
  local = "この端末に保存済み",
}: {
  cloud: CloudWorkspace;
  local?: string;
}) {
  const state = cloud.active
    ? describeSaveState(cloud.saveSnapshot)
    : {
        label: local,
        severity:
          local.includes("不足") || local.includes("保留") ? "error" : "saved",
        detail:
          "このブラウザの一時保存です。授業の終わりにファイルへ書き出してください。",
      };
  const Icon =
    state.severity === "error"
      ? AlertCircle
      : state.severity === "pending"
        ? CloudUpload
        : Check;
  return (
    <span
      className="save-state"
      role="status"
      data-save-state={state.severity}
      title={`${state.label} · ${state.detail}`}
    >
      <Icon size={14} aria-hidden="true" />
      <span className="save-state-label">{state.label}</span>
    </span>
  );
}
