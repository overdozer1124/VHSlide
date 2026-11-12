import type { WorksheetDefinition, WorksheetField } from "./worksheets";
import { TEXT_PLACEHOLDER_DEFAULT } from "./worksheets";
const field = (
  label: string,
  section = "",
  kind: WorksheetField["kind"] = "text",
  wide = false,
): WorksheetField => ({
  id: crypto.randomUUID(),
  label,
  section,
  kind,
  wide,
  placeholder: kind === "text" ? TEXT_PLACEHOLDER_DEFAULT : "",
  options:
    kind === "single" || kind === "multiple" ? ["選択肢1", "選択肢2"] : [],
});
export const worksheetTemplateNames = {
  reason: "理由と工夫",
  check: "セルフチェック",
  reflection: "ふり返り",
  plan: "改善プラン",
  radar: "数値とレーダーチャート",
  blank: "自由に作成",
};
export function worksheetTemplate(
  kind: keyof typeof worksheetTemplateNames,
): WorksheetDefinition {
  if (kind === "radar")
    return {
      title: "大切にしたいことを比べよう",
      description: "各項目に数値を入力すると、レーダーチャートに反映されます。",
      fields: [
        {
          ...field("項目ごとの評価", "", "radar", true),
          radar: {
            axes: ["項目1", "項目2", "項目3", "項目4", "項目5", "項目6"],
            series: ["場面1", "場面2"],
            min: 1,
            max: 5,
          },
        },
      ],
    };
  if (kind === "reason")
    return {
      title: "朝食を食べない理由に、どんな工夫ができる？",
      description:
        "資料をもとに「原因 → 実行できる工夫」を考えよう。ペアの事情に合わせた工夫を話し合おう。",
      fields: [
        field("選んだ理由", "理由と工夫", "text", true),
        field("考えた工夫", "理由と工夫", "text", true),
        field("他の人の意見から見つけたこと", "話し合い", "text", true),
      ],
    };
  if (kind === "check")
    return {
      title: "食生活セルフチェック",
      description: "自分にあてはまる項目にチェックを入れよう。",
      fields: [
        "朝食をほぼ毎日食べている",
        "1日3食を決まった時間に食べている",
        "スポーツなどで積極的に体を動かしている",
        "間食や夜食をとりすぎないようにしている",
        "いろいろな食品を組み合わせて食べている",
        "調味料のかけすぎや塩辛い物の食べすぎに注意",
        "脂肪が多い物の食べすぎに注意している",
        "食事作りや後かたづけに参加している",
        "食品を衛生的に取り扱うよう気をつけている",
        "人といっしょに楽しく食事をしている",
      ].map((s) => field(s, "セルフチェック", "checkbox")),
    };
  if (kind === "reflection")
    return {
      title: "食生活をふり返ろう",
      description:
        "気づいたことを整理しよう。キーワード：朝食／バランス／運動／休養／共食",
      fields: [
        ...[1, 2, 3].map((i) =>
          field(`できていること ${i}`, "今の自分の食生活で、できていること"),
        ),
        ...[1, 2, 3].map((i) =>
          field(
            `課題だと思うこと ${i}`,
            "今の自分の食生活で、課題だと思うこと",
          ),
        ),
        ...[1, 2, 3, 4].map((i) =>
          field(`今日学んでわかったこと ${i}`, "今日の学び", "text", true),
        ),
      ],
    };
  if (kind === "plan")
    return {
      title: "私の食生活改善プラン",
      description:
        "具体的に続けられる「小さな一歩」を決めよう。自分の生活や体調に合った、無理のない目標を考えよう。",
      fields: [
        field("今の自分の課題"),
        field("目標（できること）"),
        field("何をする？", "今日から実践すること"),
        field("いつする？", "今日から実践すること"),
        field("続ける工夫は？", "今日から実践すること", "text", true),
        field("家の人に協力してほしいこと"),
        field("1週間後に、何が変わったら成功だと思う？"),
      ],
    };
  return {
    title: "ワークシート",
    description: "",
    fields: [field("自分の考え", "", "text", true)],
  };
}
