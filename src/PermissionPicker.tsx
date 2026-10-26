import { axisGrant, axisIndex } from "./axes";
import { useState } from "react";
import type { Deck } from "./model";
import { sheetList } from "./workbook";
import { canEdit } from "./permissions";
import type { EditAccess } from "./permissions";
export function PermissionPicker({
  deck,
  value,
  onChange,
}: {
  deck: Deck;
  value: EditAccess;
  onChange: (next: EditAccess) => void;
}) {
  const [sheet, setSheet] = useState(sheetList(deck)[0].id);
  const pages = deck.slides.filter((s) => (s.sheetId ?? "main") === sheet);
  const rows = [...new Set(pages.map((s) => s.y))].sort((a, b) => a - b),
    cols = [...new Set(pages.map((s) => s.x))].sort((a, b) => a - b);
  function axis(key: "rows" | "columns", index: number) {
    const picked = value[key].some(
      (r) => r.sheetId === sheet && axisIndex(deck, key, r) === index,
    );
    onChange({
      ...value,
      [key]: picked
        ? value[key].filter(
            (r) => r.sheetId !== sheet || axisIndex(deck, key, r) !== index,
          )
        : [...value[key], axisGrant(deck, sheet, key, index)],
    });
  }
  return (
    <div className="permission-picker">
      <label>
        編集の権限
        <select
          aria-label="編集の権限"
          value={value.mode}
          onChange={(e) =>
            onChange({ ...value, mode: e.target.value as EditAccess["mode"] })
          }
        >
          <option value="none">閲覧のみ</option>
          <option value="scoped">指定した範囲だけ編集</option>
          <option value="all">すべてのスライドを編集</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={value.comment}
          onChange={(e) => onChange({ ...value, comment: e.target.checked })}
        />
        付箋コメントを許可
      </label>
      {value.mode === "scoped" && (
        <>
          <label>
            シート
            <select
              aria-label="権限を設定するシート"
              value={sheet}
              onChange={(e) => setSheet(e.target.value)}
            >
              {sheetList(deck).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <small>
            行・列の見出し、またはページ番号を押して選択します。選択した範囲のいずれかに含まれるページを編集できます。行・列の担当は並べ替えても一緒に移動します。個別ページの移動では移動先の範囲権限が適用され、複製した行の担当は別に設定します。
          </small>
          <div className="permission-grid-scroll">
            <div
              className="permission-grid"
              style={{
                gridTemplateColumns: `44px repeat(${cols.length},64px)`,
              }}
            >
              <span />
              {cols.map((x) => (
                <button
                  type="button"
                  key={`c${x}`}
                  aria-label={`編集を許可する列${x + 1}`}
                  aria-pressed={value.columns.some(
                    (c) =>
                      c.sheetId === sheet &&
                      axisIndex(deck, "columns", c) === x,
                  )}
                  onClick={() => axis("columns", x)}
                >
                  {x + 1}列
                </button>
              ))}
              {rows.map((y) => (
                <div className="permission-grid-row" key={y}>
                  <button
                    type="button"
                    aria-label={`編集を許可する行${y + 1}`}
                    aria-pressed={value.rows.some(
                      (r) =>
                        r.sheetId === sheet && axisIndex(deck, "rows", r) === y,
                    )}
                    onClick={() => axis("rows", y)}
                  >
                    {y + 1}行
                  </button>
                  {cols.map((x) => {
                    const slide = pages.find((s) => s.x === x && s.y === y);
                    return slide ? (
                      <button
                        type="button"
                        key={x}
                        aria-label={`編集を許可するスライド${y + 1}.${x + 1} ${slide.title}`}
                        aria-pressed={value.slides.includes(slide.id)}
                        data-allowed={canEdit(value, slide, deck)}
                        title={slide.title}
                        onClick={() =>
                          onChange({
                            ...value,
                            slides: value.slides.includes(slide.id)
                              ? value.slides.filter((id) => id !== slide.id)
                              : [...value.slides, slide.id],
                          })
                        }
                      >
                        {y + 1}.{x + 1}
                      </button>
                    ) : (
                      <span key={x} />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <small>
            すべてのシートで：{value.rows.length}行・{value.columns.length}列・
            {value.slides.length}枚を指定中
          </small>
        </>
      )}
    </div>
  );
}
