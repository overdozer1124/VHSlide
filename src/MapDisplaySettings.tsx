import type { ReactNode } from "react";
import { Hash, LocateFixed, Maximize2, SlidersHorizontal } from "lucide-react";
import { Palette } from "./ObjectPalette";
import { MapZoomSettings } from "./MapZoomSettings";

export function MapDisplaySettings({
  numbers,
  onNumbers,
  onLocate,
  onFit,
  steps,
  onSteps,
  children,
}: {
  numbers: boolean;
  onNumbers: () => void;
  onLocate: () => void;
  onFit: () => void;
  steps: number[];
  onSteps: (steps: number[]) => void;
  children?: ReactNode;
}) {
  return (
    <Palette
      label="マップの表示設定"
      text="表示"
      heading="マップの表示"
      icon={<SlidersHorizontal size={17} />}
      disabled={false}
    >
      {(close) => (
        <div className="map-display-settings">
          <button
            className="button outline"
            aria-label="番号だけの一覧"
            aria-pressed={numbers}
            onClick={() => {
              onNumbers();
              close();
            }}
          >
            <Hash size={17} />
            番号だけの一覧
          </button>
          <button
            className="button outline"
            aria-label="いまのページを表示"
            onClick={() => {
              onLocate();
              close();
            }}
          >
            <LocateFixed size={17} />
            いまのページを表示
          </button>
          <button
            className="button outline map-fit"
            onClick={() => {
              onFit();
              close();
            }}
          >
            <Maximize2 size={17} />
            横をおさめる
          </button>
          {children}
          <MapZoomSettings
            embedded
            steps={steps}
            onApply={onSteps}
            onDone={close}
          />
        </div>
      )}
    </Palette>
  );
}
