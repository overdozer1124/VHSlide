import { useEffect, useState } from "react";
import { axisId } from "./axes";
import type { Deck, Slide } from "./model";
import type { AccountLabels } from "./preSharing";
export function thumbnailAccountNames(
  slide: Slide,
  accounts?: AccountLabels,
  deck?: Deck,
) {
  const sheet = slide.sheetId ?? "main";
  const ownNames = (
    map: Record<string, string[]> | undefined,
    key: string | number,
  ) => (map && Object.hasOwn(map, String(key)) ? map[String(key)] : []);
  const names = accounts
    ? [
        ...accounts.all,
        ...ownNames(
          Object.hasOwn(accounts.rows, sheet)
            ? accounts.rows[sheet]
            : undefined,
          axisId(deck, sheet, "rows", slide.y),
        ),
        ...ownNames(
          Object.hasOwn(accounts.columns, sheet)
            ? accounts.columns[sheet]
            : undefined,
          axisId(deck, sheet, "columns", slide.x),
        ),
        ...ownNames(accounts.slides, slide.id),
      ]
    : [];
  return [...new Set(names)];
}
export function thumbnailLabel(
  slide: Slide,
  accounts?: AccountLabels,
  deck?: Deck,
) {
  if (slide.footerLabel?.trim()) return slide.footerLabel;
  return thumbnailAccountNames(slide, accounts, deck).join("・") || slide.title;
}
export function ThumbnailFooter({
  slide,
  label,
  editable,
  onChange,
  className = "",
}: {
  slide: Slide;
  label: string;
  editable: boolean;
  onChange: (id: string, text: string) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(label);
  useEffect(() => setDraft(label), [label]);
  return (
    <input
      className={`thumbnail-footer-input ${className}`}
      aria-label={`${slide.y + 1}.${slide.x + 1}のフッター`}
      title={`${label}（空欄で共有相手名・ページ名を自動表示）`}
      value={draft}
      readOnly={!editable}
      maxLength={80}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => {
        if (editable) e.currentTarget.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        const text = e.currentTarget.value.trim();
        if (editable && text !== label) onChange(slide.id, text);
        setDraft(text || label);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          e.currentTarget.value = label;
          setDraft(label);
          e.currentTarget.blur();
        }
      }}
    />
  );
}
