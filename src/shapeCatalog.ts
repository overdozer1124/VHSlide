export const shapeCatalog = [
  { id: "rect", name: "四角", category: "基本", path: "M2 2H98V98H2Z" },
  {
    id: "rounded",
    name: "角丸四角",
    category: "基本",
    path: "M16 2H84Q98 2 98 16V84Q98 98 84 98H16Q2 98 2 84V16Q2 2 16 2Z",
  },
  {
    id: "circle",
    name: "丸",
    category: "基本",
    path: "M50 2A48 48 0 1 1 49.99 2Z",
  },
  { id: "triangle", name: "三角", category: "基本", path: "M50 2L98 98H2Z" },
  {
    id: "rightTriangle",
    name: "直角三角",
    category: "基本",
    path: "M2 2L98 98H2Z",
  },
  {
    id: "diamond",
    name: "ひし形",
    category: "基本",
    path: "M50 2L98 50 50 98 2 50Z",
  },
  {
    id: "pentagon",
    name: "五角形",
    category: "基本",
    path: "M50 2L98 38 80 98H20L2 38Z",
  },
  {
    id: "hexagon",
    name: "六角形",
    category: "基本",
    path: "M25 2H75L98 50 75 98H25L2 50Z",
  },
  {
    id: "parallelogram",
    name: "平行四辺形",
    category: "基本",
    path: "M25 2H98L75 98H2Z",
  },
  {
    id: "trapezoid",
    name: "台形",
    category: "基本",
    path: "M25 2H75L98 98H2Z",
  },
  {
    id: "star",
    name: "星",
    category: "基本",
    path: "M50 2L62 35 98 36 70 58 80 94 50 73 20 94 30 58 2 36 38 35Z",
  },
  {
    id: "heart",
    name: "ハート",
    category: "基本",
    path: "M50 96C-25 43 2-20 50 20C98-20 125 43 50 96Z",
  },
  {
    id: "cloud",
    name: "雲",
    category: "基本",
    path: "M22 85C-4 86-6 55 12 46C0 22 25 8 42 19C57-7 89 4 90 28C112 33 111 65 94 71C93 95 65 104 51 87C40 101 20 101 22 85Z",
  },
  {
    id: "arrow",
    name: "右矢印",
    category: "矢印",
    path: "M2 30H60V4L98 50 60 96V70H2Z",
  },
  {
    id: "leftArrow",
    name: "左矢印",
    category: "矢印",
    path: "M98 30H40V4L2 50 40 96V70H98Z",
  },
  {
    id: "upArrow",
    name: "上矢印",
    category: "矢印",
    path: "M30 98V40H4L50 2 96 40H70V98Z",
  },
  {
    id: "downArrow",
    name: "下矢印",
    category: "矢印",
    path: "M30 2V60H4L50 98 96 60H70V2Z",
  },
  {
    id: "doubleArrow",
    name: "左右矢印",
    category: "矢印",
    path: "M2 50L30 12V33H70V12L98 50 70 88V67H30V88Z",
  },
  {
    id: "chevron",
    name: "山形矢印",
    category: "矢印",
    path: "M2 2H58L98 50 58 98H2L42 50Z",
  },
  {
    id: "bubble",
    name: "吹き出し",
    category: "吹き出し",
    path: "M12 2H88Q98 2 98 12V68Q98 78 88 78H38L17 97 21 78H12Q2 78 2 68V12Q2 2 12 2Z",
  },
  {
    id: "ovalBubble",
    name: "丸い吹き出し",
    category: "吹き出し",
    path: "M25 82C-10 65-4 2 50 2C105 2 113 66 70 83L60 98 48 86C40 86 32 85 25 82Z",
  },
  {
    id: "thoughtBubble",
    name: "考える吹き出し",
    category: "吹き出し",
    path: "M22 72C0 73-3 46 12 39C2 19 23 7 38 16C52-5 80 4 81 23C103 25 108 51 89 63C88 82 62 90 49 76C39 87 21 87 22 72ZM19 86A5 5 0 1 0 19 96A5 5 0 1 0 19 86Z",
  },
  {
    id: "terminator",
    name: "開始・終了",
    category: "フロー",
    path: "M25 2H75A25 48 0 0 1 75 98H25A25 48 0 0 1 25 2Z",
  },
  {
    id: "document",
    name: "書類",
    category: "フロー",
    path: "M2 2H98V84C65 59 35 108 2 84Z",
  },
  {
    id: "cylinder",
    name: "データ",
    category: "フロー",
    path: "M2 15C2-2 98-2 98 15V85C98 102 2 102 2 85ZM2 15C2 32 98 32 98 15",
  },
] as const;
export type ShapeKind = (typeof shapeCatalog)[number]["id"];
export const shapeIds = shapeCatalog.map((s) => s.id);
export const shapePath = (id: ShapeKind) =>
  shapeCatalog.find((s) => s.id === id)?.path ?? shapeCatalog[0].path;
