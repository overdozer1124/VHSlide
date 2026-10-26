import { EditorInspector, TableInspector } from "./EditorInspector";
import type { ResolvedPageScope } from "./pageScope";
import { PageScopeSummary } from "./PageScopeSummary";
import { resolveConnections } from "./structureData";
import {
  StructureInsert,
  GroupControls,
  ConnectorControls,
  ChartControls,
  ObjectLinkControls,
} from "./StructureTools";
import { pasteTable, MAX_CELL_TEXT } from "./tableData";
import { uid } from "./model";
import { TextSelectionControls } from "./TextSelectionControls";
import type { TextController } from "./TextSelectionControls";
import { TableCellControls } from "./TableCellControls";
import type { CellSelection } from "./TableCellControls";
import { ImageControls } from "./ImageTools";
import { ObjectPalette } from "./ObjectPalette";
import { ObjectLayout, StrokeControls } from "./ObjectLayout";
import type { Arrange } from "./objectEditing";
import { TableInsert, TableControls } from "./TableTools";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  Filter,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  ImagePlus,
  Link2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Type,
  Users,
} from "lucide-react";
import type { Deck, Element, Shape, Slide } from "./model";
import { Canvas } from "./Canvas";
import { EditorPager } from "./EditorPager";
import { useFitCanvas } from "./useFitCanvas";
import type { CloudWorkspace } from "./cloud";
import { thumbnailAccountNames, thumbnailLabel } from "./ThumbnailFooter";
import { SlideComments } from "./SlideComments";
import { StickyNote } from "lucide-react";
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
  scope: ResolvedPageScope;
  editable: boolean;
  linkDeck: Deck;
  onOpenLink: (id: string) => void;
  onInsertStructure: (elements: Element[]) => void;
  onGroup: () => void;
  onUngroup: () => void;
  onSelectGroup: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onReplaceImage: (file: File, id: string) => void;
  onFooterChange: (id: string, text: string) => void;
  cloud?: CloudWorkspace;
  deck: Deck;
  navigationDeck: Deck;
  filtered: boolean;
  filterAvailable: boolean;
  onToggleFilter: () => void;
  slide: Slide;
  selected?: string;
  selectedIds: string[];
  setSelected: (id?: string, additive?: boolean, inside?: boolean) => void;
  onArrange: (action: Arrange) => void;
  onDuplicate: () => void;
  onDeleteSelection: () => void;
  updateSlide: (patch: Partial<Slide>) => void;
  updateElement: (patch: Partial<Element>) => void;
  addElement: (
    type: "text" | "shape" | "line",
    shape?: Shape,
    lineKind?: Element["lineKind"],
    endArrow?: Element["endArrow"],
    startArrow?: Element["startArrow"],
  ) => void;
  addTable: (rows: number, columns: number) => void;
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
  railNumbers: boolean;
  onToggleRailNumbers: () => void;
  onRailScale: (scale: number) => void;
  inspectorCollapsed: boolean;
  onToggleRail: () => void;
  onToggleInspector: () => void;
}
export function Editor({
  scope,
  editable,
  linkDeck,
  onOpenLink,
  onInsertStructure,
  onGroup,
  onUngroup,
  onSelectGroup,
  onUndo,
  onRedo,
  onReplaceImage,
  onFooterChange,
  cloud,
  deck,
  navigationDeck,
  filtered,
  filterAvailable,
  onToggleFilter,
  slide,
  selected,
  selectedIds,
  setSelected,
  onArrange,
  onDuplicate,
  onDeleteSelection,
  updateSlide,
  updateElement,
  addElement,
  addTable,
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
  railNumbers,
  onToggleRailNumbers,
  onRailScale,
  inspectorCollapsed,
  onToggleRail,
  onToggleInspector,
}: EditorProps) {
  const [textController, setTextController] = useState<TextController>();
  const [cellSelection, setCellSelection] = useState<CellSelection>();
  const [cellRangeMode, setCellRangeMode] = useState(false);
  const [tableMessage, setTableMessage] = useState("");
  useEffect(() => {
    setCellSelection((previous) =>
      previous?.id === selected ? previous : undefined,
    );
    setCellRangeMode(false);
  }, [slide.id, selected]);
  const [noteRequest, setNoteRequest] = useState(0);
  const [multiMode, setMultiMode] = useState(false);
  useEffect(() => setMultiMode(false), [slide.id]);
  const [gestureEpoch, setGestureEpoch] = useState(0);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const focused = railCollapsed && inspectorCollapsed;
  const zoom = useFitCanvas(workspaceRef, focused ? 48 : 85, focused ? 16 : 48);
  const assignees = thumbnailAccountNames(
    slide,
    cloud?.accountLabels,
    deck,
  ).join("・");
  const resolvedElements = resolveConnections(slide.elements);
  const element = resolvedElements.find((e) => e.id === selected);
  const chosen = resolvedElements.filter((e) => selectedIds.includes(e.id));
  useEffect(() => {
    if (
      !editable ||
      !cellRangeMode ||
      element?.type !== "table" ||
      cellSelection?.id !== element.id ||
      !cellSelection.keys.length
    )
      return;
    const table = element.table!,
      keys = cellSelection.keys.filter((k) => k in table.cells);
    if (!keys.length) return;
    const inSetting = (target: EventTarget | null) =>
      !!cloud?.panel ||
      !!document.querySelector('[aria-modal="true"], [role="menu"]') ||
      (target instanceof HTMLElement &&
        !!target.closest(
          "input,textarea,select,[contenteditable],[role=dialog],.inspector",
        ) &&
        !target.closest(".slide-table"));
    const clear = (event: KeyboardEvent) => {
      if (
        !["Delete", "Backspace"].includes(event.key) ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        inSetting(event.target)
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      updateElement({
        table: {
          ...table,
          cells: {
            ...table.cells,
            ...Object.fromEntries(keys.map((k) => [k, ""])),
          },
        },
      });
      setTableMessage("");
    };
    const paste = (event: ClipboardEvent) => {
      if (inSetting(event.target)) return;
      const text = event.clipboardData?.getData("text/plain");
      if (
        text === undefined ||
        (!text &&
          Array.from(event.clipboardData?.items ?? []).some((i) =>
            i.type.startsWith("image/"),
          ))
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      try {
        if (!text.includes("\t") && !text.includes("\n")) {
          if (text.length > MAX_CELL_TEXT)
            throw new Error("セルの文字は2000文字まで貼り付けできます。");
          updateElement({
            table: {
              ...table,
              cells: {
                ...table.cells,
                ...Object.fromEntries(keys.map((k) => [k, text])),
              },
            },
          });
        } else {
          const result = pasteTable(table, keys[0], text, uid);
          updateElement({ table: result.table });
          setCellSelection({ id: element.id, keys: result.keys });
        }
        setTableMessage("");
      } catch (error) {
        setTableMessage(
          error instanceof Error ? error.message : "貼り付けできませんでした。",
        );
      }
    };
    window.addEventListener("keydown", clear, true);
    window.addEventListener("paste", paste, true);
    return () => {
      window.removeEventListener("keydown", clear, true);
      window.removeEventListener("paste", paste, true);
    };
  }, [editable, cellRangeMode, element, cellSelection, updateElement]);

  function updateTextBase(patch: Partial<Element>) {
    if (!element?.richText) return updateElement(patch);
    const richText = element.richText.flatMap((op) =>
      op.insert.split("\n").flatMap((text, i, all) => {
        const attrs = { ...op.attributes };
        if (patch.bold !== undefined) {
          if (patch.bold) attrs.bold = true;
          else delete attrs.bold;
        }
        if (patch.fontSize !== undefined)
          attrs.size = `${Math.round(patch.fontSize)}px`;
        if (patch.color !== undefined) attrs.color = patch.color;
        if ("highlight" in patch) {
          if (patch.highlight) attrs.background = patch.highlight;
          else delete attrs.background;
        }
        const block = { ...attrs };
        if (patch.textAlign !== undefined) {
          if (patch.textAlign === "left") delete block.align;
          else block.align = patch.textAlign;
        }
        if (patch.bullets !== undefined) {
          if (patch.bullets) block.list = "bullet";
          else delete block.list;
        }
        // Preserve line attributes only on newline ops.
        delete attrs.align;
        delete attrs.list;
        delete attrs.lineheight;
        return [
          ...(text
            ? [
                {
                  insert: text,
                  ...(Object.keys(attrs).length ? { attributes: attrs } : {}),
                },
              ]
            : []),
          ...(i < all.length - 1
            ? [
                {
                  insert: "\n",
                  ...(Object.keys(block).length ? { attributes: block } : {}),
                },
              ]
            : []),
        ];
      }),
    );
    updateElement({ ...patch, richText });
  }

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
        <button
          className="tool-button"
          disabled={!editable}
          onClick={() => addElement("text")}
        >
          <Type size={20} />
          文字
        </button>
        <button
          className="tool-button"
          disabled={!editable}
          onClick={onImagePicker}
        >
          <ImagePlus size={20} />
          画像
        </button>
        {cloud && (
          <button
            className="tool-button"
            aria-label="付箋を追加"
            title={
              cloud.access.comment
                ? "付箋を追加して、そのまま入力"
                : "コメントの投稿は許可されていません。"
            }
            disabled={!cloud.access.comment}
            onClick={() => setNoteRequest((n) => n + 1)}
          >
            <StickyNote size={20} />
            付箋
          </button>
        )}
        <TableInsert disabled={!editable} onInsert={addTable} />
        <ObjectPalette disabled={!editable} onAdd={addElement} />
        <StructureInsert disabled={!editable} onInsert={onInsertStructure} />
        <button
          className="tool-button"
          aria-label="まとめて選択"
          aria-pressed={multiMode}
          disabled={!editable}
          onClick={() => setMultiMode(!multiMode)}
        >
          <span aria-hidden="true">▧</span>{" "}
          {multiMode ? "選択を完了" : "まとめて選択"}
        </button>
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
        {filterAvailable && (
          <button
            className="tool-button editor-filter-toggle"
            aria-label="編集画面にもフィルタを適用"
            aria-pressed={filtered}
            title={
              filtered
                ? `${navigationDeck.slides.length}ページに絞り込み中（押すと解除）`
                : "押すと選択したページだけを編集"
            }
            onClick={onToggleFilter}
          >
            <Filter size={18} />
            <span>編集も絞り込み</span>
          </button>
        )}
        {historyActions}
      </div>
      <div
        className="editor-layout"
        data-rail-collapsed={railCollapsed}
        data-inspector-collapsed={inspectorCollapsed}
      >
        {!railCollapsed && (
          <SlideRail
            numbers={railNumbers}
            footerLabel={(page) =>
              thumbnailLabel(page, cloud?.accountLabels, deck)
            }
            footerEditable={(page) => cloud?.canEdit(page) ?? true}
            onFooterChange={onFooterChange}
            onToggleNumbers={onToggleRailNumbers}
            scale={railScale}
            onScale={onRailScale}
            deck={navigationDeck}
            filtered={filtered}
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
            <PageScopeSummary scope={scope} />
            <input
              aria-label="ページの名前"
              readOnly={!editable}
              maxLength={200}
              value={slide.title}
              onChange={(e) => updateSlide({ title: e.target.value })}
            />
            {assignees && (
              <span
                className="canvas-assignees"
                role="group"
                aria-label="このスライドの共有者"
                title={`共有：${assignees}`}
              >
                <Users size={16} aria-hidden="true" />
                <span>共有：{assignees}</span>
              </span>
            )}
            <span className="object-selection-status" role="status">
              {multiMode
                ? "タップで選択を追加・解除"
                : chosen.length > 1
                  ? `${chosen.length}個を選択中 · 枠でまとめて移動`
                  : ""}
              {(multiMode || chosen.length > 1) && (
                <button
                  className="quiet"
                  onClick={() => {
                    setSelected();
                    setMultiMode(false);
                  }}
                >
                  選択を解除
                </button>
              )}
            </span>
            <span className="canvas-page-position">
              {slide.y + 1}.{slide.x + 1} / 16:9
            </span>
          </div>
          <EditorPager
            deck={navigationDeck}
            slide={slide}
            zoom={zoom}
            onNavigate={onNavigate}
            onMap={onBack}
            onPinchStart={() => setGestureEpoch((epoch) => epoch + 1)}
          >
            <Canvas
              slide={slide}
              zoom={zoom}
              editable={editable}
              selected={selected}
              selectedIds={selectedIds}
              selectMultiple={multiMode}
              onSelect={setSelected}
              onOpenLink={onOpenLink}
              touchNavigation
              gestureEpoch={gestureEpoch}
              onTextController={setTextController}
              onUndo={onUndo}
              onRedo={onRedo}
              cellSelection={cellSelection}
              onCellSelection={setCellSelection}
              cellRangeMode={cellRangeMode}
              onChangeMany={(values) =>
                updateSlide({
                  elements: slide.elements.map(
                    (e) => values.find((v) => v.id === e.id) ?? e,
                  ),
                })
              }
              onChange={(e) =>
                updateSlide({
                  elements: slide.elements.map((original) =>
                    original.id === e.id ? e : original,
                  ),
                })
              }
            />
            {cloud && (
              <SlideComments
                key={`${cloud.active?.id}:${slide.id}`}
                cloud={cloud}
                slide={slide}
                addRequest={noteRequest}
              />
            )}
          </EditorPager>
          <div className="canvas-hint">
            <span>
              {element
                ? "文字はタップで入力 · 枠をドラッグして移動 · 右下でサイズ変更"
                : "ページ移動：どこでも1本指でスワイプ · タッチパッドは2本指"}
            </span>
          </div>
        </div>
        {!inspectorCollapsed && (
          <aside className="inspector" id="editor-inspector">
            <EditorInspector
              pageKey={`${cloud?.active?.id ?? "local"}:${slide.id}`}
              pageElements={slide.elements}
              cellSelection={cellSelection}
              element={element}
              count={chosen.length}
              disabled={!editable}
              onDuplicate={onDuplicate}
              onDelete={onDeleteSelection}
              onSectionChange={(section) => {
                if (section !== "appearance") setCellRangeMode(false);
              }}
              group={
                chosen.length > 0 ? (
                  <GroupControls
                    elements={chosen}
                    onGroup={onGroup}
                    onUngroup={onUngroup}
                    onSelectGroup={onSelectGroup}
                  />
                ) : null
              }
              appearance={
                !element ? (
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
                    {element.type === "shape" && element.text === undefined && (
                      <button
                        className="wide-button"
                        onClick={() =>
                          updateElement({
                            text: "ここにことばを入力",
                            fontSize: 24,
                            color: "#173d38",
                            textAlign: "center",
                            verticalAlign: "middle",
                          })
                        }
                      >
                        図形に文字を入れる
                      </button>
                    )}
                    {(element.type === "text" ||
                      (element.type === "shape" &&
                        element.text !== undefined)) && (
                      <>
                        {textController?.id === element.id && (
                          <TextSelectionControls control={textController} />
                        )}
                        <details
                          className="whole-text-settings"
                          open={textController?.id !== element.id}
                        >
                          <summary>ボックス全体の基本書式</summary>
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
                                updateTextBase({
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
                              onClick={() =>
                                updateTextBase({ bold: !element.bold })
                              }
                            >
                              <b>B</b> 太字
                            </button>
                            <button
                              aria-pressed={!!element.bullets}
                              onClick={() =>
                                updateTextBase({ bullets: !element.bullets })
                              }
                            >
                              ☷ 箇条書き
                            </button>
                          </div>
                          <div className="text-alignment-controls">
                            <div role="group" aria-label="文字の左右の位置">
                              <span>左右の位置</span>
                              <div className="text-alignment-buttons">
                                {(
                                  [
                                    ["left", "左揃え", AlignLeft],
                                    ["center", "中央揃え", AlignCenter],
                                    ["right", "右揃え", AlignRight],
                                  ] as const
                                ).map(([value, label, Icon]) => (
                                  <button
                                    key={value}
                                    aria-label={`文字を${label}`}
                                    aria-pressed={
                                      (element.textAlign ?? "left") === value
                                    }
                                    title={label}
                                    onClick={() =>
                                      updateTextBase({ textAlign: value })
                                    }
                                  >
                                    <Icon size={17} />
                                    <span>{label}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div role="group" aria-label="文字の上下の位置">
                              <span>上下の位置</span>
                              <div className="text-alignment-buttons">
                                {(
                                  [
                                    [
                                      "top",
                                      "上揃え",
                                      AlignVerticalJustifyStart,
                                    ],
                                    [
                                      "middle",
                                      "上下中央揃え",
                                      AlignVerticalJustifyCenter,
                                    ],
                                    [
                                      "bottom",
                                      "下揃え",
                                      AlignVerticalJustifyEnd,
                                    ],
                                  ] as const
                                ).map(([value, label, Icon]) => (
                                  <button
                                    key={value}
                                    aria-label={`文字を${label}`}
                                    aria-pressed={
                                      (element.verticalAlign ?? "top") === value
                                    }
                                    title={label}
                                    onClick={() =>
                                      updateTextBase({ verticalAlign: value })
                                    }
                                  >
                                    <Icon size={17} />
                                    <span>
                                      {value === "middle" ? "中央揃え" : label}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                          <label>
                            文字の色
                            <input
                              type="color"
                              aria-label="文字の色"
                              value={element.color}
                              onChange={(e) =>
                                updateTextBase({ color: e.target.value })
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
                                updateTextBase({ highlight: e.target.value })
                              }
                            />
                          </label>
                          {element.highlight && (
                            <button
                              className="quiet"
                              onClick={() =>
                                updateTextBase({ highlight: undefined })
                              }
                            >
                              ハイライトを消す
                            </button>
                          )}
                        </details>
                      </>
                    )}
                    {element.type === "table" && (
                      <TableInspector
                        key={element.id}
                        element={element}
                        onWhole={() => setCellRangeMode(false)}
                        selection={cellSelection}
                        cells={
                          <TableCellControls
                            element={element}
                            keys={
                              cellSelection?.id === element.id
                                ? cellSelection.keys
                                : []
                            }
                            rangeMode={cellRangeMode}
                            message={tableMessage}
                            onRangeMode={() => {
                              setCellRangeMode(!cellRangeMode);
                              setTableMessage("");
                            }}
                            onChange={updateElement}
                          />
                        }
                        whole={
                          <TableControls
                            element={element}
                            onChange={updateElement}
                          />
                        }
                      />
                    )}
                    {element.type === "chart" && (
                      <ChartControls
                        element={element}
                        onChange={updateElement}
                      />
                    )}
                    {element.type === "line" && (
                      <ConnectorControls
                        element={element}
                        elements={slide.elements}
                        onChange={updateElement}
                      />
                    )}
                    {element.type === "image" && (
                      <ImageControls
                        key={`image-${element.id}`}
                        element={element}
                        disabled={!editable}
                        onChange={updateElement}
                        onReplace={onReplaceImage}
                      />
                    )}
                    {(element.type === "shape" || element.type === "line") && (
                      <StrokeControls
                        key={`stroke-${element.id}`}
                        element={element}
                        onChange={updateElement}
                      />
                    )}
                  </>
                )
              }
              layout={
                chosen.length > 0 ? (
                  <ObjectLayout
                    elements={chosen}
                    allElements={slide.elements}
                    showActions={false}
                    onArrange={onArrange}
                    onChange={updateElement}
                    onDuplicate={onDuplicate}
                    onDelete={onDeleteSelection}
                  />
                ) : null
              }
              links={
                element ? (
                  <ObjectLinkControls
                    key={`link-${element.id}`}
                    element={element}
                    book={linkDeck}
                    onChange={updateElement}
                    onOpen={onOpenLink}
                  />
                ) : null
              }
            />
          </aside>
        )}
      </div>
    </main>
  );
}
