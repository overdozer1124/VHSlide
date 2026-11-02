import { useContext } from "react";
import type { Element } from "./model";
import { SurveySlideContext } from "./SurveySlideContext";
import { resolveSurveyResult } from "./surveyResults";
import { RichTextView } from "./RichTextView";
export function SurveyResultCaption({ element }: { element: Element }) {
  const data = useContext(SurveySlideContext);
  return <RichTextView element={resolveSurveyResult(element, data)} />;
}
