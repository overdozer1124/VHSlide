import { useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  ImagePlus,
  Link2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Shapes,
  Trash2,
  Type,
} from "lucide-react";
import type { Deck, Element, Shape, Slide } from "./model";
import { H, W } from "./model";
import { Canvas } from "./Canvas";
import { EditorPager } from "./EditorPager";
import { useFitCanvas } from "./useFitCanvas";
import { SlideRail } from "./SlideRail";
import type { RailDragSource } from "./RailDrag";
import type { OpenThumbnailMenu } from "./ThumbnailMenu";
const colors = [
  "#ffffff",
  "#e5f0dc",
  "#e7efea",
  "#f8eddc",
  "#f4e5e4",
  "#e4eaf6",
  "#173d38",
  "#d6bc94",
];
interface EditorProps {
  deck: Deck;
  slide: Slide;
  selected?: string;
  setSelected: (id?: string) => void;
  updateSlide: (patch: Partial<Slide>) => void;
  updateElement: (patch: Partial<Element>) => void;
  addElement: (type: "text" | "shape", shape?: Shape) => void;
  onBack: (rect?: DOMRect) => void;
  onImagePicker: () => void;
  onFileDrop: (file: File) => void;
  onSelectSlide: (id: string) => void;
  onInsert: (axis: "row" | "column", index: number, cross: number) => boolean;
  onCreate: (x: number, y: number) => boolean;
  onMove: (
    source: RailDragSource,
    x: number,
    y: number,
    mode?: "swap" | "insert",
  ) => boolean;
  onNavigate: (dx: number, dy: number) => Slide | undefined;
  onToggleLinkedRows: () => void;
  onOpenMenu: OpenThumbnailMenu;
  menuOpen: boolean;
  historyActions: ReactNode;
  railCollapsed: boolean;
  railScale: number;
  onRailScale: (scale: number) => void;
  inspectorCollapsed: boolean;
  onToggleRail: () => void;
  onToggleInspector: () => void;
}
export function Editor({
  deck,
  slide,
  selected,
  setSelected,
  updateSlide,
  updateElement,
  addElement,
  onBack,
  onImagePicker,
  onFileDrop,
  onSelectSlide,
  onInsert,
  onCreate,
  onMove,
  onNavigate,
  onToggleLinkedRows,
  onOpenMenu,
  menuOpen,
  historyActions,
  railCollapsed,
  railScale,
  onRailScale,
  inspectorCollapsed,
  onToggleRail,
  onToggleInspector,
}: EditorProps) {
  const [gestureEpoch, setGestureEpoch] = useState(0);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const focused = railCollapsed && inspectorCollapsed;
  const zoom = useFitCanvas(workspaceRef, focused ? 48 : 85, focused ? 16 : 48);
  const element = slide.elements.find((e) => e.id === selected);
  return (
    <main
      className="editor-main"
      data-inspector-collapsed={inspectorCollapsed}
      data-focused={focused}
    >
      <div className="editor-toolbar">
        <button className="quiet back-map" onClick={() => onBack()}>
          <ArrowLeft size={17} />
          全体マップへ
        </button>
        <span className="small-divider" />
        <button className="tool-button" onClick={() => addElement("text")}>
          <Type size={20} />
          文字
        </button>
        <button className="tool-button" onClick={onImagePicker}>
          <ImagePlus size={20} />
          画像
        </button>
        <label className="shape-picker">
          <Shapes size={20} />
          <select
            aria-label="図形を追加"
            value=""
            onChange={(e) => {
              if (e.target.value) addElement("shape", e.target.value as Shape);
            }}
          >
            <option value="">図形</option>
            <option value="rect">四角</option>
            <option value="rounded">角丸四角</option>
            <option value="circle">丸</option>
            <option value="arrow">矢印</option>
            <option value="bubble">吹き出し</option>
          </select>
        </label>
        <button
          className="tool-button row-link-toggle"
          role="switch"
          aria-label="縦の連動"
          aria-checked={!!deck.linkedRows}
          title={
            deck.linkedRows
              ? "同じ話題で縦のページをそろえています"
              : "段ごとに表示するページを選べます"
          }
          onClick={onToggleLinkedRows}
        >
          <Link2 size={17} />
          縦の連動 <span>{deck.linkedRows ? "オン" : "オフ"}</span>
        </button>
        <div
          className="editor-panel-toggles"
          role="group"
          aria-label="編集画面の表示"
        >
          <button
            className="tool-button"
            aria-label={
              railCollapsed ? "サムネイルバーを表示" : "サムネイルバーをたたむ"
            }
            title={
              railCollapsed ? "サムネイルバーを表示" : "サムネイルバーをたたむ"
            }
            aria-expanded={!railCollapsed}
            aria-controls="editor-thumbnails"
            onClick={onToggleRail}
          >
            {railCollapsed ? (
              <PanelLeftOpen size={19} />
            ) : (
              <PanelLeftClose size={19} />
            )}
          </button>
          <button
            className="tool-button"
            aria-label={
              inspectorCollapsed
                ? "右のサイドバーを表示"
                : "右のサイドバーをたたむ"
            }
            title={
              inspectorCollapsed
                ? "右のサイドバーを表示"
                : "右のサイドバーをたたむ"
            }
            aria-expanded={!inspectorCollapsed}
            aria-controls="editor-inspector"
            onClick={onToggleInspector}
          >
            {inspectorCollapsed ? (
              <PanelRightOpen size={19} />
            ) : (
              <PanelRightClose size={19} />
            )}
          </button>
        </div>
        {historyActions}
      </div>
      <div
        className="editor-layout"
        data-rail-collapsed={railCollapsed}
        data-inspector-collapsed={inspectorCollapsed}
      >
        {!railCollapsed && (
          <SlideRail
            scale={railScale}
            onScale={onRailScale}
            deck={deck}
            slide={slide}
            onSelectSlide={onSelectSlide}
            onInsert={onInsert}
            onCreate={onCreate}
            onMove={onMove}
            onNavigate={onNavigate}
            onOpenMenu={onOpenMenu}
            menuOpen={menuOpen}
          />
        )}
        <div
          className="editor-workspace"
          ref={workspaceRef}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files[0]) onFileDrop(e.dataTransfer.files[0]);
          }}
        >
          <div className="canvas-title">
            <input
              aria-label="ページの名前"
              maxLength={200}
              value={slide.title}
              onChange={(e) => updateSlide({ title: e.target.value })}
            />
            <span>
              {slide.y + 1}.{slide.x + 1} / 16:9
            </span>
          </div>
          <EditorPager
            deck={deck}
            slide={slide}
            zoom={zoom}
            onNavigate={onNavigate}
            onMap={onBack}
            onPinchStart={() => setGestureEpoch((epoch) => epoch + 1)}
          >
            <Canvas
              slide={slide}
              zoom={zoom}
              editable
              selected={selected}
              onSelect={setSelected}
              touchNavigation
              gestureEpoch={gestureEpoch}
              onChange={(e) =>
                updateSlide({
                  elements: slide.elements.map((original) =>
                    original.id === e.id ? e : original,
                  ),
                })
              }
            />
          </EditorPager>
          <div className="canvas-hint">
            <span>
              {element
                ? "文字はタップで入力 · 移動ハンドルで動かす · 右下でサイズ変更"
                : "ページ移動：どこでも1本指でスワイプ · タッチパッドは2本指"}
            </span>
          </div>
        </div>
        {!inspectorCollapsed && (
          <aside className="inspector" id="editor-inspector">
            <h2>{element ? "選んだものを編集" : "ページのデザイン"}</h2>
            {!element ? (
              <>
                <label>
                  背景の色
                  <input
                    type="color"
                    aria-label="背景の色"
                    value={slide.background}
                    onChange={(e) =>
                      updateSlide({ background: e.target.value })
                    }
                  />
                </label>
                <div className="swatches">
                  {colors.map((color) => (
                    <button
                      key={color}
                      style={{ background: color }}
                      aria-label={`背景を${color}に変更`}
                      onClick={() => updateSlide({ background: color })}
                    />
                  ))}
                </div>
                <p className="inspector-note">
                  キャンバスの中の文字や図形をタップすると、色や大きさを変えられます。
                </p>
              </>
            ) : (
              <>
                {element.type === "text" && (
                  <>
                    <p className="inspector-note inline-edit-note">
                      文字の内容はキャンバス内で直接入力できます。文字の枠をクリックして編集します。
                    </p>
                    <label>
                      文字の大きさ
                      <input
                        aria-label="文字の大きさ"
                        type="number"
                        min={12}
                        max={120}
                        value={element.fontSize}
                        onChange={(e) =>
                          updateElement({
                            fontSize: Math.max(
                              12,
                              Math.min(120, Number(e.target.value) || 12),
                            ),
                          })
                        }
                      />
                    </label>
                    <div className="format-buttons">
                      <button
                        aria-pressed={!!element.bold}
                        onClick={() => updateElement({ bold: !element.bold })}
                      >
                        <b>B</b> 太字
                      </button>
                      <button
                        aria-pressed={!!element.bullets}
                        onClick={() =>
                          updateElement({ bullets: !element.bullets })
                        }
                      >
                        ☷ 箇条書き
                      </button>
                    </div>
                    <label>
                      文字の色
                      <input
                        type="color"
                        aria-label="文字の色"
                        value={element.color}
                        onChange={(e) =>
                          updateElement({ color: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      ハイライト
                      <input
                        type="color"
                        aria-label="ハイライトの色"
                        value={element.highlight ?? "#ffffff"}
                        onChange={(e) =>
                          updateElement({ highlight: e.target.value })
                        }
                      />
                    </label>
                    {element.highlight && (
                      <button
                        className="quiet"
                        onClick={() => updateElement({ highlight: undefined })}
                      >
                        ハイライトを消す
                      </button>
                    )}
                  </>
                )}
                {element.type === "shape" && (
                  <>
                    <label>
                      塗りの色
                      <input
                        type="color"
                        aria-label="図形の塗り色"
                        value={element.fill}
                        onChange={(e) =>
                          updateElement({ fill: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      枠線の色
                      <input
                        type="color"
                        aria-label="図形の枠線色"
                        value={element.stroke}
                        onChange={(e) =>
                          updateElement({ stroke: e.target.value })
                        }
                      />
                    </label>
                  </>
                )}
                <div className="inspector-section">
                  <h3>そろえる・重なり</h3>
                  <div className="arrange-buttons">
                    <button onClick={() => updateElement({ x: 0 })}>左</button>
                    <button
                      onClick={() => updateElement({ x: (W - element.w) / 2 })}
                    >
                      中央
                    </button>
                    <button onClick={() => updateElement({ x: W - element.w })}>
                      右
                    </button>
                    <button onClick={() => updateElement({ y: 0 })}>上</button>
                    <button
                      onClick={() => updateElement({ y: (H - element.h) / 2 })}
                    >
                      まん中
                    </button>
                    <button onClick={() => updateElement({ y: H - element.h })}>
                      下
                    </button>
                  </div>
                  <button
                    className="wide-button"
                    onClick={() =>
                      updateSlide({
                        elements: [
                          ...slide.elements.filter((e) => e.id !== selected),
                          element,
                        ],
                      })
                    }
                  >
                    最前面へ
                  </button>
                  <button
                    className="wide-button"
                    onClick={() =>
                      updateSlide({
                        elements: [
                          element,
                          ...slide.elements.filter((e) => e.id !== selected),
                        ],
                      })
                    }
                  >
                    最背面へ
                  </button>
                </div>
                <button
                  className="danger-button"
                  onClick={() => {
                    updateSlide({
                      elements: slide.elements.filter((e) => e.id !== selected),
                    });
                    setSelected(undefined);
                  }}
                >
                  <Trash2 size={16} />
                  選んだものを削除
                </button>
              </>
            )}
          </aside>
        )}
      </div>
    </main>
  );
}
