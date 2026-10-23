export type Release = {
  version: string;
  date: string;
  title: string;
  changes: string[];
  commit?: string;
  retrospective: boolean;
};
export const releaseHistory: Release[] = [
  {
    version: "0.36.0",
    date: "2026-10-23",
    title: "クラウドの作品と共有管理を見やすく",
    changes: [
      "クラウド画面を中央の大型モーダルに変更し、作品一覧と共有管理をタブで整理。小さな画面では全面表示。",
      "作品をカードで表示し、開くボタン・ハイライト・作品名検索・自分の作品と参加作品の絞り込みを追加。",
      "共有相手の名前・参加状況・編集範囲を一覧表示し、複数選択で権限変更・順番に行を割り当て・共有解除できるように。",
    ],
    retrospective: false,
  },
  {
    version: "0.35.2",
    date: "2026-10-23",
    title: "全体マップのタッチ移動を安定化",
    changes: [
      "長押し中にブラウザ標準のドラッグが割り込み、移動できなくなる問題を修正。",
    ],
    retrospective: false,
  },
  {
    version: "0.35.1",
    date: "2026-10-23",
    title: "更新履歴のボタンをわかりやすく",
    changes: ["更新履歴のアイコンの横に「更新履歴」の文字を表示。"],
    retrospective: false,
  },
  {
    version: "0.35.0",
    date: "2026-10-23",
    title: "UIの文字を読みやすく・編集中の共有者を表示",
    changes: [
      "メニュー・ボタン・一覧などの文字をひと回り大きくして読みやすく改善。",
      "全体マップの行見出しを細くし、縦書きの文字を左右中央・上端揃えに調整。",
      "編集エリアの上部にも、スライドに割り当てられた共有者名を表示。",
    ],
    retrospective: false,
  },
  {
    version: "0.34.0",
    date: "2026-10-23",
    title: "付箋の見た目・サムネイルの表示名・更新履歴",
    changes: [
      "付箋の色とサイズを変更できるようにし、右下のドラッグで自由にサイズを調整可能に。",
      "サムネイルのフッターを直接編集でき、編集範囲に割り当てた共有相手名を自動表示。",
      "バージョン番号付きの更新履歴ページを追加。過去の更新も開発記録から整理。",
    ],
    retrospective: false,
  },
  {
    version: "0.33.0",
    date: "2026-10-23",
    title: "見出しと共有相手の名前を見やすく",
    changes: [
      "マップの行・列の見出しを大きくし、名前の直接編集に対応。",
      "行に割り当てた共有相手名の縦書き表示を追加し、見出し周辺の隙間を改善。",
    ],
    commit: "eb7cac1",
    retrospective: true,
  },
  {
    version: "0.32.0",
    date: "2026-10-23",
    title: "付箋をその場で入力",
    changes: [
      "ツールバーから追加した付箋に直接入力し、自動保存・ドラッグ移動できる操作に改善。",
      "共有アカウント追加の表示名を変更し、リンクのコピー完了メッセージを追加。",
    ],
    commit: "e3966fd",
    retrospective: true,
  },
  {
    version: "0.31.0",
    date: "2026-10-23",
    title: "共有するアカウントをまとめて追加",
    changes: [
      "Googleアカウントを貼り付けて参加前に権限を設定し、貼り付け順に行を割り当てる機能を追加。",
    ],
    commit: "4b5592a",
    retrospective: true,
  },
  {
    version: "0.30.0",
    date: "2026-10-23",
    title: "共有の編集権限と付箋コメント",
    changes: [
      "ホストが相手ごとに行・列・ページ単位の編集範囲を設定できるように。",
      "編集範囲外にも、許可された付箋コメントを残せる機能を追加。",
    ],
    commit: "cef4f18",
    retrospective: true,
  },
  {
    version: "0.29.0",
    date: "2026-10-23",
    title: "シートを表計算ソフトのように操作",
    changes: [
      "ダブルクリックで名前編集、右クリックでメニュー、ドラッグで並べ替えできるシートタブに改善。",
    ],
    commit: "fc9ebe7",
    retrospective: true,
  },
  {
    version: "0.28.0",
    date: "2026-10-23",
    title: "行番号からすぐジャンプ",
    changes: [
      "編集画面の左の一覧を、複数列の行番号一覧に切り替えて目的の行へ移動可能に。",
    ],
    commit: "4fc8f21",
    retrospective: true,
  },
  {
    version: "0.27.0",
    date: "2026-10-23",
    title: "見ながら選べるフィルタ",
    changes: [
      "行・列の見出しや実際のサムネイルを押してフィルタできるよう改善。",
      "編集画面でもフィルタしたページだけを残せる設定を追加。",
    ],
    commit: "e343f0c",
    retrospective: true,
  },
  {
    version: "0.26.0",
    date: "2026-10-22",
    title: "シート・フィルタ・行の一括複製",
    changes: [
      "複数のスライド一覧を切り替えるシート機能を追加。",
      "フィルタしたページを格子状に自動配置し、行の複製数をまとめて指定できるように。",
    ],
    commit: "004f1c8",
    retrospective: true,
  },
  {
    version: "0.25.0",
    date: "2026-10-22",
    title: "文字の位置を調整",
    changes: [
      "テキストボックス内で左右・中央揃え、上・中央・下揃えを設定できるように。",
    ],
    commit: "3916bd9",
    retrospective: true,
  },
  {
    version: "0.24.0",
    date: "2026-10-22",
    title: "ドラッグ後のタップを改善",
    changes: ["タッチで並べ替えた直後も、次のカードをすぐ操作できるよう改善。"],
    commit: "54212eb",
    retrospective: true,
  },
  {
    version: "0.23.0",
    date: "2026-10-22",
    title: "タッチでサムネイルを並べ替え",
    changes: [
      "タッチによるサムネイル移動に対応。重ねると入れ替え、間に置くと挿入できる操作を追加。",
      "挿入先の隣のカードがずれるアニメーションを追加。",
    ],
    commit: "d3af1a3",
    retrospective: true,
  },
  {
    version: "0.22.0",
    date: "2026-10-22",
    title: "サムネイルの幅と自分の操作の取り消し",
    changes: [
      "編集画面のサムネイル幅をドラッグで80〜150％に調整可能に。",
      "共同編集では自分の変更だけを取り消す動作を確認・整備。",
    ],
    commit: "948fb1e",
    retrospective: true,
  },
  {
    version: "0.21.0",
    date: "2026-10-22",
    title: "表示倍率と画面の広さを設定",
    changes: [
      "マップの倍率ステップを自由に設定でき、最大300％まで拡大可能に。",
      "編集画面の左右パネルを折りたためるようにし、発表中の操作表示を自動で隠すよう改善。",
    ],
    commit: "3149401",
    retrospective: true,
  },
  {
    version: "0.20.0",
    date: "2026-10-22",
    title: "ピンチ操作の確定と現在地を改善",
    changes: [
      "標準倍率を100％に変更。開始した拡大・縮小を最後まで完了させる操作に統一。",
      "編集画面から戻ると、編集中のページがマップ中央に近づくよう改善。",
    ],
    commit: "ed83cdc",
    retrospective: true,
  },
  {
    version: "0.19.0",
    date: "2026-10-22",
    title: "大きなマップの描画を軽量化",
    changes: [
      "縮小の段階を整理し、画面付近のサムネイルだけを詳しく描画して負荷を軽減。",
    ],
    commit: "da09200",
    retrospective: true,
  },
  {
    version: "0.18.0",
    date: "2026-10-22",
    title: "ピンチでマップと編集を接続",
    changes: [
      "ピンチ操作で全体マップと編集画面を行き来できるように。",
      "スライド番号だけで見渡せる一覧を追加。",
    ],
    commit: "66d5c0d",
    retrospective: true,
  },
  {
    version: "0.17.0",
    date: "2026-10-22",
    title: "全体マップを広く表示",
    changes: ["マップの表示領域を広げ、サムネイルの拡大・縮小ボタンを追加。"],
    commit: "76c1156",
    retrospective: true,
  },
  {
    version: "0.16.0",
    date: "2026-10-22",
    title: "終端での操作待ちを短縮",
    changes: [
      "次のページがない方向に操作したとき、すぐに戻って次の操作を受け付けるよう改善。",
    ],
    commit: "1258a7a",
    retrospective: true,
  },
  {
    version: "0.15.0",
    date: "2026-10-22",
    title: "タッチパッドの応答を改善",
    changes: [
      "長い慣性スクロールがあっても、ページ移動がもたつきにくいよう改善。",
    ],
    commit: "c1f9474",
    retrospective: true,
  },
  {
    version: "0.14.0",
    date: "2026-10-22",
    title: "指に追従するスライド移動",
    changes: [
      "文字や画像の上からもスワイプでき、指の動きに追従する切り替えに改善。",
      "タッチパッド操作に対応し、編集画面のヘッダーをコンパクト化。",
    ],
    commit: "c61a53a",
    retrospective: true,
  },
  {
    version: "0.13.0",
    date: "2026-10-22",
    title: "スワイプでページ移動",
    changes: ["編集キャンバスをスワイプして上下左右へ移動できる機能を追加。"],
    commit: "f905cf6",
    retrospective: true,
  },
  {
    version: "0.12.0",
    date: "2026-10-22",
    title: "最大1000枚の作品に対応",
    changes: ["作品全体のスライド上限を1000枚に拡張。"],
    commit: "32276e3",
    retrospective: true,
  },
  {
    version: "0.11.0",
    date: "2026-10-22",
    title: "公開サイトでGoogleログインに対応",
    changes: [
      "公開サイトでGoogleアカウントによるサインインを利用できるよう設定。",
    ],
    commit: "95b318c",
    retrospective: true,
  },
  {
    version: "0.10.0",
    date: "2026-10-22",
    title: "横のサムネイル一覧の操作を改善",
    changes: [
      "左の一覧が自動スクロールしても、展開中の横のページを保つよう改善。",
    ],
    commit: "9247865",
    retrospective: true,
  },
  {
    version: "0.9.0",
    date: "2026-10-21",
    title: "Cloudflareでの保存・共同編集に対応",
    changes: ["Cloudflare上で作品と写真を保存し、共同編集できる構成を追加。"],
    commit: "1cc778e",
    retrospective: true,
  },
  {
    version: "0.8.0",
    date: "2026-10-21",
    title: "400枚のサンプルを追加",
    changes: ["横10枚・縦40枚のサンプルを用意し、大きな作品の読み込みに対応。"],
    commit: "a5e7268",
    retrospective: true,
  },
  {
    version: "0.7.0",
    date: "2026-10-21",
    title: "ログインと共同編集の基盤を追加",
    changes: [
      "Googleログインとリアルタイム共同編集、クラウド保存の仕組みを追加。",
    ],
    commit: "6e407a5",
    retrospective: true,
  },
  {
    version: "0.6.0",
    date: "2026-10-21",
    title: "ページ番号を縦・横の順に統一",
    changes: ["3行目・2枚目を「3.2」と表示する番号に変更。"],
    commit: "6e7dd9f",
    retrospective: true,
  },
  {
    version: "0.5.0",
    date: "2026-10-21",
    title: "縦の連動とサムネイルメニュー",
    changes: [
      "縦方向の連動をオン・オフで切り替え可能に。",
      "サムネイルのメニューからページや行の複製・削除に対応。",
    ],
    commit: "d8b2873",
    retrospective: true,
  },
  {
    version: "0.4.0",
    date: "2026-10-21",
    title: "Webでの公開設定を整備",
    changes: ["GitHub Pagesでアプリを公開するための設定を追加。"],
    commit: "352b0bd",
    retrospective: true,
  },
  {
    version: "0.3.0",
    date: "2026-10-21",
    title: "スライド操作と文字入力を改善",
    changes: [
      "サムネイルのドラッグ移動、スライド内への直接文字入力、矢印キーでのページ移動に対応。",
      "行ごとに表示するページを選べるよう改善。",
    ],
    commit: "0aa49f6",
    retrospective: true,
  },
  {
    version: "0.2.0",
    date: "2026-10-21",
    title: "編集画面でも縦横を確認",
    changes: ["サムネイルに触れると横のページが展開する一覧を追加。"],
    commit: "d36c023",
    retrospective: true,
  },
  {
    version: "0.1.0",
    date: "2026-10-21",
    title: "グリッド型スライド作成を公開",
    changes: [
      "縦横のマップからスライドを追加・編集・発表できる基本機能を追加。",
      "画像・文字・図形の編集、JSON保存・読み込み、端末への自動保存に対応。",
    ],
    commit: "55be749",
    retrospective: true,
  },
];
export const APP_VERSION = releaseHistory[0].version;
