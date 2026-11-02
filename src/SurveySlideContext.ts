import { createContext } from "react";
import type { SurveyView } from "./surveys";
export type SurveySlideData = {
  deckId?: string;
  userId?: string;
  surveys: SurveyView[];
};
export const SurveySlideContext = createContext<
  SurveySlideData & {
    enabled: boolean;
    onUpdated: (
      surveys: SurveyView[],
      deckId?: string,
      userId?: string,
    ) => void;
  }
>({ enabled: false, surveys: [], onUpdated: () => {} });
