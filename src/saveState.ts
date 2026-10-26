export type CloudSaveSnapshot = {
  document: "saved" | "saving" | "reconnecting" | "stopped" | "recovery";
  notesSaving: number;
  notesFailed: number;
  notesDirty: number;
};
export function describeSaveState(s: CloudSaveSnapshot) {
  const notes = s.notesFailed
    ? `付箋${s.notesFailed}件を再試行`
    : s.notesSaving || s.notesDirty
      ? "付箋を保存中"
      : "";
  const base = {
    saved: "クラウドに保存済み",
    saving: "クラウドに保存中",
    reconnecting: "再接続中・端末に一時保存",
    stopped: "共有停止・復旧を確認",
    recovery: "一時保存の復旧を確認",
  }[s.document];
  return {
    label:
      s.document === "saved" && notes
        ? `本文は保存済み・${notes}`
        : notes
          ? `${base}・${notes}`
          : base,
    severity:
      s.document === "stopped" || s.document === "recovery" || s.notesFailed
        ? "error"
        : s.document !== "saved" || s.notesSaving || s.notesDirty
          ? "pending"
          : "saved",
    detail:
      "本文と付箋の保存状態です。端末へ書き出すJSONには付箋・共有設定・過去の版は含みません。",
  };
}
