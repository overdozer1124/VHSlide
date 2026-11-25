import { useEffect, useRef, useState } from "react";
import { PencilRuler } from "lucide-react";
import { useEditSlides } from "./EditSlideContext";
import { EditSlideStudio } from "./EditSlideStudio";

/** Student entry point for a free-edit slide: when the slide being
 * viewed is the base of an open definition, offer the studio. The
 * teacher's slide itself is never edited — the studio works on the
 * student's own copy. After the intake closes, the entry remains
 * while the student has feedback to read, and a send-back (§4.3)
 * re-opens the studio for that student alone. */
export function SlideEditSlide({ slideId }: { slideId?: string }) {
  const ctx = useEditSlides();
  const [open, setOpen] = useState(false);
  const marked = useRef("");
  const def = ctx.defs.find((d) => d.source === slideId);
  const mine = def
    ? ctx.feedback.filter(
        (f) => f.targetKind === "editslide" && f.targetId === def.id,
      )
    : [];
  const reopenActive = mine.some((f) => f.reopen === 1);
  const unread = mine.filter((f) => f.readAt === null).map((f) => f.id);
  // Showing the feedback here marks it read.
  useEffect(() => {
    if (!unread.length) return;
    const key = unread.join(",");
    if (marked.current === key) return;
    marked.current = key;
    void ctx.markFeedbackRead(unread).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread.join(",")]);
  if (!ctx.enabled || ctx.host || !slideId || !def) return null;
  // A group definition has no entry point for a student who
  // belongs to no group (stage 3b design).
  if (def.mode === "group" && !def.groupId) return null;
  const canEdit = def.status === "open" || reopenActive;
  if (!canEdit && mine.length === 0) return null;
  return (
    <>
      {mine.length > 0 && (
        <div className="edit-slide-feedback" role="status">
          <strong>先生からのフィードバック</strong>
          {mine.slice(0, 3).map((f) => (
            <p key={f.id}>
              {f.stamp && <span className="stamp">{f.stamp}</span>}
              {f.text}
              {f.reopen === 1 && "（書き直して、出し直してください）"}
            </p>
          ))}
        </div>
      )}
      {canEdit && (
        <button
          className="button primary edit-slide-launch"
          onClick={() => setOpen(true)}
        >
          <PencilRuler size={18} />
          {def.mode === "group"
            ? def.mine
              ? "班のスライドを編集する"
              : "班のスライドを作る"
            : def.mine
              ? "自分のスライドを編集する"
              : "自分のスライドを作る"}
        </button>
      )}
      {open && (
        <EditSlideStudio
          key={def.id}
          def={def}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
