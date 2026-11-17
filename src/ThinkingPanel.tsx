import { useEffect, useRef, useState } from "react";
import { useActivityPanel } from "./ActivitiesPanel";
import { useThinking } from "./ThinkingContext";
import {
  BOARD_ZONE_SPECS,
  CARD_COLORS,
  templateKind,
  VENN_CIRCLES,
} from "./thinkingTools";
import type {
  ThinkingDefinition,
  ThinkingTemplate,
  ThinkingUnit,
  ThinkingView,
} from "./thinkingTools";
import { ThinkingResults } from "./ThinkingResults";
import { usePageVisible } from "./usePageVisible";

export const THINKING_TEMPLATE_LABELS: Record<ThinkingTemplate, string> = {
  axis2: "座標軸（2つの軸）",
  axis1: "数直線（1つの軸）",
  emotion: "感情メーター",
  ratio: "心情円（2つの気持ちの割合）",
  venn2: "ベン図（2つの円）",
  venn3: "ベン図（3つの円）",
  ychart: "Yチャート",
  xchart: "Xチャート",
  wchart: "Wチャート",
  tchart: "Tチャート",
  pmi: "PMI",
  matrix: "マトリックス（2×2）",
  kwl: "KWL",
};
export const CARD_COLOR_LABELS: Record<string, string> = {
  yellow: "黄色",
  blue: "青色",
  pink: "ピンク",
  green: "緑色",
};
/** Teacher-facing explanation per template, shown next to the template
 * picker: what the tool is (about) and how a class uses it (usage). */
export const THINKING_TEMPLATE_GUIDES: Record<
  ThinkingTemplate,
  { about: string; usage: string }
> = {
  axis2: {
    about: "2つの軸で作る座標の上に、自分の考えの位置を点で置くツールです。",
    usage:
      "横軸を「反対⇔賛成」、縦軸を「自信がない⇔自信がある」のようにすると、意見と自信の両方を一度に表せます。場面を分ければ、話し合いの前後で考えがどう動いたかも残せます。",
  },
  axis1: {
    about: "1本の線の上に、量や程度を点で表すツールです。",
    usage:
      "「少ない⇔多い」「短い⇔長い」など、1つのものさしで表せるものに使います。「縦に置く」を選ぶと、温度計のように縦の線にもできます。",
  },
  emotion: {
    about: "気持ちの程度を、顔の表情が並んだ線の上に点で表すツールです。",
    usage:
      "物語を読んだ気持ちや、活動のふり返りなどに使います。場面を分ければ、場面ごとの気持ちの変化を追えます。",
  },
  ratio: {
    about: "2つの気持ちの割合を、円の分け方で表すツールです。",
    usage:
      "「言いたい⇔黙っていたい」のように、心の中でゆれる2つの気持ちの割合を表すのに向いています。円をタップするか、スライダーで割合を決めます。",
  },
  venn2: {
    about: "2つの円の重なりで、共通点と違いを整理する図です。",
    usage:
      "2つのもの・考えを比べるときに使います。それぞれだけの部分と、重なる部分（共通点）にカードを書きます。",
  },
  venn3: {
    about: "3つの円の重なりで、共通点と違いを整理する図です。",
    usage:
      "3つのもの・考えを比べるときに使います。2つだけの重なりや、3つ全部の重なりにもカードを置けます。",
  },
  ychart: {
    about: "見たこと・聞いたこと・感じたことを書き分ける図です。",
    usage:
      "観察や見学の記録に向いています。事実（見たこと・聞いたこと）と感想（感じたこと）を分けて書く練習になります。",
  },
  xchart: {
    about: "4つの区切りに分けて考える図です。",
    usage:
      "区切りの名前は自由に付けられます。2つの切り口を組み合わせて、考えを4つに整理したいときに使います。",
  },
  wchart: {
    about:
      "いつ・どこで・だれが・何を・なぜ（どのように）の5つで整理する図です。",
    usage:
      "出来事や調べたことを、5Wの観点で抜けなく書き出すのに使います。区切りの名前は変更できます。",
  },
  tchart: {
    about: "2つの区切りに分けて書き比べる図です。",
    usage:
      "メリットとデメリット、賛成と反対など、物事の2つの面を並べて比べるのに使います。",
  },
  pmi: {
    about:
      "よい点（Plus）・課題（Minus）・面白い点（Interesting）の3つで考える図です。",
    usage:
      "アイデアや作品を評価するときに使います。悪い点探しで終わらず、「面白い点」まで考えるのが特徴です。",
  },
  matrix: {
    about: "縦と横の2つの切り口を組み合わせた、4つの区切り（2×2）で整理する図です。",
    usage:
      "例えば「大切さ」と「急ぎ具合」で分けて優先順位を考える、といった使い方をします。区切りの名前は自由に付けられます。",
  },
  kwl: {
    about: "知っていること（K）・知りたいこと（W）・分かったこと（L）を書く図です。",
    usage:
      "学習のはじめにKとWを書き、終わりにLを書き足すと、学びの変化が見えます。",
  },
};

