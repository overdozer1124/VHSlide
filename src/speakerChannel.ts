import { parseDeck, type Slide } from "./model";
export type SpeakerState = {
  title: string;
  slideTitle: string;
  position: string;
  notes: string;
  preview?: Omit<Slide, "speakerNotes">;
  available: { left: boolean; right: boolean; up: boolean; down: boolean };
};
function validMetadata(value: unknown): value is SpeakerState {
  const v = value as SpeakerState;
  return (
    !!v &&
    typeof v.title === "string" &&
    v.title.length <= 200 &&
    typeof v.slideTitle === "string" &&
    v.slideTitle.length <= 200 &&
    typeof v.position === "string" &&
    v.position.length <= 30 &&
    typeof v.notes === "string" &&
    v.notes.length <= 10000 &&
    !!v.available &&
    ["left", "right", "up", "down"].every(
      (k) =>
        typeof v.available[k as keyof SpeakerState["available"]] === "boolean",
    )
  );
}

export function readSpeakerState(value: unknown): SpeakerState | undefined {
  if (!validMetadata(value)) return;
  if (value.preview === undefined) return value;
  try {
    if (
      !value.preview ||
      typeof value.preview !== "object" ||
      Array.isArray(value.preview)
    )
      return;
    const deck = parseDeck(
      JSON.stringify({
        version: 1,
        title: "発表プレビュー",
        slides: [
          {
            ...value.preview,
            x: 0,
            y: 0,
            sheetId: "main",
            speakerNotes: undefined,
          },
        ],
      }),
    );
    const { speakerNotes: _, ...preview } = deck.slides[0];
    return { ...value, preview };
  } catch {
    return;
  }
}
export function validSpeakerState(value: unknown): value is SpeakerState {
  return !!readSpeakerState(value);
}
export function speakerPreview(slide: Slide): Omit<Slide, "speakerNotes"> {
  const { speakerNotes: _, ...preview } = slide;
  return preview;
}
