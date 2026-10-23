import { useEffect, useState } from "react";
/** Commit once on blur/Enter; Escape cancels. Coordinates remain stable. */
export function MapHeading({
  label,
  value,
  placeholder,
  editable,
  vertical,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  editable: boolean;
  vertical?: boolean;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <textarea
      className={`map-heading-input ${vertical ? "vertical" : ""}`}
      aria-label={label}
      title={value || placeholder}
      value={draft}
      placeholder={placeholder}
      readOnly={!editable}
      maxLength={80}
      rows={1}
      spellCheck={false}
      onFocus={(e) => {
        if (editable) e.currentTarget.select();
      }}
      onChange={(e) => setDraft(e.target.value.replace(/[\r\n]/g, ""))}
      onBlur={(e) => {
        const next = e.currentTarget.value.trim();
        if (next !== value) onChange(next);
        setDraft(next || value);
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
          e.currentTarget.value = value;
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
    />
  );
}
