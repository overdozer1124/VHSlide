import { createContext, useContext } from "react";
import type { Doc } from "yjs";
import { sharedText } from "./sharedDeck";

export const CloudDocument = createContext<Doc | undefined>(undefined);
export function useCloudText(id: string) {
  const doc = useContext(CloudDocument);
  if (!doc) return undefined;
  for (const [slideId] of doc.getMap("slides")) {
    const value = sharedText(doc, slideId, id);
    if (value) return value;
  }
}
