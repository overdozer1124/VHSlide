import { webLink } from "./webLink";
import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { Deck, Element } from "./model";
import { uid } from "./model";
import { chartColors, type ChartKind } from "./chartData";
import {
  createDiagram,
  createChartElement,
  type DiagramKind,
} from "./diagramTemplates";
import {
  anchorPoint,
  withLinePoints,
  endpoint,
  type AnchorSide,
} from "./structureData";
import { NumberField } from "./ObjectLayout";
import { sheetList } from "./workbook";
import { Shapes, BarChart3, Link2, Group, Ungroup } from "lucide-react";
export function StructureInsert({
  disabled,
  onInsert,
}: {
  disabled: boolean;
  onInsert: (elements: Element[]) => void;
}) {
  const [open, setOpen] = useState(false),
    [tab, setTab] = useState<"diagram" | "chart">("diagram"),
    [pos, setPos] = useState({ left: 8, top: 90, width: 348, maxHeight: 480 }),
    button = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = button.current!.getBoundingClientRect();
      const viewport = window.visualViewport;
      const width = Math.min(
        viewport?.width ?? innerWidth,
        document.documentElement.clientWidth,
      );
      const height = Math.min(
        viewport?.height ?? innerHeight,
        document.documentElement.clientHeight,
      );
      const panelWidth = Math.min(348, width - 16);
      setPos({
        left: Math.max(8, Math.min(r.left, width - panelWidth - 8)),
        top: Math.max(
          8,
          Math.min(r.bottom + 8, height - Math.min(480, height - 24)),
        ),
        width: panelWidth,
        maxHeight: height - 24,
      });
    };
    place();
    const close = (e: PointerEvent) => {
      if (
        !panel.current?.contains(e.target as Node) &&
        !button.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key, true);
    window.addEventListener("resize", place);
    const scroll = (event: Event) => {
      if (!panel.current?.contains(event.target as Node)) place();
    };
    window.addEventListener("scroll", scroll, true);
    window.visualViewport?.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", scroll, true);
      window.visualViewport?.removeEventListener("resize", place);
    };
  }, [open]);
  return (
    <>
      <button
        ref={button}
        className="tool-button"
        aria-label="もっと見る（図解・グラフ）"
        title="図解・グラフを追加"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <BarChart3 size={20} />
        もっと見る
      </button>
      {open &&
        !disabled &&
        createPortal(
          <div
            ref={panel}
            role="dialog"
            aria-label="図解・グラフを追加"
            className="object-palette structure-palette"
            style={pos}
          >
            <div className="object-palette-heading">
              <strong>考えを形にする</strong>
              <button
                className="quiet"
                onClick={() => {
                  setOpen(false);
                  button.current?.focus({ preventScroll: true });
                }}
              >
                閉じる
              </button>
            </div>
            <div className="palette-categories">
              <button
                aria-pressed={tab === "diagram"}
                onClick={() => setTab("diagram")}
              >
                図解
              </button>
              <button
                aria-pressed={tab === "chart"}
                onClick={() => setTab("chart")}
              >
                グラフ
              </button>
            </div>
            {tab === "diagram" ? (
              <div className="structure-cards">
                {(
                  [
                    ["compare", "比較", "3つの欄で違いと共通点を整理"],
                    ["process", "手順", "つながる矢印で流れを説明"],
                    ["timeline", "時系列", "時期と出来事を並べる"],
                  ] as const
                ).map(([kind, name, hint]) => (
                  <button
                    key={kind}
                    aria-label={`${name}の図解を追加`}
                    onClick={() => {
                      onInsert(createDiagram(kind as DiagramKind, uid));
                      setOpen(false);
                    }}
                  >
                    <Shapes size={26} />
                    <span>
                      <b>{name}</b>
                      <small>{hint}</small>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="structure-cards">
                {(
                  [
                    ["bar", "棒グラフ", "値の大きさをくらべる"],
                    ["line", "折れ線グラフ", "変化の様子をたどる"],
                    ["pie", "円グラフ", "全体に対する割合を見る"],
                  ] as const
                ).map(([kind, name, hint]) => (
                  <button
                    key={kind}
                    aria-label={`${name}を追加`}
                    onClick={() => {
                      onInsert([createChartElement(kind as ChartKind, uid)]);
                      setOpen(false);
                    }}
                  >
                    <BarChart3 size={26} />
                    <span>
                      <b>{name}</b>
                      <small>{hint}</small>
                    </span>
                  </button>
                ))}
              </div>
            )}
            <p className="palette-hint">
              図解はまとめて動かせます。文字や図形をダブルクリックすると中を編集できます。
            </p>
          </div>,
          document.body,
        )}
    </>
  );
}
export function GroupControls({
  elements,
  onGroup,
  onUngroup,
  onSelectGroup,
}: {
  elements: Element[];
  onGroup: () => void;
  onUngroup: () => void;
  onSelectGroup: () => void;
}) {
  const hasGroup = elements.some((e) => e.groupId),
    whole =
      elements.length > 1 &&
      elements.every((e) => e.groupId && e.groupId === elements[0].groupId);
  if (!hasGroup && elements.length < 2) return null;
  return (
    <section className="group-controls" aria-label="まとめて扱う">
      <div className="object-action-pair">
        {elements.length > 1 && !whole && (
          <button onClick={onGroup}>
            <Group size={16} />
            グループにする
          </button>
        )}
        {hasGroup && (
          <button onClick={onUngroup}>
            <Ungroup size={16} />
            グループを解除
          </button>
        )}
        {hasGroup && !whole && (
          <button onClick={onSelectGroup}>グループ全体を選択</button>
        )}
      </div>
      {hasGroup && (
        <p className="inspector-note">
          中の要素はダブルクリックで編集できます。
        </p>
      )}
    </section>
  );
}
export function ConnectorControls({
  element: e,
  elements,
  onChange,
}: {
  element: Element;
  elements: Element[];
  onChange: (p: Partial<Element>) => void;
}) {
  const targets = elements.filter((t) => t.type !== "line");
  function change(which: "start" | "end", id: string, side: AnchorSide) {
    const target = targets.find((t) => t.id === id),
      ref = target ? { elementId: id, side } : undefined;
    const point = target ? anchorPoint(target, side) : endpoint(e, which);
    onChange({
      ...withLinePoints(
        e,
        which === "start" ? point : endpoint(e, "start"),
        which === "end" ? point : endpoint(e, "end"),
      ),
      [which === "start" ? "startAnchor" : "endAnchor"]: ref,
    });
  }
  return (
    <section className="connector-controls" aria-label="線の接続">
      <h3>図形につなぐ</h3>
      <p className="inspector-note">
        両端の丸を相手の辺に近づけても接続できます。移動・大きさの変更に追従します。
      </p>
      {(["start", "end"] as const).map((which, i) => {
        const a = which === "start" ? e.startAnchor : e.endAnchor;
        return (
          <div className="connector-end" key={which}>
            <label>
              {i ? "終点" : "始点"}の相手
              <select
                aria-label={`${i ? "終点" : "始点"}の接続先`}
                value={
                  targets.some((t) => t.id === a?.elementId) ? a!.elementId : ""
                }
                onChange={(ev) =>
                  change(
                    which,
                    ev.target.value,
                    a?.side ?? (i ? "left" : "right"),
                  )
                }
              >
                <option value="">つながない</option>
                {targets.map((t, n) => (
                  <option key={t.id} value={t.id}>
                    {n + 1} ·{" "}
                    {(
                      t.text ||
                      t.chart?.title ||
                      {
                        shape: "図形",
                        image: "画像",
                        table: "表",
                        text: "文字",
                        chart: "グラフ",
                        line: "線",
                      }[t.type]
                    ).slice(0, 35)}
                  </option>
                ))}
              </select>
            </label>
            {a && (
              <label>
                接続する辺
                <select
                  aria-label={`${i ? "終点" : "始点"}の接続する辺`}
                  value={a.side}
                  onChange={(ev) =>
                    change(which, a.elementId, ev.target.value as AnchorSide)
                  }
                >
                  {(
                    [
                      ["top", "上"],
                      ["right", "右"],
                      ["bottom", "下"],
                      ["left", "左"],
                    ] as const
                  ).map(([k, n]) => (
                    <option key={k} value={k}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        );
      })}
      <button
        className="quiet"
        disabled={!e.startAnchor && !e.endAnchor}
        onClick={() =>
          onChange({ startAnchor: undefined, endAnchor: undefined })
        }
      >
        両端の接続を解除
      </button>
    </section>
  );
}
export function ChartControls({
  element: e,
  onChange,
}: {
  element: Element;
  onChange: (p: Partial<Element>) => void;
}) {
  const c = e.chart!;
  const set = (patch: Partial<typeof c>) =>
    onChange({ chart: { ...c, ...patch } });
  return (
    <section className="chart-controls" aria-label="グラフの設定">
      <h3>グラフのデータ</h3>
      <label>
        タイトル
        <input
          aria-label="グラフのタイトル"
          maxLength={100}
          value={c.title}
          onChange={(ev) => set({ title: ev.target.value })}
        />
      </label>
      <label>
        種類
        <select
          aria-label="グラフの種類"
          value={c.kind}
          onChange={(ev) => set({ kind: ev.target.value as ChartKind })}
        >
          <option value="bar">棒グラフ</option>
          <option value="line">折れ線</option>
          <option value="pie" disabled={c.series.some((p) => p.value < 0)}>
            円グラフ
          </option>
        </select>
      </label>
      <p className="inspector-note">
        項目の名前と値を入力すると、すぐにグラフへ反映します。円グラフには0以上の値を使います。
      </p>
      <div className="chart-data-rows">
        {c.series.map((p, i) => (
          <div className="chart-data-row" key={p.id}>
            <label className="chart-name">
              項目{i + 1}
              <input
                aria-label={`グラフ項目${i + 1}の名前`}
                value={p.label}
                maxLength={60}
                onChange={(ev) =>
                  set({
                    series: c.series.map((t) =>
                      t.id === p.id ? { ...t, label: ev.target.value } : t,
                    ),
                  })
                }
              />
            </label>
            <NumberField
              label="値"
              ariaLabel={`グラフ項目${i + 1}の値`}
              value={p.value}
              min={c.kind === "pie" ? 0 : -1e6}
              max={1e6}
              onCommit={(value) =>
                set({
                  series: c.series.map((t) =>
                    t.id === p.id ? { ...t, value } : t,
                  ),
                })
              }
            />
            <input
              type="color"
              aria-label={`グラフ項目${i + 1}の色`}
              value={p.color}
              onChange={(ev) =>
                set({
                  series: c.series.map((t) =>
                    t.id === p.id ? { ...t, color: ev.target.value } : t,
                  ),
                })
              }
            />
            <button
              className="quiet"
              aria-label={`グラフ項目${i + 1}を削除`}
              disabled={c.series.length <= 1}
              onClick={() =>
                set({ series: c.series.filter((t) => t.id !== p.id) })
              }
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        className="button"
        disabled={c.series.length >= 12}
        onClick={() =>
          set({
            series: [
              ...c.series,
              {
                id: uid(),
                label: `項目${c.series.length + 1}`,
                value: 1,
                color: chartColors[c.series.length % chartColors.length],
              },
            ],
          })
        }
      >
        項目を追加
      </button>
      <label className="object-check">
        <input
          type="checkbox"
          checked={c.showValues}
          onChange={(ev) => set({ showValues: ev.target.checked })}
        />
        値を表示
      </label>
      <label className="object-check">
        <input
          type="checkbox"
          checked={c.showLegend}
          onChange={(ev) => set({ showLegend: ev.target.checked })}
        />
        凡例を表示
      </label>
    </section>
  );
}
export function ObjectLinkControls({
  element: e,
  book,
  onChange,
  onOpen,
}: {
  element: Element;
  book: Deck;
  onChange: (p: Partial<Element>) => void;
  onOpen: (id: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [sheet, setSheet] = useState(book.activeSheetId ?? "main"),
    [query, setQuery] = useState(""),
    root = useRef<HTMLElement>(null);
  const [urlDraft, setUrlDraft] = useState("");
  const [urlError, setUrlError] = useState("");
  const target = book.slides.find((s) => s.id === e.link?.slideId);
  useEffect(() => {
    setOpen(false);
    setUrlDraft(e.link?.url ?? "");
    setUrlError("");
  }, [e.id, e.link?.url]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLInputElement>("input")?.focus();
    const key = (ev: KeyboardEvent) => {
      ev.stopPropagation();
      if (ev.key === "Escape") {
        ev.preventDefault();
        setOpen(false);
      }
      if (ev.key === "Tab") {
        const all = [
            ...root.current!.querySelectorAll<HTMLElement>(
              "input,select,button:not(:disabled)",
            ),
          ],
          i = all.indexOf(document.activeElement as HTMLElement);
        ev.preventDefault();
        all[(i + (ev.shiftKey ? -1 : 1) + all.length) % all.length]?.focus();
      }
    };
    root.current?.addEventListener("keydown", key);
    return () => {
      root.current?.removeEventListener("keydown", key);
      previous?.focus({ preventScroll: true });
    };
  }, [open]);
  const caption = target
    ? `${sheetList(book).find((s) => s.id === (target.sheetId ?? "main"))?.name ?? "シート"} · ${target.y + 1}.${target.x + 1} ${target.title}`
    : e.link
      ? "移動先のページがありません"
      : "移動先を設定していません";
  return (
    <section className="object-link-controls" aria-label="リンク設定">
      <h3>
        <Link2 size={16} />
        リンク
      </h3>
      <p>{e.link?.url || caption}</p>
      <label>
        WebページのURL
        <input
          aria-label="WebページのURL"
          type="url"
          value={urlDraft}
          onChange={(event) => setUrlDraft(event.target.value)}
          placeholder="https://example.com/"
        />
      </label>
      <button
        className="button"
        onClick={() => {
          try {
            onChange({ link: { url: webLink(urlDraft) } });
            setUrlError("");
          } catch {
            setUrlError("http:// または https:// のURLを指定してください。");
          }
        }}
      >
        URLリンクを設定
      </button>
      {urlError && <p role="alert">{urlError}</p>}
      <button className="button" onClick={() => setOpen(true)}>
        移動先を選ぶ
      </button>
      {e.link && (
        <div className="object-action-pair">
          <button
            disabled={!target && !e.link?.url}
            onClick={() =>
              e.link?.url
                ? window.open(e.link.url, "_blank", "noopener,noreferrer")
                : target && onOpen(target.id)
            }
          >
            リンク先を開く
          </button>
          <button
            className="quiet"
            onClick={() => onChange({ link: undefined })}
          >
            リンクを外す
          </button>
        </div>
      )}
      <p className="inspector-note">
        発表中はスライド上のリンクボタンから移動できます。ページを並べ替えてもリンクは変わりません。
      </p>
      {open &&
        createPortal(
          <div
            className="modal-backdrop crop-backdrop"
            onPointerDown={(ev) => {
              if (ev.target === ev.currentTarget) setOpen(false);
            }}
          >
            <section
              ref={root}
              role="dialog"
              aria-modal="true"
              aria-label="リンク先のページを選ぶ"
              className="object-link-dialog"
            >
              <header>
                <h2>リンク先のページを選ぶ</h2>
                <button className="quiet" onClick={() => setOpen(false)}>
                  閉じる
                </button>
              </header>
              <div className="object-link-search">
                <label>
                  シート
                  <select
                    aria-label="リンク先のシート"
                    value={sheet}
                    onChange={(ev) => setSheet(ev.target.value)}
                  >
                    {sheetList(book).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  探す
                  <input
                    aria-label="リンク先を検索"
                    placeholder="ページの名前・番号"
                    value={query}
                    onChange={(ev) => setQuery(ev.target.value)}
                  />
                </label>
              </div>
              <div className="object-link-grid">
                {book.slides
                  .filter(
                    (s) =>
                      (s.sheetId ?? "main") === sheet &&
                      `${s.y + 1}.${s.x + 1} ${s.title}`
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                  )
                  .sort((a, b) => a.y - b.y || a.x - b.x)
                  .map((s) => (
                    <button
                      key={s.id}
                      aria-label={`${s.y + 1}.${s.x + 1} ${s.title}にリンク`}
                      onClick={() => {
                        onChange({ link: { slideId: s.id } });
                        setOpen(false);
                      }}
                    >
                      <b>
                        {s.y + 1}.{s.x + 1}
                      </b>
                      <span>{s.title}</span>
                    </button>
                  ))}
              </div>
            </section>
          </div>,
          document.body,
        )}
    </section>
  );
}
