import { memo, useEffect, useRef, useState } from "react";
import type { Deck, Slide } from "./model";
import { Canvas } from "./Canvas";
import { slideLabel } from "./learningTools";
const Preview = memo(Canvas);
export function SlidePicker({
  book,
  pages,
  ids,
  onChange,
  maxSelected,
}: {
  book: Deck;
  pages: Slide[];
  ids: string[];
  onChange: (ids: string[]) => void;
  maxSelected?: number;
}) {
  const root = useRef<HTMLDivElement>(null),
    [visible, setVisible] = useState(new Set<string>()),
    [width, setWidth] = useState(200);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) =>
        setVisible((previous) => {
          const next = new Set(previous);
          for (const entry of entries) {
            const id = (entry.target as HTMLElement).dataset.choice!;
            if (entry.isIntersecting) next.add(id);
            else next.delete(id);
          }
          return next;
        }),
      { root: root.current, rootMargin: "80px" },
    );
    root
      .current!.querySelectorAll("[data-choice]")
      .forEach((el) => observer.observe(el));
    const resize = new ResizeObserver(() => {
      const card = root.current?.querySelector<HTMLElement>(".choice-preview");
      if (card) setWidth(card.clientWidth);
    });
    resize.observe(root.current!);
    return () => {
      observer.disconnect();
      resize.disconnect();
    };
  }, [pages]);
  return (
    <div ref={root} className="slide-picker" aria-label="対象スライド">
      {pages.map((s) => (
        <label
          key={s.id}
          data-choice={s.id}
          className={ids.includes(s.id) ? "chosen" : ""}
        >
          <div
            className="choice-preview"
            aria-hidden="true"
            style={{ background: s.background }}
          >
            {visible.has(s.id) && <Preview slide={s} zoom={width / 960} />}
          </div>
          <span className="choice-caption">
            <input
              type="checkbox"
              checked={ids.includes(s.id)}
              disabled={
                maxSelected !== undefined &&
                ids.length >= maxSelected &&
                !ids.includes(s.id)
              }
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...ids, s.id]
                    : ids.filter((id) => id !== s.id),
                )
              }
            />
            <span>{slideLabel(book, s)}</span>
            {ids.includes(s.id) && (
              <b aria-label={`選択順${ids.indexOf(s.id) + 1}`}>
                {ids.indexOf(s.id) + 1}
              </b>
            )}
          </span>
        </label>
      ))}
    </div>
  );
}
