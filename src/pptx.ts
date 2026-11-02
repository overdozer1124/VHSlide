import { unzipSync, strFromU8 } from "fflate";
import { H, W, MAX_FILE_BYTES, uid, parseDeck, serializeDeck } from "./model";
import type { Deck, Element, Shape } from "./model";

const descendants = (node: Node, name: string): globalThis.Element[] =>
  Array.from((node as Document).getElementsByTagNameNS("*", name));
const first = (node: Node, name: string) => descendants(node, name)[0];
const attr = (
  node: globalThis.Element | undefined,
  key: string,
  fallback = "",
) => node?.getAttribute(key) ?? fallback;
const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));
const invalid = () =>
  new Error(
    "PPTXを読み込めませんでした。破損していない、パスワードなしの.pptxファイルを選んでください。",
  );

/** Local OOXML import. Relationships are resolved inside the archive only. */
export async function importPptx(file: File): Promise<Deck> {
  if (file.size > MAX_FILE_BYTES) throw new Error("ファイルは25MBまでです。");
  let expanded = 0;
  let files: ReturnType<typeof unzipSync>;
  try {
    files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter(entry) {
        expanded += entry.originalSize;
        if (expanded > 100_000_000 || entry.originalSize > 25_000_000)
          throw new Error("PPTXの展開後サイズが大きすぎます。");
        return /\.(xml|rels|png|jpe?g|gif|webp)$/i.test(entry.name);
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("展開後")) throw error;
    throw invalid();
  }
  function xml(path: string): Document {
    if (!files[path]) throw invalid();
    const source = strFromU8(files[path]);
    if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw invalid();
    const doc = new DOMParser().parseFromString(source, "application/xml");
    if (first(doc, "parsererror")) throw invalid();
    return doc;
  }
  function relationships(path: string) {
    const slash = path.lastIndexOf("/");
    const relPath = `${path.slice(0, slash + 1)}_rels/${path.slice(slash + 1)}.rels`;
    const result = new Map<string, string>();
    if (!files[relPath]) return result;
    for (const rel of descendants(xml(relPath), "Relationship")) {
      if (attr(rel, "TargetMode") === "External") continue;
      const target = attr(rel, "Target");
      const parts: string[] = [];
      for (const part of (target.startsWith("/")
        ? target.slice(1)
        : path.slice(0, slash + 1) + target
      ).split("/")) {
        if (part === "..") parts.pop();
        else if (part && part !== ".") parts.push(part);
      }
      result.set(attr(rel, "Id"), parts.join("/"));
    }
    return result;
  }
  const presentation = xml("ppt/presentation.xml");
  const rels = relationships("ppt/presentation.xml");
  const size = first(presentation, "sldSz");
  const cx = Number(attr(size, "cx")),
    cy = Number(attr(size, "cy"));
  if (!(cx > 0 && cy > 0)) throw invalid();
  const scale = Math.min(W / cx, H / cy);
  const offsetX = (W - cx * scale) / 2,
    offsetY = (H - cy * scale) / 2;
  const ids = descendants(presentation, "sldId");
  if (!ids.length || ids.length > 100)
    throw new Error("PPTXは1〜100ページまで読み込めます。");
  const color = (node: Node | undefined, fallback: string) => {
    const value = node && attr(first(node, "srgbClr"), "val");
    return value && /^[0-9a-f]{6}$/i.test(value) ? `#${value}` : fallback;
  };
  const slides = ids.map((id, index) => {
    const path = rels.get(
      id.getAttributeNS(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "id",
      ) ?? attr(id, "r:id"),
    );
    if (!path) throw invalid();
    const doc = xml(path),
      links = relationships(path);
    const tree = first(doc, "spTree");
    if (!tree) throw invalid();
    const inherited: Document[] = [];
    let ancestorPath = path;
    for (const folder of ["slideLayouts/", "slideMasters/"]) {
      const target = [...relationships(ancestorPath).values()].find((p) =>
        p.includes(folder),
      );
      if (!target || !files[target]) break;
      inherited.push(xml(target));
      ancestorPath = target;
    }
    const elements: Element[] = [];
    // Unsupported groups/charts are omitted; never fetch external linked content.
    for (const node of Array.from(tree.children)) {
      if (node.localName !== "sp" && node.localName !== "pic") continue;
      let transform = first(node, "xfrm");
      const placeholder = first(node, "ph");
      if (!transform && placeholder) {
        for (const ancestor of inherited) {
          const match = descendants(ancestor, "sp").find((candidate) => {
            const ph = first(candidate, "ph");
            return (
              ph &&
              (placeholder.hasAttribute("idx")
                ? attr(ph, "idx", "0") === attr(placeholder, "idx")
                : attr(ph, "type", "body") ===
                  attr(placeholder, "type", "body"))
            );
          });
          if (match) transform = first(match, "xfrm");
          if (transform) break;
        }
      }
      const off = transform && first(transform, "off"),
        ext = transform && first(transform, "ext");
      if (!off || !ext) continue;
      const x = clamp(Number(attr(off, "x")) * scale + offsetX, 0, W - 20);
      const y = clamp(Number(attr(off, "y")) * scale + offsetY, 0, H - 20);
      const w = clamp(Number(attr(ext, "cx")) * scale, 20, W - x);
      const h = clamp(Number(attr(ext, "cy")) * scale, 20, H - y);
      const base = { id: uid(), x, y, w, h };
      if (node.localName === "pic") {
        const blip = first(node, "blip");
        const imagePath = links.get(
          attr(blip, "r:embed") ||
            blip?.getAttributeNS(
              "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
              "embed",
            ) ||
            "",
        );
        const bytes = imagePath && files[imagePath];
        const extension = imagePath?.split(".").pop()?.toLowerCase();
        const mime = extension === "jpg" ? "jpeg" : extension;
        if (!bytes || !["png", "jpeg", "webp", "gif"].includes(mime ?? ""))
          continue;
        if (bytes.length > 6_000_000)
          throw new Error("PPTX内の画像は1枚6MBまでです。");
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        elements.push({
          ...base,
          type: "image",
          src: `data:image/${mime};base64,${btoa(binary)}`,
        });
        continue;
      }
      const properties = first(node, "spPr");
      const geometry =
        properties && attr(first(properties, "prstGeom"), "prst");
      const shapes: Record<string, Shape> = {
        rect: "rect",
        roundRect: "rounded",
        ellipse: "circle",
        rightArrow: "arrow",
        wedgeRoundRectCallout: "bubble",
      };
      const fill =
        properties &&
        Array.from(properties.children).find(
          (n) => n.localName === "solidFill",
        );
      if (geometry && shapes[geometry] && fill)
        elements.push({
          ...base,
          id: uid(),
          type: "shape",
          shape: shapes[geometry],
          fill: color(fill, "#dddddd"),
          stroke: color(first(properties!, "ln"), color(fill, "#dddddd")),
        });
      const body = first(node, "txBody");
      if (!body) continue;
      const text = descendants(body, "p")
        .map((p) =>
          Array.from(p.children)
            .map((run) =>
              run.localName === "br"
                ? "\n"
                : descendants(run, "t")
                    .map((t) => t.textContent ?? "")
                    .join(""),
            )
            .join(""),
        )
        .join("\n");
      if (!text) continue;
      const style = first(body, "rPr") ?? first(body, "defRPr");
      elements.push({
        ...base,
        type: "text",
        text,
        fontSize: clamp(
          (Number(attr(style, "sz", "2400")) / 100) * 12700 * scale,
          12,
          120,
        ),
        bold: attr(style, "b") === "1",
        color: color(style, "#173d38"),
      });
    }
    if (elements.length > 200)
      throw new Error("1ページの要素は200個までです。");
    return {
      id: uid(),
      x: index,
      y: 0,
      title: (
        elements.find((e) => e.type === "text")?.text?.split("\n")[0] ||
        `ページ ${index + 1}`
      ).slice(0, 200),
      background: color(first(doc, "bg"), "#ffffff"),
      elements,
    };
  });
  return parseDeck(
    serializeDeck({
      version: 1,
      title: file.name.replace(/\.pptx$/i, "").slice(0, 200),
      slides,
    }),
  );
}
