import type { Element, Shape } from "./model";
import { shapeCatalog } from "./shapeCatalog";
import { isFormattableText } from "./multiFormatting";
import type { MultiTextPatch } from "./multiFormatting";
import { NumberField } from "./ObjectLayout";
import { TEXT_FONTS, TEXT_FONT_LABELS } from "./richText";
import type { TextFont } from "./richText";

export function MultiFormatting({
  elements,
  onText,
  onShape,
}: {
  elements: Element[];
  onText: (patch: MultiTextPatch) => void;
  onShape: (patch: { shape?: Shape; fill?: string; stroke?: string }) => void;
}) {
  const texts = elements.filter(isFormattableText);
  const shapes = elements.filter(
    (e) => e.type === "shape" && !e.survey && !e.worksheet && !e.responseField,
  );
  const same = <T,>(values: T[]) =>
    values.every((v) => v === values[0]) ? values[0] : undefined;
  const horizontal = same(
    texts.map((e) => e.textAlign ?? (e.type === "shape" ? "center" : "left")),
  );
  const vertical = same(
    texts.map(
      (e) => e.verticalAlign ?? (e.type === "shape" ? "middle" : "top"),
    ),
  );
  const runs = texts.flatMap((e) => {
    const parts = e.richText?.filter((op) => op.insert.replace(/\n/g, ""));
    return parts?.length
      ? parts.map((op) => ({ e, attributes: op.attributes }))
      : [{ e, attributes: undefined }];
  });
  const size = same(
    runs.map(({ e, attributes }) =>
      attributes?.size ? Number.parseInt(attributes.size) : (e.fontSize ?? 24),
    ),
  );
  const color = same(
    runs.map(({ e, attributes }) => attributes?.color ?? e.color ?? "#173d38"),
  );
  const bold = same(
    runs.map(({ e, attributes }) =>
      e.richText ? !!attributes?.bold : !!e.bold,
    ),
  );
  const font = same(
    texts.flatMap(
      (e) =>
        e.richText
          ?.filter((op) => op.insert.replace(/\n/g, ""))
          .map((op) => op.attributes?.font ?? "sans") ?? ["sans"],
    ),
  );
  return (
    <>
      {texts.length > 0 && (
        <section
          className="multi-format-controls"
          aria-label="選択した文字の一括設定"
        >
          <h3>文字の一括設定</h3>
          <p className="inspector-note">
            選択中の文字・文字入り図形 {texts.length}個に適用します。
          </p>
          <div role="group" aria-label="選択した文字の左右の位置">
            <span>左右の位置</span>
            <div className="text-alignment-buttons">
              {(
                [
                  ["left", "左揃え"],
                  ["center", "中央揃え"],
                  ["right", "右揃え"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={horizontal === v}
                  onClick={() => onText({ textAlign: v })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div role="group" aria-label="選択した文字の上下の位置">
            <span>上下の位置</span>
            <div className="text-alignment-buttons">
              {(
                [
                  ["top", "上揃え"],
                  ["middle", "中央揃え"],
                  ["bottom", "下揃え"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={vertical === v}
                  onClick={() => onText({ verticalAlign: v })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <NumberField
            label="文字の大きさ"
            ariaLabel="選択した文字の大きさ"
            min={12}
            max={120}
            value={size ?? null}
            onCommit={(n) => onText({ fontSize: Math.round(n) })}
          />
          <label>
            文字の色{color === undefined && <small>（混在）</small>}
            <input
              aria-label="選択した文字の色"
              type="color"
              value={color ?? "#173d38"}
              onChange={(e) => onText({ color: e.currentTarget.value })}
            />
          </label>
          <label>
            書体
            <select
              aria-label="選択した文字の書体"
              value={font ?? ""}
              onChange={(e) =>
                onText({ font: e.target.value as TextFont })
              }
            >
              <option value="" disabled>
                混在
              </option>
              {TEXT_FONTS.map((font) => (
                <option key={font} value={font}>
                  {TEXT_FONT_LABELS[font]}
                </option>
              ))}
            </select>
          </label>
          <div className="format-buttons">
            <button
              type="button"
              aria-label="選択した文字を太字"
              aria-pressed={bold === true}
              onClick={() => onText({ bold: bold !== true })}
            >
              <b>B</b> 太字
            </button>
            {(
              [
                ["italic", "斜体"],
                ["underline", "下線"],
                ["strike", "取り消し線"],
              ] as const
            ).map(([key, label]) => {
              const active = same(
                runs.map(({ attributes }) => !!attributes?.[key]),
              );
              return (
                <button
                  key={key}
                  type="button"
                  aria-label={`選択した文字を${label}`}
                  aria-pressed={active === true}
                  onClick={() => onText({ [key]: active !== true })}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {texts.some((e) => e.type === "text") && (
            <label>
              文字の方向（文字ボックス）
              <select
                aria-label="選択した文字の方向"
                value={
                  same(
                    texts
                      .filter((e) => e.type === "text")
                      .map((e) => e.writingMode ?? "horizontal-tb"),
                  ) ?? ""
                }
                onChange={(e) =>
                  onText({
                    writingMode: e.target.value as
                      "horizontal-tb" | "vertical-rl",
                  })
                }
              >
                <option value="" disabled>
                  混在
                </option>
                <option value="horizontal-tb">横書き</option>
                <option value="vertical-rl">縦書き</option>
              </select>
            </label>
          )}
        </section>
      )}
      {shapes.length > 0 && (
        <section
          className="multi-format-controls"
          aria-label="選択した図形の一括設定"
        >
          <h3>図形の一括設定</h3>
          <p className="inspector-note">
            選択中の図形 {shapes.length}個に適用します。
          </p>
          <label>
            形
            <select
              aria-label="選択した図形の形"
              value={same(shapes.map((e) => e.shape ?? "rect")) ?? ""}
              onChange={(e) => onShape({ shape: e.target.value as Shape })}
            >
              <option value="" disabled>
                混在
              </option>
              {shapeCatalog.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            塗りつぶしの色
            {same(shapes.map((e) => e.fill)) === undefined && (
              <small>（混在）</small>
            )}
            <input
              type="color"
              aria-label="選択した図形の色"
              value={
                /^#[0-9a-f]{6}$/i.test(same(shapes.map((e) => e.fill)) ?? "")
                  ? same(shapes.map((e) => e.fill))
                  : "#ffffff"
              }
              onChange={(e) => onShape({ fill: e.currentTarget.value })}
            />
          </label>
          <label>
            枠線の色
            <input
              type="color"
              aria-label="選択した図形の枠線の色"
              value={
                /^#[0-9a-f]{6}$/i.test(same(shapes.map((e) => e.stroke)) ?? "")
                  ? same(shapes.map((e) => e.stroke))
                  : "#173d38"
              }
              onChange={(e) => onShape({ stroke: e.currentTarget.value })}
            />
          </label>
        </section>
      )}
    </>
  );
}
