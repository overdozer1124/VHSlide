import { useEffect, useState } from "react";

export const DEFAULT_ZOOM_STEPS = [60, 100];
const KEY = "vhslide-workspace-preferences-v1";
type Preferences = {
  zoomSteps: number[];
  railCollapsed: boolean;
  inspectorCollapsed: boolean;
};
export function parseZoomSteps(text: string): number[] {
  const values = text
    .trim()
    .split(/[\s,、，%％]+/)
    .filter(Boolean)
    .map(Number);
  if (
    !values.length ||
    values.some(
      (value) => !Number.isInteger(value) || value < 10 || value > 300,
    )
  )
    throw new Error(
      "倍率は10〜300の整数を、カンマや空白で区切って入力してください。",
    );
  return [...new Set(values)].sort((a, b) => a - b);
}
export function closestZoom(steps: number[], percent = 100) {
  return steps.reduce((best, value) =>
    Math.abs(value - percent) < Math.abs(best - percent) ? value : best,
  );
}
function initial(): Preferences {
  const fallback = {
    zoomSteps: [...DEFAULT_ZOOM_STEPS],
    railCollapsed: false,
    inspectorCollapsed: false,
  };
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (
      !stored ||
      !Array.isArray(stored.zoomSteps) ||
      stored.zoomSteps.some((value: unknown) => typeof value !== "number")
    )
      return fallback;
    return {
      zoomSteps: parseZoomSteps(stored.zoomSteps.join(",")),
      railCollapsed: stored.railCollapsed === true,
      inspectorCollapsed: stored.inspectorCollapsed === true,
    };
  } catch {
    return fallback;
  }
}
export function useWorkspacePreferences() {
  const [preferences, setPreferences] = useState(initial);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(preferences));
    } catch {
      /* Editing remains available if browser storage is full. */
    }
  }, [preferences]);
  return [preferences, setPreferences] as const;
}
