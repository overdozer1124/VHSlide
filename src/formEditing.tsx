import type { ChangeEvent } from "react";
import type { SurveyKind } from "./surveys";
import type { WorksheetDefinition } from "./worksheets";
export type SurveyDefinition = {
  question: string;
  kind: SurveyKind;
  options: string[];
};
export type FormDraft = { elementId: string; deckId: string; id: string } & (
  | {
      kind: "worksheet";
      expected: WorksheetDefinition;
      value: WorksheetDefinition;
    }
  | { kind: "survey"; expected: SurveyDefinition; value: SurveyDefinition }
);
export function FormDraftInput({
  value,
  label,
  maxLength,
  onChange,
  placeholder,
}: {
  value: string;
  label: string;
  maxLength: number;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      className="form-draft-input"
      aria-label={label}
      value={value}
      maxLength={maxLength}
      placeholder={placeholder}
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") e.preventDefault();
      }}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
    />
  );
}
