import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { ClipboardList, X } from "lucide-react";
import { useWorksheets } from "./WorksheetContext";
type Kind = "survey" | "worksheet" | "gallery";
const Context = createContext({
  open: false,
  active: "survey" as Kind,
  close: () => {},
});
export const useActivityPanel = () => useContext(Context);
export function ActivitiesPanel({
  survey,
  worksheet,
  gallery,
  surveyCount,
  blocked,
  presenting,
}: {
  survey: ReactNode;
  worksheet: ReactNode;
  gallery: ReactNode;
  surveyCount: number;
  blocked: boolean;
  presenting: boolean;
}) {
  const ctx = useWorksheets();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<Kind>("survey");
  const modal = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const id = useId();
  const title =
    active === "survey"
      ? "アンケート"
      : active === "worksheet"
        ? "ワークシート"
        : "回答スライド";
  function launch(kind: Kind, element: HTMLElement) {
    trigger.current = element;
    setActive(kind);
    setOpen(true);
  }
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  useEffect(() => {
    if (open) modal.current?.focus();
  }, [open]);
  return (
    <Context.Provider value={{ open, active, close }}>
      <button
        className={`button outline survey-launch ${presenting ? "in-presentation" : ""}`}
        disabled={blocked}
        aria-label="アンケート・ワークシート"
        title={`アンケート受付中${surveyCount}件・ワークシート${ctx.sheets.length}件`}
        onClick={(e) => launch(active, e.currentTarget)}
      >
        <ClipboardList size={17} />
        <span>アンケート・ワークシート</span>
      </button>
      <div
        className="survey-overlay activity-overlay"
        hidden={!open}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
          if (e.key === "Tab") {
            const items = Array.from(
              modal.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,[tabindex="0"]',
              ) ?? [],
            ).filter(
              (el) =>
                el.tabIndex >= 0 &&
                el.getClientRects().length > 0 &&
                getComputedStyle(el).visibility !== "hidden" &&
                !el.closest("[hidden],[inert]") &&
                (!el.closest("details:not([open])") ||
                  (el.tagName === "SUMMARY" &&
                    el.parentElement === el.closest("details:not([open])"))),
            );
            const first = items[0],
              last = items[items.length - 1];
            if (
              e.shiftKey &&
              (document.activeElement === first ||
                document.activeElement === modal.current)
            ) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <section
          className="survey-panel worksheet-panel activity-panel"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          id={id}
          tabIndex={-1}
          ref={modal}
        >
          <header>
            <h2>アンケート・ワークシート</h2>
            <button
              className="button outline"
              aria-label={`${title}を閉じる`}
              onClick={close}
            >
              <X size={18} />
            </button>
          </header>
          <div
            className="activity-tabs"
            role="tablist"
            aria-label="アンケートとワークシートの切替"
            onKeyDown={(e) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
                return;
              e.preventDefault();
              const kinds = ["survey", "worksheet", "gallery"] as const;
              const next =
                kinds[
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? 2
                      : (kinds.indexOf(active) +
                          (e.key === "ArrowRight" ? 1 : 2)) %
                        3
                ];
              setActive(next);
              e.currentTarget
                .querySelector<HTMLButtonElement>(`[data-kind="${next}"]`)
                ?.focus();
            }}
          >
            {(["survey", "worksheet", "gallery"] as const).map((kind) => (
              <button
                key={kind}
                id={`${id}-${kind}-tab`}
                data-kind={kind}
                role="tab"
                aria-selected={active === kind}
                aria-controls={`${id}-${kind}-pane`}
                tabIndex={active === kind ? 0 : -1}
                onClick={() => setActive(kind)}
              >
                {kind === "survey"
                  ? "アンケート"
                  : kind === "worksheet"
                    ? "ワークシート"
                    : "回答スライド"}
              </button>
            ))}
          </div>
          <div
            className="activity-content"
            role="tabpanel"
            id={`${id}-survey-pane`}
            aria-labelledby={`${id}-survey-tab`}
            hidden={active !== "survey"}
          >
            {survey}
          </div>
          <div
            className="activity-content"
            role="tabpanel"
            id={`${id}-worksheet-pane`}
            aria-labelledby={`${id}-worksheet-tab`}
            hidden={active !== "worksheet"}
          >
            {worksheet}
          </div>
          <div
            className="activity-content"
            role="tabpanel"
            id={`${id}-gallery-pane`}
            aria-labelledby={`${id}-gallery-tab`}
            hidden={active !== "gallery"}
          >
            {gallery}
          </div>
        </section>
      </div>
    </Context.Provider>
  );
}
