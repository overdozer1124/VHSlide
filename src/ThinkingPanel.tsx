import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useActivityPanel } from "./ActivitiesPanel";
import { useThinking } from "./ThinkingContext";
import { ThinkingBoardArtShapes } from "./ThinkingBoardArt";
import {
  BOARD_ZONE_SPECS,
  CARD_COLORS,
  splitCurveKey,
  templateKind,
  VENN_CIRCLES,
} from "./thinkingTools";
import type {
  ThinkingDefinition,
  ThinkingPoint,
  ThinkingTemplate,
  ThinkingUnit,
  ThinkingView,
  ThinkingZoneSpec,
} from "./thinkingTools";
import { ThinkingResults } from "./ThinkingResults";
import { usePageVisible } from "./usePageVisible";

export const THINKING_TEMPLATE_LABELS: Record<ThinkingTemplate, string> = {
  axis2: "座標軸（2つの軸）",
  axis1: "数直線（1つの軸）",
  emotion: "感情メーター",
  ratio: "心情円（2つの気持ちの割合）",
  curve: "心情曲線（場面ごとの気持ち）",
  venn2: "ベン図（2つの円）",
  venn3: "ベン図（3つの円）",
  ychart: "Yチャート",
  xchart: "Xチャート",
  wchart: "Wチャート",
  tchart: "Tチャート",
  pmi: "PMI",
  matrix: "マトリックス（2×2）",
  kwl: "KWL",
  steps: "ステップチャート（手順を並べる）",
  webbing: "ウェビング（個人・班）",
  fishbone: "フィッシュボーン",
  butterfly2: "バタフライ（羽2枚）",
  butterfly4: "バタフライ（羽4枚）",
  jellyfish: "クラゲチャート",
  pyramid3: "ピラミッド（3段）",
  pyramid4: "ピラミッド（4段）",
  kumade: "くまでチャート",
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
  curve: {
    about:
      "物語の場面ごとに気持ちの上がり下がりを点で置き、線で結んで表すツールです。",
    usage:
      "場面の並びと、登場人物ごとの線（最大3本）を決めます。国語や道徳で、登場人物の気持ちの変化を追うのに向いています。点には一言を添えられます。",
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
    about:
      "中心にテーマを置き、X字に区切った4つの三角形に考えを書く図です。",
    usage:
      "「見た目」「音」「におい」「感じ」のように、テーマを感覚ごとに観察して書き分けるときに使います。区切りの名前は自由に付けられます。",
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
  steps: {
    about:
      "カードを順番に並べて、矢印でつないで表すツールです。",
    usage:
      "実験や調理の手順、物語のあらすじ、作業の流れなどを順番に整理するのに使います。カードは上へ・下へボタンやドラッグで並べ替えられます。",
  },
  webbing: {
    about:
      "中心のテーマから、思いついた言葉を線でつないで広げていく図です。1人（1班）ごとに自分の図を持ちます。",
    usage:
      "考えを広げたり、関連を整理したりするのに使います。学びの記録や回答状況に残り、よい図は「全員に見せる」で共有できます。スライドの「ウェビングマップ」（全員や班で1枚に書く図）とは別の道具です。",
  },
  kwl: {
    about: "知っていること（K）・知りたいこと（W）・分かったこと（L）を書く図です。",
    usage:
      "学習のはじめにKとWを書き、終わりにLを書き足すと、学びの変化が見えます。",
  },
  fishbone: {
    about:
      "魚の骨の形で、結果（頭）に対する原因を骨ごとに書き分ける図です。",
    usage:
      "「なぜそうなったか」を考えるときに使います。右の頭に結果（ツールの名前）を置き、骨の名前を原因の観点（人・もの・やり方・環境など）に変えると整理しやすくなります。",
  },
  butterfly2: {
    about: "蝶の左右の羽に、2つのものを書き比べて表す図です。真ん中の体にテーマ（ツールの名前）が入ります。",
    usage:
      "「むかし／いま」「自分／友だち」のように、2つのものを比べるときに使います。区切りの名前は羽に合わせて変えられます。",
  },
  butterfly4: {
    about:
      "蝶の4枚の羽に、意見の強さを分けて書く図です。真ん中の体にテーマ（ツールの名前）が入ります。",
    usage:
      "「強い賛成・賛成・反対・強い反対」のように、賛否とその強さまで表すときに使います。区切りの名前は変更できます。",
  },
  jellyfish: {
    about:
      "クラゲの傘にテーマ（ツールの名前）を置き、足に考えを書き足していく図です。",
    usage:
      "テーマから思いつくことをたくさん出すときに使います。足の名前を観点の名前に変えると、観点ごとに整理できます。",
  },
  pyramid3: {
    about: "3段のピラミッドに、順位や大切さの順に書く図です。",
    usage:
      "「いちばん大切なものは一番上」のように、優先順位や段階を表すときに使います。段の名前は変更できます。",
  },
  pyramid4: {
    about: "4段のピラミッドに、順位や大切さの順に書く図です。",
    usage:
      "3段では足りないときに使います。上の段ほど狭いので、短い言葉で書くのが向いています。段の名前は変更できます。",
  },
  kumade: {
    about:
      "熊手の歯に、考えをたくさん集める図です。持ち手にテーマ（ツールの名前）が入ります。",
    usage:
      "いろいろな観点からアイデアを集めるときに使います。歯の名前を観点の名前に変えると、観点ごとに集められます。",
  },
};

const PREVIEW_FACES = ["😞", "😕", "😐", "🙂", "😄"];

/** A static miniature of the selected template, drawn from the form's
 * current definition so axis ends and zone names update while the
 * teacher edits them. Every template is drawn in the SAME 400x300
 * viewBox with the same label sizes, so switching templates never
 * changes the scale of the drawing or its text (the picker used to
 * mix a width-scaled SVG, fixed-pixel HTML zones and a fixed-size
 * pie, which made each template look a different size). Decorative:
 * the form fields carry the values. */
function ThinkingTemplatePreview({
  template,
  def,
}: {
  template: ThinkingTemplate;
  def: ThinkingDefinition;
}) {
  // Squeeze an over-long label into `max` viewBox units instead of
  // letting it spill out of the miniature (labels can be 40 chars).
  // Width estimate: full-width characters count 15 units (the label
  // font size), half-width ones about 8.
  const fit = (label: string, max: number) => {
    const width = [...label].reduce(
      (sum, ch) => sum + (ch.charCodeAt(0) > 0xff ? 15 : 8),
      0,
    );
    return width > max
      ? {
          textLength: max,
          lengthAdjust: "spacingAndGlyphs" as const,
        }
      : {};
  };
  const zoneLabel = (z: ThinkingZoneSpec) =>
    def.zones.find((x) => x.id === z.id)?.label ?? z.label;
  let kind: "board" | "ratio" | "point" = "point";
  let body: ReactNode;
  if (template === "webbing") {
    body = (
      <>
        <line x1={200} y1={150} x2={90} y2={70} className="tp-axis" />
        <line x1={200} y1={150} x2={310} y2={80} className="tp-axis" />
        <line x1={200} y1={150} x2={120} y2={235} className="tp-axis" />
        <line x1={200} y1={150} x2={295} y2={225} className="tp-axis" />
        {[
          [90, 70],
          [310, 80],
          [120, 235],
          [295, 225],
        ].map(([x, y], i) => (
          <ellipse key={i} cx={x} cy={y} rx={42} ry={20} className="tp-anchor" />
        ))}
        <ellipse cx={200} cy={150} rx={58} ry={28} className="tp-anchor" />
        <text x={200} y={156} className="tp-zone-label" textAnchor="middle">
          {def.title || "テーマ"}
        </text>
      </>
    );
  } else if (templateKind(template) === "board") {
    kind = "board";
    const spec = BOARD_ZONE_SPECS[template] ?? [];
    const circles = VENN_CIRCLES[template];
    body =
      template === "steps" ? (
        <>
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect
                x={110}
                y={28 + i * 92}
                width={180}
                height={56}
                rx={10}
                className="tp-anchor"
              />
              <text
                x={200}
                y={28 + i * 92 + 36}
                className="tp-zone-label"
                textAnchor="middle"
              >
                {i + 1}
              </text>
              {i < 2 && (
                <text
                  x={200}
                  y={28 + i * 92 + 80}
                  className="tp-zone-label"
                  textAnchor="middle"
                >
                  ↓
                </text>
              )}
            </g>
          ))}
        </>
      ) : template === "xchart" ? (
        <>
          <line x1="0" y1="0" x2="400" y2="300" className="tp-x-line" />
          <line x1="400" y1="0" x2="0" y2="300" className="tp-x-line" />
          <ellipse cx="200" cy="150" rx="56" ry="42" className="tp-x-circle" />
          <text
            x="200"
            y="150"
            className="tp-topic"
            textAnchor="middle"
            dominantBaseline="central"
            {...fit(def.title.trim() || "テーマ", 100)}
          >
            {def.title.trim() || "テーマ"}
          </text>
          {spec.map((z) => (
            <text
              key={z.id}
              x={z.anchor[0] * 400}
              y={z.anchor[1] * 300}
              className="tp-zone-label"
              textAnchor="middle"
              dominantBaseline="central"
              {...fit(zoneLabel(z), 110)}
            >
              {zoneLabel(z)}
            </text>
          ))}
        </>
      ) : (
      <>
        <g transform="scale(4 3)" className="tp-art">
          <ThinkingBoardArtShapes template={template} />
        </g>
        {circles?.map((c, i) => (
          <ellipse
            key={i}
            cx={c.x * 400}
            cy={c.y * 300}
            rx={c.r * 400}
            ry={c.r * 300}
            className="tp-venn"
          />
        ))}
        {spec.map((z) => {
          const label = zoneLabel(z);
          if (z.rect) {
            const x = z.rect[0] * 400;
            const y = z.rect[1] * 300;
            const w = z.rect[2] * 400;
            const h = z.rect[3] * 300;
            return (
              <g key={z.id}>
                <rect x={x} y={y} width={w} height={h} className="tp-zone" />
                <text
                  x={x + w / 2}
                  y={y + 23}
                  className="tp-zone-label"
                  textAnchor="middle"
                  {...fit(label, w - 10)}
                >
                  {label}
                </text>
              </g>
            );
          }
          const w = 136;
          const cx = Math.min(
            Math.max(z.anchor[0] * 400, w / 2 + 2),
            400 - w / 2 - 2,
          );
          const cy = z.anchor[1] * 300;
          return (
            <g key={z.id}>
              <rect
                x={cx - w / 2}
                y={cy - 14}
                width={w}
                height={28}
                rx={8}
                className="tp-anchor"
              />
              <text
                x={cx}
                y={cy + 5}
                className="tp-zone-label"
                textAnchor="middle"
                {...fit(label, w - 10)}
              >
                {label}
              </text>
            </g>
          );
        })}
      </>
      );
  } else if (template === "ratio") {
    kind = "ratio";
    const polar = (deg: number) => {
      const rad = (deg * Math.PI) / 180;
      return [138 + 102 * Math.cos(rad), 150 + 102 * Math.sin(rad)];
    };
    const [sx, sy] = polar(-90);
    const [ex, ey] = polar(126);
    body = (
      <>
        <path
          d={`M138 150 L${sx} ${sy} A102 102 0 1 1 ${ex} ${ey} Z`}
          fill="#e2703a"
        />
        <path
          d={`M138 150 L${ex} ${ey} A102 102 0 0 1 ${sx} ${sy} Z`}
          fill="#3a7bd5"
        />
        <circle cx="138" cy="150" r="27" fill="#fff" />
        <text x="138" y="156" className="tp-pie-label" textAnchor="middle">
          60%
        </text>
        <rect x="262" y="116" width="15" height="15" fill="#e2703a" />
        <text
          x="285"
          y="129"
          className="tp-label"
          {...fit(`${def.nameA}：60%`, 112)}
        >
          {def.nameA}：60%
        </text>
        <rect x="262" y="146" width="15" height="15" fill="#3a7bd5" />
        <text
          x="285"
          y="159"
          className="tp-label"
          {...fit(`${def.nameB}：40%`, 112)}
        >
          {def.nameB}：40%
        </text>
      </>
    );
  } else if (template === "curve") {
    const scenes = Math.max(def.scenes.length, 1);
    const sample = [0.35, 0.62, 0.28, 0.78, 0.55, 0.9, 0.45, 0.7, 0.6, 0.82];
    const px = (i: number) => 64 + (306 * (i + 0.5)) / scenes;
    const py = (v: number) => 242 - v * 212;
    const points = Array.from({ length: scenes }, (_, i) => ({
      x: px(i),
      y: py(sample[i % sample.length]),
    }));
    body = (
      <>
        <line x1="64" y1="30" x2="64" y2="242" className="tp-axis" />
        <line x1="64" y1="242" x2="370" y2="242" className="tp-axis" />
        {points.map((p, i) => (
          <line
            key={i}
            x1={p.x}
            y1="30"
            x2={p.x}
            y2="242"
            className="tp-grid"
          />
        ))}
        <polyline
          points={points.map((p) => `${p.x},${p.y}`).join(" ")}
          className="tp-curve"
        />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="7" className="tp-dot" />
        ))}
        <text
          x="64"
          y="20"
          className="tp-label"
          textAnchor="middle"
          {...fit(def.yMax, 120)}
        >
          {def.yMax}
        </text>
        <text
          x="56"
          y="267"
          className="tp-label"
          textAnchor="end"
          {...fit(def.yMin, 52)}
        >
          {def.yMin}
        </text>
        <text x="72" y="267" className="tp-label">
          場面の進み →
        </text>
      </>
    );
  } else if (template === "axis2") {
    body = (
      <>
        <line x1="64" y1="30" x2="64" y2="242" className="tp-axis" />
        <line x1="64" y1="242" x2="370" y2="242" className="tp-axis" />
        <text
          x="64"
          y="20"
          className="tp-label"
          textAnchor="middle"
          {...fit(def.yMax, 120)}
        >
          {def.yMax}
        </text>
        <text
          x="56"
          y="267"
          className="tp-label"
          textAnchor="end"
          {...fit(def.yMin, 52)}
        >
          {def.yMin}
        </text>
        <text x="72" y="267" className="tp-label" {...fit(def.xMin, 130)}>
          {def.xMin}
        </text>
        <text
          x="370"
          y="267"
          className="tp-label"
          textAnchor="end"
          {...fit(def.xMax, 150)}
        >
          {def.xMax}
        </text>
        <circle cx="238" cy="108" r="10" className="tp-dot" />
      </>
    );
  } else if (!def.vertical) {
    const faces = template === "emotion" ? PREVIEW_FACES : null;
    body = (
      <>
        {faces?.map((f, i) => (
          <text
            key={f}
            x={64 + i * 68}
            y={104}
            className="tp-face"
            textAnchor="middle"
          >
            {f}
          </text>
        ))}
        <line x1="28" y1="150" x2="372" y2="150" className="tp-axis" />
        <text x="28" y="188" className="tp-label" {...fit(def.xMin, 150)}>
          {def.xMin}
        </text>
        <text
          x="372"
          y="188"
          className="tp-label"
          textAnchor="end"
          {...fit(def.xMax, 150)}
        >
          {def.xMax}
        </text>
        <circle cx="238" cy="150" r="10" className="tp-dot" />
      </>
    );
  } else {
    const faces = template === "emotion" ? PREVIEW_FACES : null;
    body = (
      <>
        <line x1="196" y1="36" x2="196" y2="252" className="tp-axis" />
        <text
          x="196"
          y="22"
          className="tp-label"
          textAnchor="middle"
          {...fit(def.xMax, 170)}
        >
          {def.xMax}
        </text>
        <text
          x="196"
          y="282"
          className="tp-label"
          textAnchor="middle"
          {...fit(def.xMin, 170)}
        >
          {def.xMin}
        </text>
        {faces ? (
          faces.map((f, i) => (
            <text key={f} x="224" y={248 - i * 50} className="tp-face">
              {f}
            </text>
          ))
        ) : (
          <circle cx="196" cy="96" r="10" className="tp-dot" />
        )}
        {faces && <circle cx="196" cy="96" r="10" className="tp-dot" />}
      </>
    );
  }
  return (
    <div className={`thinking-preview is-${kind}`} aria-hidden="true">
      <svg viewBox="0 0 400 300" role="presentation">
        {body}
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
    lines: [],
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
  if (template === "curve")
    return {
      ...base,
      yMin: "気持ちが下がる",
      yMax: "気持ちが上がる",
      sceneMode: "free",
      scenes: [1, 2, 3, 4].map((n) => ({
        id: crypto.randomUUID(),
        label: `場面${n}`,
      })),
      lines: [{ id: crypto.randomUUID(), label: "主人公" }],
    };
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
  const [justCreatedId, setJustCreatedId] = useState("");
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

  const justCreated = justCreatedId
    ? ctx.tools.find((t) => t.id === justCreatedId && t.status === "draft")
    : undefined;
  return (
    <div className="thinking-panel">
      <p className="webbing-panel-note">
        考えを「点」や「カード」で表す思考ツールです。軸や気持ちの上に点を置くものと、区切りにカードを書くものがあります。個人・班・全体のどれでも使えます。
      </p>
      {host && (
        <p className="thinking-steps-note">
          手順：1 作る → 2 受付を開始 → 3 スライドに配置（受付を開始しないと配置できません）
        </p>
      )}
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
              const res = await ctx.command(undefined, undefined, {
                template,
                unit,
                definition,
              });
              if (res.createdId && alive.current)
                setJustCreatedId(res.createdId);
            }, "思考ツールを作成しました。受付を開始すると配置できます。");
          }}
        />
      )}
      {host && justCreated && (
        <div className="thinking-created-box">
          <p>
            「{justCreated.definition.title}
            」を作成しました。続けて受付を始めて、スライドに置けます。
          </p>
          <div className="thinking-created-actions">
            <button
              type="button"
              className="button primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await ctx.command(justCreated.id, "status", {
                    status: "open",
                  });
                  if (onEmbed) {
                    onEmbed({ ...justCreated, status: "open" });
                    activity.close();
                  }
                  setJustCreatedId("");
                }, "受付を開始して、スライドに配置しました。")
              }
            >
              受付を開始して配置する
            </button>
            <button
              type="button"
              className="button outline"
              disabled={busy}
              onClick={() => setJustCreatedId("")}
            >
              あとで配置する
            </button>
          </div>
        </div>
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
                  : tool.kind === "flow"
                    ? ` · ノード${tool.nodes.length}個`
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
                hasPoints={
                  tool.points.length > 0 ||
                  tool.cards.length > 0 ||
                  tool.nodes.length > 0
                }
                points={tool.points}
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
  points,
  onSubmit,
}: {
  busy: boolean;
  initial?: {
    template: ThinkingTemplate;
    unit: ThinkingUnit;
    definition: ThinkingDefinition;
  };
  hasPoints?: boolean;
  /** The tool's current points (edit form only): removing a scene
   * or a curve line that still has points asks first (the points
   * stop showing but are not deleted). */
  points?: ThinkingPoint[];
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
    // Webbing has no class unit (the whole-class webbing is the
    // slide's webbing map); never leave the form on it.
    if (t === "webbing" && unit === "class") setUnit("individual");
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
      <div className="thinking-create-layout">
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
        <div className="thinking-params">
          <div className="thinking-params-fields">
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
          {templateKind(template) === "flow" ? (
            <>
              <option value="individual">個人（1人1つの図）</option>
              <option value="group">班（班で1つの図）</option>
            </>
          ) : templateKind(template) === "board" ? (
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
          {template !== "steps" && (
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
          )}
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
      {(template === "axis2" || template === "curve") && (
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
      {template !== "ratio" &&
        template !== "curve" &&
        templateKind(template) === "point" && (
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
        <legend>
          {template === "curve"
            ? "場面（物語の進み方）"
            : "場面（考えの変化を残す場合）"}
        </legend>
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
              onClick={() => {
                const used = (points ?? []).some(
                  (p) => p.scene === s.id || p.scene.startsWith(`${s.id}:`),
                );
                if (
                  used &&
                  !window.confirm(
                    "この場面には生徒の点があります。場面を消すと、その点は表示されなくなります（データは残り、場面を戻すとまた出ます）。消しますか？",
                  )
                )
                  return;
                patch({ scenes: def.scenes.filter((x) => x.id !== s.id) });
              }}
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
        {def.scenes.length > 0 && template !== "curve" && (
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
      {template === "curve" && (
        <fieldset className="thinking-form-scenes">
          <legend>線（登場人物）</legend>
          {def.lines.map((l, i) => (
            <div key={l.id} className="thinking-form-scene">
              <input
                value={l.label}
                maxLength={40}
                aria-label={`線${i + 1}の名前`}
                onChange={(e) =>
                  patch({
                    lines: def.lines.map((x) =>
                      x.id === l.id ? { ...x, label: e.target.value } : x,
                    ),
                  })
                }
              />
              <button
                type="button"
                disabled={def.lines.length <= 1}
                onClick={() => {
                  const used = (points ?? []).some(
                    (p) => splitCurveKey(p.scene)?.lineId === l.id,
                  );
                  if (
                    used &&
                    !window.confirm(
                      "この線には生徒の点があります。線を消すと、その点は表示されなくなります（データは残り、線を戻すとまた出ます）。消しますか？",
                    )
                  )
                    return;
                  patch({ lines: def.lines.filter((x) => x.id !== l.id) });
                }}
              >
                削除
              </button>
            </div>
          ))}
          {def.lines.length < 3 && (
            <button
              type="button"
              onClick={() =>
                patch({
                  lines: [
                    ...def.lines,
                    {
                      id: crypto.randomUUID(),
                      label: `登場人物${def.lines.length + 1}`,
                    },
                  ],
                })
              }
            >
              線を追加
            </button>
          )}
        </fieldset>
      )}
      {templateKind(template) === "point" && template !== "curve" && (
      <label className="thinking-check">
        <input
          type="checkbox"
          checked={def.reason}
          onChange={(e) => patch({ reason: e.target.checked })}
        />
        点と一緒に「理由」を書けるようにする
      </label>
      )}
          </div>
      <button type="submit" disabled={busy || !def.title.trim()}>
        {editing ? "設定を保存" : "思考ツールを作成"}
      </button>
        </div>
      </div>
    </form>
  );
}