const PREVIEW_FACES = ["😞", "😕", "😐", "🙂", "😄"];

/** A static miniature of the selected template, drawn from the form's
 * current definition so axis ends and zone names update while the
 * teacher edits them. Decorative: the form fields carry the values. */
function ThinkingTemplatePreview({
  template,
  def,
}: {
  template: ThinkingTemplate;
  def: ThinkingDefinition;
}) {
  if (templateKind(template) === "board") {
    const spec = BOARD_ZONE_SPECS[template] ?? [];
    const circles = VENN_CIRCLES[template];
    return (
      <div className="thinking-preview is-board" aria-hidden="true">
        {circles && (
          <svg
            className="thinking-venn"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            {circles.map((c, i) => (
              <circle
                key={i}
                cx={c.x * 100}
                cy={c.y * 100}
                r={c.r * 100}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
        )}
        {spec.map((z) => {
          const label =
            def.zones.find((x) => x.id === z.id)?.label ?? z.label;
          return z.rect ? (
            <div
              key={z.id}
              className="thinking-preview-zone"
              style={{
                left: `${z.rect[0] * 100}%`,
                top: `${z.rect[1] * 100}%`,
                width: `${z.rect[2] * 100}%`,
                height: `${z.rect[3] * 100}%`,
              }}
            >
              <span>{label}</span>
            </div>
          ) : (
            <div
              key={z.id}
              className="thinking-preview-zone is-anchor"
              style={{
                left: `${z.anchor[0] * 100}%`,
                top: `${z.anchor[1] * 100}%`,
              }}
            >
              <span>{label}</span>
            </div>
          );
        })}
      </div>
    );
  }
  if (template === "ratio") {
    return (
      <div className="thinking-preview is-ratio" aria-hidden="true">
        <div
          className="thinking-preview-pie"
          style={{
            background: "conic-gradient(#e2703a 0% 60%, #3a7bd5 60% 100%)",
          }}
        >
          <span>60%</span>
        </div>
        <div className="thinking-preview-legend">
          <p>
            <span className="thinking-swatch is-a" /> {def.nameA}：60%
          </p>
          <p>
            <span className="thinking-swatch is-b" /> {def.nameB}：40%
          </p>
        </div>
      </div>
    );
  }
  const two = template === "axis2";
  const vertical = !two && def.vertical;
  const faces = template === "emotion" ? PREVIEW_FACES : null;
  return (
    <div className="thinking-preview is-point" aria-hidden="true">
      <svg viewBox="0 0 200 140" role="presentation">
        {two ? (
          <>
            <line x1="36" y1="12" x2="36" y2="112" className="tp-axis" />
            <line x1="36" y1="112" x2="188" y2="112" className="tp-axis" />
            <text x="36" y="9" className="tp-text" textAnchor="middle">
              {def.yMax}
            </text>
            <text x="30" y="126" className="tp-text" textAnchor="end">
              {def.yMin}
            </text>
            <text x="40" y="126" className="tp-text">
              {def.xMin}
            </text>
            <text x="188" y="126" className="tp-text" textAnchor="end">
              {def.xMax}
            </text>
            <circle cx="128" cy="52" r="6" className="tp-dot" />
          </>
        ) : vertical ? (
          <>
            <line x1="100" y1="14" x2="100" y2="116" className="tp-axis" />
            <text x="100" y="10" className="tp-text" textAnchor="middle">
              {def.xMax}
            </text>
            <text x="100" y="130" className="tp-text" textAnchor="middle">
              {def.xMin}
            </text>
            {faces ? (
              faces.map((f, i) => (
                <text
                  key={f}
                  x="116"
                  y={116 - i * 25.5 + 4}
                  className="tp-face"
                >
                  {f}
                </text>
              ))
            ) : (
              <circle cx="100" cy="45" r="6" className="tp-dot" />
            )}
            {faces && <circle cx="100" cy="45" r="6" className="tp-dot" />}
          </>
        ) : (
          <>
            <line x1="14" y1="66" x2="186" y2="66" className="tp-axis" />
            <text x="14" y="92" className="tp-text">
              {def.xMin}
            </text>
            <text x="186" y="92" className="tp-text" textAnchor="end">
              {def.xMax}
            </text>
            {faces ? (
              faces.map((f, i) => (
                <text
                  key={f}
                  x={14 + i * 43}
                  y={52}
                  className="tp-face"
                  textAnchor="middle"
                >
                  {f}
                </text>
              ))
            ) : null}
            <circle cx="128" cy="66" r="6" className="tp-dot" />
          </>
        )}
      </svg>
    </div>
  );
}
export const THINKING_UNIT_LABELS: Record<ThinkingUnit, string> = {
  individual: "個人",
  group: "班",
  class: "全体",
};

function defaultDefinition(template: ThinkingTemplate): ThinkingDefinition {
  const base: ThinkingDefinition = {
    title: "",
    xMin: "",
    xMax: "",
    yMin: "",
    yMax: "",
    scale: "none",
    vertical: false,
    nameA: "",
    nameB: "",
    zones: [],
    cardColors: [],
    scenes: [],
    sceneMode: "teacher",
    reason: true,
  };
  const spec = BOARD_ZONE_SPECS[template];
  if (spec)
    return {
      ...base,
      reason: false,
      zones: spec.map((z) => ({ id: z.id, label: z.label })),
      cardColors: [
        { color: "yellow", label: "自分の考え" },
        { color: "blue", label: "友だちの考え" },
      ],
    };
  if (template === "axis2")
    return {
      ...base,
      xMin: "反対",
      xMax: "賛成",
      yMin: "自信がない",
      yMax: "自信がある",
    };
  if (template === "axis1") return { ...base, xMin: "少ない", xMax: "多い" };
  if (template === "emotion")
    return { ...base, xMin: "いやな気持ち", xMax: "よい気持ち" };
  return { ...base, nameA: "言いたい", nameB: "黙っていたい" };
}

export function ThinkingPanel({
  host,
  onEmbed,
}: {
  host: boolean;
  onEmbed?: (tool: ThinkingView) => void;
}) {
  const ctx = useThinking();
  const activity = useActivityPanel();
  const open = activity.open && activity.active === "thinking";
  const visible = usePageVisible();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteId, setDeleteId] = useState("");
  const [editId, setEditId] = useState("");
  const [resultsId, setResultsId] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!open || !ctx.enabled || !visible) return;
    void ctx.refresh().catch((e: Error) => {
      if (alive.current) setError(e.message);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ctx.enabled, visible]);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      if (alive.current) setMessage(done);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return (
    <div className="thinking-panel">
      <p className="webbing-panel-note">
        考えを「点」や「カード」で表す思考ツールです。軸や気持ちの上に点を置くものと、区切りにカードを書くものがあります。個人・班・全体のどれでも使えます。
      </p>
      {ctx.error && (
        <p role="alert" className="webbing-panel-error">
          {ctx.error}
        </p>
      )}
      {error && (
        <p role="alert" className="webbing-panel-error">
          {error}
        </p>
      )}
      {message && <p className="webbing-panel-message">{message}</p>}
      <div className="thinking-webbing-link">
        <span>
          全員で1枚に書き込む「ウェビングマップ」も思考ツールの1つです。
        </span>
        <button type="button" onClick={() => activity.select("webbing")}>
          ウェブマップを開く
        </button>
      </div>
      {host && (
        <ThinkingToolForm
          busy={busy}
          onSubmit={async (template, unit, definition) => {
            await run(async () => {
              await ctx.command(undefined, undefined, {
                template,
                unit,
                definition,
              });
            }, "思考ツールを作成しました。受付を開始すると配置できます。");
          }}
        />
      )}
      <div className="thinking-tool-list">
        {ctx.tools.length === 0 && (
          <p className="webbing-panel-note">
            まだ思考ツールがありません。
            {host ? "上のフォームから作成してください。" : ""}
          </p>
        )}
        {ctx.tools.map((tool) => (
          <article key={tool.id} className="thinking-tool-card">
            <header>
              <strong>{tool.definition.title}</strong>
              <span className="thinking-tool-meta">
                {THINKING_TEMPLATE_LABELS[tool.template]} ·{" "}
                {THINKING_UNIT_LABELS[tool.unit]} ·{" "}
                {tool.status === "open"
                  ? "受付中"
                  : tool.status === "closed"
                    ? "受付終了"
                    : "下書き"}
                {tool.kind === "board"
                  ? ` · カード${tool.cards.length}枚`
                  : ` · ${new Set(tool.points.map((p) => p.owner)).size}件`}
              </span>
            </header>
            {host && (
              <div className="thinking-tool-actions">
                {tool.status !== "open" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => ctx.command(tool.id, "status", { status: "open" }),
                        "受付を開始しました。",
                      )
                    }
                  >
                    受付を開始
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          ctx.command(tool.id, "status", { status: "closed" }),
                        "受付を終了しました。",
                      )
                    }
                  >
                    受付を終了
                  </button>
                )}
                {onEmbed && tool.status !== "draft" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      onEmbed(tool);
                      activity.close();
                    }}
                  >
                    スライドに配置
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setResultsId(resultsId === tool.id ? "" : tool.id)}
                >
                  結果を見る
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setEditId(editId === tool.id ? "" : tool.id)}
                >
                  設定を編集
                </button>
                {deleteId === tool.id ? (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await ctx.command(tool.id, undefined, {}, "DELETE");
                          setDeleteId("");
                        }, "思考ツールを削除しました。")
                      }
                    >
                      本当に削除する
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setDeleteId("")}
                    >
                      やめる
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setDeleteId(tool.id)}
                  >
                    削除
                  </button>
                )}
              </div>
            )}
            {host &&
              tool.definition.sceneMode === "teacher" &&
              tool.definition.scenes.length > 0 && (
                <div className="thinking-scene-switch">
                  <label>
                    今の場面
                    <select
                      aria-label="今の場面"
                      value={tool.scene}
                      disabled={busy}
                      onChange={(e) =>
                        void run(
                          () =>
                            ctx.command(tool.id, "scene", {
                              scene: e.target.value,
                            }),
                          "場面を切り替えました。",
                        )
                      }
                    >
                      {tool.definition.scenes.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            {host && editId === tool.id && (
              <ThinkingToolForm
                busy={busy}
                initial={{
                  template: tool.template,
                  unit: tool.unit,
                  definition: tool.definition,
                }}
                hasPoints={tool.points.length > 0 || tool.cards.length > 0}
                onSubmit={async (_template, unit, definition) => {
                  await run(async () => {
                    await ctx.command(tool.id, "edit", { unit, definition });
                    setEditId("");
                  }, "設定を保存しました。");
                }}
              />
            )}
            {host && resultsId === tool.id && <ThinkingResults tool={tool} />}
          </article>
        ))}
      </div>
    </div>
  );
}

