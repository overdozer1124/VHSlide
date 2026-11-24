import { useState } from "react";
import { PencilRuler } from "lucide-react";
import { useEditSlides } from "./EditSlideContext";
import { EditSlideStudio } from "./EditSlideStudio";

/** Student entry point for a free-edit slide: when the slide being
 * viewed is the base of an open definition, offer the studio. The
 * teacher's slide itself is never edited — the studio works on the
 * student's own copy. */
export function SlideEditSlide({ slideId }: { slideId?: string }) {
  const ctx = useEditSlides();
  const [open, setOpen] = useState(false);
  if (!ctx.enabled || ctx.host || !slideId) return null;
  const def = ctx.defs.find(
    (d) => d.source === slideId && d.status === "open",
  );
  if (!def) return null;
  return (
    <>
      <button
        className="button primary edit-slide-launch"
        onClick={() => setOpen(true)}
      >
        <PencilRuler size={18} />
        {def.mine ? "自分のスライドを編集する" : "自分のスライドを作る"}
      </button>
      {open && (
        <EditSlideStudio
          key={`${def.id}:${def.mine?.updated ?? 0}`}
          def={def}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
