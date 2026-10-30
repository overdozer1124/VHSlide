import type { ResolvedPageScope } from "./pageScope";
export function PageScopeSummary({ scope }: { scope: ResolvedPageScope }) {
  return (
    <span
      className="page-scope-summary"
      aria-label={scope.summary}
      title={[scope.summary, scope.details, ...scope.issues]
        .filter(Boolean)
        .join(" / ")}
    >
      <span>{scope.label}</span>
      <b>{scope.pages.length}ページ</b>
    </span>
  );
}