function ThinkingToolForm({
  busy,
  initial,
  hasPoints,
  onSubmit,
}: {
  busy: boolean;
  initial?: {
    template: ThinkingTemplate;
    unit: ThinkingUnit;
    definition: ThinkingDefinition;
  };
  hasPoints?: boolean;
  onSubmit: (
    template: ThinkingTemplate,
    unit: ThinkingUnit,
    definition: ThinkingDefinition,
  ) => Promise<void>;
}) {
  const [template, setTemplate] = useState<ThinkingTemplate>(
    initial?.template ?? "axis2",
  );
  const [unit, setUnit] = useState<ThinkingUnit>(initial?.unit ?? "individual");
  const [def, setDef] = useState<ThinkingDefinition>(
    initial?.definition ?? defaultDefinition("axis2"),
  );
  const editing = !!initial;
  function patch(p: Partial<ThinkingDefinition>) {
    setDef((d) => ({ ...d, ...p }));
  }
  function pickTemplate(t: ThinkingTemplate) {
    setTemplate(t);
    if (!editing) setDef(defaultDefinition(t));
  }
  return (
    <form
      className="thinking-create"
      onSubmit={(e) => {
        e.preventDefault();
        if (!def.title.trim()) return;
        void onSubmit(template, unit, def);
        if (!editing) setDef(defaultDefinition(template));
      }}
    >
      <div className="thinking-template-layout">
        <fieldset className="thinking-templates">
          <legend>{editing ? "種類（変更できません）" : "ひな形を選ぶ"}</legend>
          {(Object.keys(THINKING_TEMPLATE_LABELS) as ThinkingTemplate[]).map(
            (t) => (
              <label key={t} className={template === t ? "is-active" : ""}>
                <input
                  type="radio"
                  name="thinking-template"
                  value={t}
                  checked={template === t}
                  disabled={editing}
                  onChange={() => pickTemplate(t)}
                />
                {THINKING_TEMPLATE_LABELS[t]}
              </label>
            ),
          )}
        </fieldset>
        <div className="thinking-template-side">
          <figure className="thinking-template-figure">
            <ThinkingTemplatePreview template={template} def={def} />
            <figcaption>{THINKING_TEMPLATE_LABELS[template]}の形</figcaption>
          </figure>
          <div className="thinking-template-guide">
            <p>{THINKING_TEMPLATE_GUIDES[template].about}</p>
            <p>{THINKING_TEMPLATE_GUIDES[template].usage}</p>
          </div>
        </div>
      </div>
      <label>
        ツールの名前
        <input
          value={def.title}
          maxLength={60}
          placeholder="例：物語を読んだ気持ち"
          onChange={(e) => patch({ title: e.target.value })}
        />
      </label>
      <label>
        書き込む単位
        <select
          value={unit}
          disabled={hasPoints}
          onChange={(e) => setUnit(e.target.value as ThinkingUnit)}
        >
          {templateKind(template) === "board" ? (
            <>
              <option value="individual">個人（1人1枚のチャート）</option>
              <option value="group">班（班で1枚のチャート）</option>
              <option value="class">全体（全員で1枚のチャート）</option>
            </>
          ) : (
            <>
              <option value="individual">個人（1人1つの点）</option>
              <option value="group">班（班で1つの点）</option>
              <option value="class">全体（一人ひとりが自分の点）</option>
            </>
          )}
        </select>
        {unit === "class" && templateKind(template) === "point" && (
          <span className="thinking-form-note">
            「全体」は、みんなの点の分布を先生の画面で見せる前提の単位です。生徒には自分の点だけが見えます（「個人」との違いは、その前提があるかどうかです）。
          </span>
        )}
        {unit === "class" && templateKind(template) === "board" && (
          <span className="thinking-form-note">
            カード型の「全体」は、全員で1枚のチャートに書き込みます（点の「全体」とは違います）。カードを動かすのは誰でもできますが、内容の変更と削除は、書いた人と先生だけです。
          </span>
        )}
        {hasPoints && (
          <span className="thinking-form-note">
            回答があるため、単位は変更できません。
          </span>
        )}
      </label>
      {templateKind(template) === "board" && (
        <>
          <fieldset className="thinking-form-scenes">
            <legend>区切りの名前</legend>
            {def.zones.map((z) => (
              <div key={z.id} className="thinking-form-scene">
                <input
                  value={z.label}
                  maxLength={40}
                  aria-label={`区切り「${z.id}」の名前`}
                  onChange={(e) =>
                    patch({
                      zones: def.zones.map((x) =>
                        x.id === z.id ? { ...x, label: e.target.value } : x,
                      ),
                    })
                  }
                />
              </div>
            ))}
          </fieldset>
          <fieldset className="thinking-form-scenes">
            <legend>カードの色の意味（任意）</legend>
            {def.cardColors.map((c) => (
              <div key={c.color} className="thinking-form-scene">
                <span
                  className={`thinking-color-dot is-${c.color}`}
                  aria-hidden="true"
                />
                <input
                  value={c.label}
                  maxLength={20}
                  aria-label={`${CARD_COLOR_LABELS[c.color]}の意味`}
                  onChange={(e) =>
                    patch({
                      cardColors: def.cardColors.map((x) =>
                        x.color === c.color
                          ? { ...x, label: e.target.value }
                          : x,
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  onClick={() =>
                    patch({
                      cardColors: def.cardColors.filter(
                        (x) => x.color !== c.color,
                      ),
                    })
                  }
                >
                  削除
                </button>
              </div>
            ))}
            {def.cardColors.length < 4 && (
              <div className="thinking-color-add">
                {CARD_COLORS.filter(
                  (color) => !def.cardColors.some((x) => x.color === color),
                ).map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() =>
                      patch({
                        cardColors: [
                          ...def.cardColors,
                          { color, label: "" },
                        ],
                      })
                    }
                  >
                    {CARD_COLOR_LABELS[color]}を追加
                  </button>
                ))}
              </div>
            )}
          </fieldset>
        </>
      )}
      {(template === "axis2" || template === "axis1" || template === "emotion") && (
        <div className="thinking-form-grid">
          <label>
            {template === "axis2" ? "横軸の左端" : "軸のはじめ"}
            <input
              value={def.xMin}
              maxLength={40}
              onChange={(e) => patch({ xMin: e.target.value })}
            />
          </label>
          <label>
            {template === "axis2" ? "横軸の右端" : "軸のおわり"}
            <input
              value={def.xMax}
              maxLength={40}
              onChange={(e) => patch({ xMax: e.target.value })}
            />
          </label>
        </div>
      )}
      {template === "axis2" && (
        <div className="thinking-form-grid">
          <label>
            縦軸の下端
            <input
              value={def.yMin}
              maxLength={40}
              onChange={(e) => patch({ yMin: e.target.value })}
            />
          </label>
          <label>
            縦軸の上端
            <input
              value={def.yMax}
              maxLength={40}
              onChange={(e) => patch({ yMax: e.target.value })}
            />
          </label>
        </div>
      )}
      {template === "ratio" && (
        <div className="thinking-form-grid">
          <label>
            1つめの気持ち・部分
            <input
              value={def.nameA}
              maxLength={40}
              onChange={(e) => patch({ nameA: e.target.value })}
            />
          </label>
          <label>
            2つめの気持ち・部分
            <input
              value={def.nameB}
              maxLength={40}
              onChange={(e) => patch({ nameB: e.target.value })}
            />
          </label>
        </div>
      )}
      {template !== "ratio" && templateKind(template) === "point" && (
        <div className="thinking-form-grid">
          <label>
            目盛り
            <select
              value={def.scale}
              onChange={(e) =>
                patch({ scale: e.target.value as ThinkingDefinition["scale"] })
              }
            >
              <option value="none">なし</option>
              <option value="s5">5段階</option>
              <option value="s10">10段階</option>
            </select>
          </label>
          {(template === "axis1" || template === "emotion") && (
            <label className="thinking-check">
              <input
                type="checkbox"
                checked={def.vertical}
                onChange={(e) => patch({ vertical: e.target.checked })}
              />
              縦に置く（温度計のように）
            </label>
          )}
        </div>
      )}
      {templateKind(template) === "point" && (
      <fieldset className="thinking-form-scenes">
        <legend>場面（考えの変化を残す場合）</legend>
        {def.scenes.map((s, i) => (
          <div key={s.id} className="thinking-form-scene">
            <input
              value={s.label}
              maxLength={40}
              aria-label={`場面${i + 1}の名前`}
              onChange={(e) =>
                patch({
                  scenes: def.scenes.map((x) =>
                    x.id === s.id ? { ...x, label: e.target.value } : x,
                  ),
                })
              }
            />
            <button
              type="button"
              onClick={() =>
                patch({ scenes: def.scenes.filter((x) => x.id !== s.id) })
              }
            >
              削除
            </button>
          </div>
        ))}
        {def.scenes.length < 10 && (
          <button
            type="button"
            onClick={() =>
              patch({
                scenes: [
                  ...def.scenes,
                  {
                    id: crypto.randomUUID(),
                    label: `場面${def.scenes.length + 1}`,
                  },
                ],
              })
            }
          >
            場面を追加
          </button>
        )}
        {def.scenes.length > 0 && (
          <label>
            場面の進め方
            <select
              value={def.sceneMode}
              onChange={(e) =>
                patch({
                  sceneMode: e.target
                    .value as ThinkingDefinition["sceneMode"],
                })
              }
            >
              <option value="teacher">先生が切り替える</option>
              <option value="free">生徒が自由に選ぶ</option>
            </select>
          </label>
        )}
      </fieldset>
      )}
      {templateKind(template) === "point" && (
      <label className="thinking-check">
        <input
          type="checkbox"
          checked={def.reason}
          onChange={(e) => patch({ reason: e.target.checked })}
        />
        点と一緒に「理由」を書けるようにする
      </label>
      )}
      <button type="submit" disabled={busy || !def.title.trim()}>
        {editing ? "設定を保存" : "思考ツールを作成"}
      </button>
    </form>
  );
}
