// Bundled from VHSlide 0.120.3 (26b1cf3): parseDeck and worksheet adoption.
// Regenerate with: node scripts/update-vendor.mjs <vhslide checkout>
// src/featureVersions.ts
var featureVersionSchema = `
CREATE TABLE IF NOT EXISTS feature_versions(deck TEXT NOT NULL, feature TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(deck,feature));`;
function versionTriggers(table, feature, deckOf) {
  const bump = (alias) => `INSERT INTO feature_versions(deck,feature,version) VALUES(${deckOf(alias)},'${feature}',1) ON CONFLICT(deck,feature) DO UPDATE SET version=version+1;`;
  return `
CREATE TRIGGER IF NOT EXISTS fv_${table}_ins AFTER INSERT ON ${table} BEGIN ${bump("NEW")} END;
CREATE TRIGGER IF NOT EXISTS fv_${table}_upd AFTER UPDATE ON ${table} BEGIN ${bump("NEW")} END;
CREATE TRIGGER IF NOT EXISTS fv_${table}_del AFTER DELETE ON ${table} BEGIN ${bump("OLD")} END;`;
}

// src/surveys.ts
var SurveyError = class extends Error {
  status;
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};

// src/worksheets.ts
var TEXT_PLACEHOLDER_DEFAULT = "\u3053\u3053\u306B\u81EA\u5206\u306E\u8003\u3048\u3092\u5165\u529B";
function check(ok, message, status = 400) {
  if (!ok) throw new SurveyError(status, message);
}
var str = (v, max) => typeof v === "string" && v.length <= max;
function parseWorksheet(value) {
  const v = value;
  check(
    v && str(v.title, 200) && v.title.trim() && str(v.description, 1e3),
    "\u30BF\u30A4\u30C8\u30EB\u30FB\u8AAC\u660E\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
  );
  const validSize = (value2, min, max) => value2 === void 0 || typeof value2 === "number" && Number.isInteger(value2) && value2 >= min && value2 <= max;
  check(
    validSize(v.fontSize, 12, 60),
    "\u6587\u5B57\u306E\u5927\u304D\u3055\u306F12\u301C60\u3067\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
  );
  check(
    Array.isArray(v.fields) && v.fields.length > 0 && v.fields.length <= 40,
    "\u5165\u529B\u6B04\u306F1\u301C40\u9805\u76EE\u3067\u3059\u3002"
  );
  const ids = /* @__PURE__ */ new Set();
  let sections;
  if (v.sections !== void 0) {
    check(
      Array.isArray(v.sections) && v.sections.length <= 40,
      "\u30BB\u30AF\u30B7\u30E7\u30F3\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
    );
    const sectionIds = /* @__PURE__ */ new Set();
    sections = v.sections.map((s) => {
      check(
        s && typeof s.id === "string" && /^[a-zA-Z0-9_-]{1,60}$/.test(s.id) && !sectionIds.has(s.id) && str(s.title, 200),
        "\u30BB\u30AF\u30B7\u30E7\u30F3\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
      );
      sectionIds.add(s.id);
      return { id: s.id, title: s.title };
    });
  }
  const fields = v.fields.map((f) => {
    check(
      f && typeof f.id === "string" && /^[a-zA-Z0-9_-]{1,60}$/.test(f.id) && !["__proto__", "constructor", "prototype"].includes(f.id) && !ids.has(f.id),
      "\u5165\u529B\u6B04\u306EID\u304C\u4E0D\u6B63\u3067\u3059\u3002"
    );
    check(
      validSize(f.widthPercent, 20, 100) && validSize(f.inputHeight, 32, 400) && validSize(f.fontSize, 12, 60),
      "\u5165\u529B\u6B04\u306E\u5E45\u30FB\u9AD8\u3055\u30FB\u6587\u5B57\u306E\u5927\u304D\u3055\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
    );
    ids.add(f.id);
    check(
      f.sectionId === void 0 || typeof f.sectionId === "string" && /^[a-zA-Z0-9_-]{1,60}$/.test(f.sectionId) && (!sections || sections.some(
        (s) => s.id === f.sectionId && s.title === f.section
      )),
      "\u30BB\u30AF\u30B7\u30E7\u30F3\u306E\u8A2D\u5B9A\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
    );
    check(!sections || !!f.sectionId, "\u5165\u529B\u6B04\u306E\u30BB\u30AF\u30B7\u30E7\u30F3\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
    check(
      str(f.label, 200) && f.label.trim() && str(f.placeholder, 200) && str(f.section, 200) && typeof f.wide === "boolean" && ["text", "checkbox", "single", "multiple", "radar", "drawing"].includes(
        f.kind
      ),
      "\u5165\u529B\u6B04\u306E\u8A2D\u5B9A\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
    );
    check(
      Array.isArray(f.options) && (f.kind === "single" || f.kind === "multiple" ? f.options.length >= 2 && f.options.length <= 10 : f.options.length === 0) && f.options.every((o) => str(o, 100) && o.trim()) && new Set(f.options).size === f.options.length,
      "\u9078\u629E\u80A2\u306F\u91CD\u8907\u3057\u306A\u30442\u301C10\u9805\u76EE\u3067\u3059\u3002"
    );
    check(
      f.reason === void 0 || typeof f.reason === "boolean" && (f.kind === "single" || f.kind === "multiple"),
      "\u7406\u7531\u6B04\u306E\u8A2D\u5B9A\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
    );
    check(
      f.aggregatePublic === void 0 || typeof f.aggregatePublic === "boolean" && (f.kind === "single" || f.kind === "multiple"),
      "\u96C6\u8A08\u306E\u516C\u958B\u8A2D\u5B9A\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
    );
    check(
      f.hideLabel === void 0 || typeof f.hideLabel === "boolean" && f.kind !== "checkbox",
      "\u9805\u76EE\u540D\u306E\u8868\u793A\u8A2D\u5B9A\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
    );
    if (f.kind === "radar") {
      const radar = f.radar;
      const validLabels = (labels, min, max) => Array.isArray(labels) && labels.length >= min && labels.length <= max && labels.every((label) => str(label, 80) && label.trim()) && new Set(labels.map((label) => label.trim())).size === labels.length;
      check(
        radar && validLabels(radar.axes, 3, 10) && validLabels(radar.series, 1, 4) && Number.isInteger(radar.min) && Number.isInteger(radar.max) && radar.min >= 0 && radar.max <= 100 && radar.min < radar.max,
        "\u30EC\u30FC\u30C0\u30FC\u30C1\u30E3\u30FC\u30C8\u306E\u9805\u76EE\u30FB\u7CFB\u5217\u30FB\u6570\u5024\u306E\u7BC4\u56F2\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
      );
    } else
      check(
        f.radar === void 0,
        "\u30EC\u30FC\u30C0\u30FC\u30C1\u30E3\u30FC\u30C8\u306E\u8A2D\u5B9A\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
      );
    return {
      id: f.id,
      label: f.label.trim(),
      kind: f.kind,
      options: [...f.options],
      placeholder: f.kind === "drawing" && f.placeholder === TEXT_PLACEHOLDER_DEFAULT ? "" : f.placeholder,
      section: f.section,
      ...f.sectionId !== void 0 ? { sectionId: f.sectionId } : {},
      wide: f.wide,
      ...f.reason ? { reason: true } : {},
      ...f.aggregatePublic ? { aggregatePublic: true } : {},
      ...f.hideLabel ? { hideLabel: true } : {},
      ...f.widthPercent !== void 0 ? { widthPercent: f.widthPercent } : {},
      ...f.inputHeight !== void 0 ? { inputHeight: f.inputHeight } : {},
      ...f.fontSize !== void 0 ? { fontSize: f.fontSize } : {},
      ...f.radar ? {
        radar: {
          axes: f.radar.axes.map((v2) => v2.trim()),
          series: f.radar.series.map((v2) => v2.trim()),
          min: f.radar.min,
          max: f.radar.max
        }
      } : {}
    };
  });
  let modalLayout;
  if (v.modalLayout !== void 0) {
    const layout = v.modalLayout;
    check(
      layout && Array.isArray(layout.items) && layout.items.length <= fields.length,
      "\u30EC\u30A4\u30A2\u30A6\u30C8\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
    );
    const placed = /* @__PURE__ */ new Set();
    modalLayout = {
      items: layout.items.map((item) => {
        check(
          item && typeof item.id === "string" && ids.has(item.id) && !placed.has(item.id) && validSize(item.x, 0, 950) && validSize(item.y, 0, 1e4) && validSize(item.w, 50, 1e3) && validSize(item.h, 60, 3e3) && item.x + item.w <= 1e3 && item.y + item.h <= 11e3,
          "\u30EC\u30A4\u30A2\u30A6\u30C8\u306E\u4F4D\u7F6E\u30FB\u5927\u304D\u3055\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
        );
        placed.add(item.id);
        return { id: item.id, x: item.x, y: item.y, w: item.w, h: item.h };
      })
    };
  }
  return {
    title: v.title.trim(),
    description: v.description,
    fields,
    ...sections ? { sections } : {},
    ...v.fontSize !== void 0 ? { fontSize: v.fontSize } : {},
    ...modalLayout ? { modalLayout } : {}
  };
}
function parseWorksheetBinding(value) {
  const v = value;
  check(
    v && /^[a-f0-9-]{36}$/.test(v.deckId) && /^[a-f0-9-]{36}$/.test(v.worksheetId),
    "\u30EF\u30FC\u30AF\u30B7\u30FC\u30C8\u306E\u53C2\u7167\u304C\u4E0D\u6B63\u3067\u3059\u3002"
  );
  return { ...parseWorksheet(v), deckId: v.deckId, worksheetId: v.worksheetId };
}
var worksheetSchema = `CREATE TABLE IF NOT EXISTS worksheets(id TEXT PRIMARY KEY,deck TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,definition TEXT NOT NULL,status TEXT NOT NULL,created INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS worksheets_deck ON worksheets(deck); CREATE TABLE IF NOT EXISTS worksheet_answers(worksheet TEXT NOT NULL REFERENCES worksheets(id) ON DELETE CASCADE,author TEXT NOT NULL,value TEXT NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(worksheet,author));` + featureVersionSchema + versionTriggers("worksheets", "worksheets", (a) => `${a}.deck`) + versionTriggers(
  "worksheet_answers",
  "worksheets",
  // On a cascading delete the parent sheet is already gone, so the
  // lookup yields NULL; bump a throwaway counter instead of failing.
  (a) => `COALESCE((SELECT deck FROM worksheets WHERE id=${a}.worksheet),'')`
);

// src/surveyBinding.ts
function parseSurveyBinding(value) {
  const v = value;
  if (!v || typeof v.deckId !== "string" || typeof v.surveyId !== "string" || !/^[a-f0-9-]{36}$/.test(v.deckId) || !/^[a-f0-9-]{36}$/.test(v.surveyId) || typeof v.question !== "string" || !v.question.trim() || v.question.length > 200 || !["single", "multiple", "text"].includes(v.kind) || !Array.isArray(v.options) || v.options.length > 10 || (v.kind === "text" ? v.options.length !== 0 : v.options.length < 2) || v.options.some((o) => typeof o !== "string" || !o.trim() || o.length > 60)) {
    throw new Error("\u30B9\u30E9\u30A4\u30C9\u5185\u30A2\u30F3\u30B1\u30FC\u30C8\u306E\u5F62\u5F0F\u304C\u6B63\u3057\u304F\u3042\u308A\u307E\u305B\u3093\u3002");
  }
  return {
    deckId: v.deckId,
    surveyId: v.surveyId,
    question: v.question,
    kind: v.kind,
    options: [...v.options]
  };
}

// src/responseFields.ts
function parseResponseField(value) {
  const v = value;
  if (!v || typeof v.showLabel !== "boolean" || v.showSection !== void 0 && typeof v.showSection !== "boolean")
    throw Error("\u5165\u529B\u6B04\u306E\u5F62\u5F0F\u304C\u6B63\u3057\u304F\u3042\u308A\u307E\u305B\u3093\u3002");
  if (v.source === "survey")
    return {
      source: "survey",
      ...parseSurveyBinding(v),
      showLabel: v.showLabel,
      ...v.showSection === void 0 ? {} : { showSection: v.showSection }
    };
  if (v.source !== "worksheet" || typeof v.deckId !== "string" || typeof v.worksheetId !== "string" || !/^[a-f0-9-]{36}$/.test(v.deckId) || !/^[a-f0-9-]{36}$/.test(v.worksheetId))
    throw Error("\u5165\u529B\u6B04\u306E\u53C2\u7167\u304C\u6B63\u3057\u304F\u3042\u308A\u307E\u305B\u3093\u3002");
  const field = parseWorksheet({
    title: "\u5165\u529B\u6B04",
    description: "",
    fields: [v.field]
  }).fields[0];
  return {
    source: "worksheet",
    deckId: v.deckId,
    worksheetId: v.worksheetId,
    field,
    showLabel: v.showLabel,
    ...v.showSection === void 0 ? {} : { showSection: v.showSection }
  };
}

// src/chartData.ts
function parseChart(value) {
  const c = value, fail = () => {
    throw new Error(
      "\u30B0\u30E9\u30D5\u306F0\u301C12\u9805\u76EE\u3001\u5024\u306F-100\u4E07\u301C100\u4E07\uFF08\u5186\u30B0\u30E9\u30D5\u306F0\u4EE5\u4E0A\uFF09\u3067\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
    );
  };
  if (!c || !["bar", "line", "pie"].includes(c.kind) || typeof c.title !== "string" || c.title.length > 100 || typeof c.showValues !== "boolean" || typeof c.showLegend !== "boolean" || !Array.isArray(c.series) || c.series.length > 12)
    return fail();
  const ids = /* @__PURE__ */ new Set();
  const series = c.series.map((p) => {
    if (!p || typeof p.id !== "string" || !p.id.length || p.id.length > 100 || ids.has(p.id) || typeof p.label !== "string" || p.label.length > 60 || typeof p.value !== "number" || !Number.isFinite(p.value) || Math.abs(p.value) > 1e6 || c.kind === "pie" && p.value < 0 || !/^#[\da-f]{6}$/i.test(p.color))
      return fail();
    ids.add(p.id);
    return { id: p.id, label: p.label, value: p.value, color: p.color };
  });
  return {
    kind: c.kind,
    title: c.title,
    series,
    showValues: c.showValues,
    showLegend: c.showLegend
  };
}

// src/surveyResults.ts
function parseSurveyResultBinding(value) {
  const v = value;
  if (!v || typeof v.deckId !== "string" || typeof v.surveyId !== "string" || !/^[a-f0-9-]{36}$/.test(v.deckId) || !/^[a-f0-9-]{36}$/.test(v.surveyId) || !["chart", "caption"].includes(v.part))
    throw Error("\u30A2\u30F3\u30B1\u30FC\u30C8\u96C6\u8A08\u306E\u53C2\u7167\u304C\u6B63\u3057\u304F\u3042\u308A\u307E\u305B\u3093\u3002");
  return { deckId: v.deckId, surveyId: v.surveyId, part: v.part };
}

// src/webbingBinding.ts
function parseWebbingBinding(value) {
  const v = value;
  if (!v || typeof v.deckId !== "string" || typeof v.mapId !== "string" || !/^[a-f0-9-]{36}$/.test(v.deckId) || !/^[a-f0-9-]{36}$/.test(v.mapId) || typeof v.title !== "string" || !v.title.trim() || v.title.length > 100) {
    throw new Error("\u30B9\u30E9\u30A4\u30C9\u5185\u30A6\u30A7\u30D3\u30F3\u30B0\u30DE\u30C3\u30D7\u306E\u5F62\u5F0F\u304C\u6B63\u3057\u304F\u3042\u308A\u307E\u305B\u3093\u3002");
  }
  return { deckId: v.deckId, mapId: v.mapId, title: v.title };
}

// src/webLink.ts
function webLink(value) {
  const url = new URL(value.trim());
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
    throw new Error("http:// \u307E\u305F\u306F https:// \u3067\u59CB\u307E\u308BURL\u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
  return url.href;
}

// src/structureData.ts
function parseAnchor(value) {
  const a = value;
  if (!a || typeof a !== "object" || typeof a.elementId !== "string" || !a.elementId.length || a.elementId.length > 100 || !["top", "right", "bottom", "left"].includes(a.side))
    throw new Error("\u7DDA\u306E\u63A5\u7D9A\u5148\u304C\u6B63\u3057\u304F\u3042\u308A\u307E\u305B\u3093\u3002");
  return { elementId: a.elementId, side: a.side };
}

// src/richText.ts
var TEXT_FONTS = [
  "sans",
  "serif",
  "mono",
  "rounded",
  "klee",
  "yomogi",
  "ud",
  "brush",
  "shippori"
];
var RICH_FORMATS = [
  "bold",
  "italic",
  "underline",
  "strike",
  "color",
  "background",
  "size",
  "font",
  "align",
  "list",
  "lineheight"
];
function parseRichText(input, plain) {
  const fail = () => {
    throw new Error("\u6587\u5B57\u306E\u66F8\u5F0F\u30C7\u30FC\u30BF\u304C\u6B63\u3057\u304F\u3042\u308A\u307E\u305B\u3093\u3002");
  };
  if (!Array.isArray(input) || input.length > 2e4) return fail();
  let length = 0;
  const ops = input.map((op) => {
    if (!op || typeof op !== "object" || typeof op.insert !== "string" || !op.insert.length || Object.keys(op).some((k) => !["insert", "attributes"].includes(k)))
      return fail();
    for (const char of op.insert)
      if (char.length === 1 && char.charCodeAt(0) >= 55296 && char.charCodeAt(0) <= 57343)
        return fail();
    length += op.insert.length;
    if (length > 10001) return fail();
    const attributes = {};
    if (op.attributes !== void 0) {
      if (!op.attributes || typeof op.attributes !== "object" || Array.isArray(op.attributes))
        return fail();
      for (const [key, value] of Object.entries(op.attributes)) {
        if (!RICH_FORMATS.includes(key)) return fail();
        if (["bold", "italic", "underline", "strike"].includes(key)) {
          if (typeof value !== "boolean") return fail();
        } else if (["color", "background"].includes(key)) {
          if (typeof value !== "string" || !/^#[\da-fA-F]{6}$/.test(value))
            return fail();
        } else if (key === "size") {
          if (typeof value !== "string" || !/^\d+px$/.test(value) || Number.parseInt(value) < 12 || Number.parseInt(value) > 120)
            return fail();
        } else if (key === "font") {
          if (!TEXT_FONTS.includes(value))
            return fail();
        } else if (key === "align") {
          if (!["center", "right", "justify"].includes(value))
            return fail();
        } else if (key === "list") {
          if (!["bullet", "ordered"].includes(value)) return fail();
        } else if (key === "lineheight") {
          if (!["1", "1.25", "1.5", "2"].includes(value))
            return fail();
        }
        if (["align", "list", "lineheight"].includes(key) && !/^\n+$/.test(op.insert))
          return fail();
        attributes[key] = value;
      }
    }
    return {
      insert: op.insert,
      ...Object.keys(attributes).length ? { attributes } : {}
    };
  });
  if (ops.map((o) => o.insert).join("") !== plain + "\n") return fail();
  const merged = [];
  for (const op of ops) {
    const last = merged.at(-1);
    if (last && JSON.stringify(last.attributes ?? {}) === JSON.stringify(op.attributes ?? {}))
      last.insert += op.insert;
    else merged.push(op);
  }
  return merged;
}

// src/imageData.ts
function parseCrop(value) {
  const c = value;
  if (!c || typeof c !== "object" || ![c.x, c.y, c.w, c.h].every(Number.isFinite) || c.x < 0 || c.y < 0 || c.w < 1e-5 || c.h < 1e-5 || c.x + c.w > 1.000001 || c.y + c.h > 1.000001)
    throw new Error("\u753B\u50CF\u306E\u5207\u308A\u629C\u304D\u7BC4\u56F2\u304C\u6B63\u3057\u304F\u3042\u308A\u307E\u305B\u3093\u3002");
  return { x: c.x, y: c.y, w: c.w, h: c.h };
}

// src/shapeCatalog.ts
var shapeCatalog = [
  { id: "rect", name: "\u56DB\u89D2", category: "\u57FA\u672C", path: "M2 2H98V98H2Z" },
  {
    id: "rounded",
    name: "\u89D2\u4E38\u56DB\u89D2",
    category: "\u57FA\u672C",
    path: "M16 2H84Q98 2 98 16V84Q98 98 84 98H16Q2 98 2 84V16Q2 2 16 2Z"
  },
  {
    id: "circle",
    name: "\u4E38",
    category: "\u57FA\u672C",
    path: "M50 2A48 48 0 1 1 49.99 2Z"
  },
  { id: "triangle", name: "\u4E09\u89D2", category: "\u57FA\u672C", path: "M50 2L98 98H2Z" },
  {
    id: "rightTriangle",
    name: "\u76F4\u89D2\u4E09\u89D2",
    category: "\u57FA\u672C",
    path: "M2 2L98 98H2Z"
  },
  {
    id: "diamond",
    name: "\u3072\u3057\u5F62",
    category: "\u57FA\u672C",
    path: "M50 2L98 50 50 98 2 50Z"
  },
  {
    id: "pentagon",
    name: "\u4E94\u89D2\u5F62",
    category: "\u57FA\u672C",
    path: "M50 2L98 38 80 98H20L2 38Z"
  },
  {
    id: "hexagon",
    name: "\u516D\u89D2\u5F62",
    category: "\u57FA\u672C",
    path: "M25 2H75L98 50 75 98H25L2 50Z"
  },
  {
    id: "parallelogram",
    name: "\u5E73\u884C\u56DB\u8FBA\u5F62",
    category: "\u57FA\u672C",
    path: "M25 2H98L75 98H2Z"
  },
  {
    id: "trapezoid",
    name: "\u53F0\u5F62",
    category: "\u57FA\u672C",
    path: "M25 2H75L98 98H2Z"
  },
  {
    id: "star",
    name: "\u661F",
    category: "\u57FA\u672C",
    path: "M50 2L62 35 98 36 70 58 80 94 50 73 20 94 30 58 2 36 38 35Z"
  },
  {
    id: "heart",
    name: "\u30CF\u30FC\u30C8",
    category: "\u57FA\u672C",
    path: "M50 96C-25 43 2-20 50 20C98-20 125 43 50 96Z"
  },
  {
    id: "cloud",
    name: "\u96F2",
    category: "\u57FA\u672C",
    path: "M22 85C-4 86-6 55 12 46C0 22 25 8 42 19C57-7 89 4 90 28C112 33 111 65 94 71C93 95 65 104 51 87C40 101 20 101 22 85Z"
  },
  {
    id: "arrow",
    name: "\u53F3\u77E2\u5370",
    category: "\u77E2\u5370",
    path: "M2 30H60V4L98 50 60 96V70H2Z"
  },
  {
    id: "leftArrow",
    name: "\u5DE6\u77E2\u5370",
    category: "\u77E2\u5370",
    path: "M98 30H40V4L2 50 40 96V70H98Z"
  },
  {
    id: "upArrow",
    name: "\u4E0A\u77E2\u5370",
    category: "\u77E2\u5370",
    path: "M30 98V40H4L50 2 96 40H70V98Z"
  },
  {
    id: "downArrow",
    name: "\u4E0B\u77E2\u5370",
    category: "\u77E2\u5370",
    path: "M30 2V60H4L50 98 96 60H70V2Z"
  },
  {
    id: "doubleArrow",
    name: "\u5DE6\u53F3\u77E2\u5370",
    category: "\u77E2\u5370",
    path: "M2 50L30 12V33H70V12L98 50 70 88V67H30V88Z"
  },
  {
    id: "chevron",
    name: "\u5C71\u5F62\u77E2\u5370",
    category: "\u77E2\u5370",
    path: "M2 2H58L98 50 58 98H2L42 50Z"
  },
  {
    id: "bubble",
    name: "\u5439\u304D\u51FA\u3057",
    category: "\u5439\u304D\u51FA\u3057",
    path: "M12 2H88Q98 2 98 12V68Q98 78 88 78H38L17 97 21 78H12Q2 78 2 68V12Q2 2 12 2Z"
  },
  {
    id: "ovalBubble",
    name: "\u4E38\u3044\u5439\u304D\u51FA\u3057",
    category: "\u5439\u304D\u51FA\u3057",
    path: "M25 82C-10 65-4 2 50 2C105 2 113 66 70 83L60 98 48 86C40 86 32 85 25 82Z"
  },
  {
    id: "thoughtBubble",
    name: "\u8003\u3048\u308B\u5439\u304D\u51FA\u3057",
    category: "\u5439\u304D\u51FA\u3057",
    path: "M22 72C0 73-3 46 12 39C2 19 23 7 38 16C52-5 80 4 81 23C103 25 108 51 89 63C88 82 62 90 49 76C39 87 21 87 22 72ZM19 86A5 5 0 1 0 19 96A5 5 0 1 0 19 86Z"
  },
  {
    id: "terminator",
    name: "\u958B\u59CB\u30FB\u7D42\u4E86",
    category: "\u30D5\u30ED\u30FC",
    path: "M25 2H75A25 48 0 0 1 75 98H25A25 48 0 0 1 25 2Z"
  },
  {
    id: "document",
    name: "\u66F8\u985E",
    category: "\u30D5\u30ED\u30FC",
    path: "M2 2H98V84C65 59 35 108 2 84Z"
  },
  {
    id: "cylinder",
    name: "\u30C7\u30FC\u30BF",
    category: "\u30D5\u30ED\u30FC",
    path: "M2 15C2-2 98-2 98 15V85C98 102 2 102 2 85ZM2 15C2 32 98 32 98 15"
  }
];
var shapeIds = shapeCatalog.map((s) => s.id);

// src/tableData.ts
var MAX_TABLE_AXIS = 12;
var MAX_CELL_TEXT = 2e3;
var CELL_STYLE_KEYS = [
  "fill",
  "color",
  "fontSize",
  "bold",
  "italic",
  "textAlign",
  "verticalAlign"
];
var cellKey = (row, column) => `${row}:${column}`;
function parseTable(value) {
  const fail = () => {
    throw new Error(
      "\u8868\u306F1\u301C12\u884C\u30FB1\u301C12\u5217\u3001\u30BB\u30EB\u306E\u6587\u5B57\u306F2000\u6587\u5B57\u4EE5\u5185\u306B\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
    );
  };
  if (!value || typeof value !== "object") return fail();
  const t = value;
  const axis = (a) => {
    if (!Array.isArray(a) || !a.length || a.length > MAX_TABLE_AXIS || a.some(
      (v) => typeof v !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(v)
    ) || new Set(a).size !== a.length)
      return fail();
    return [...a];
  };
  const rows = axis(t.rows), columns = axis(t.columns);
  if (typeof t.header !== "boolean" || !t.cells || typeof t.cells !== "object" || Array.isArray(t.cells))
    return fail();
  const keys = new Set(rows.flatMap((r) => columns.map((c) => cellKey(r, c))));
  const cells = Object.fromEntries(
    [...keys].map((key) => [key, ""])
  );
  for (const [key, text] of Object.entries(t.cells)) {
    if (!keys.has(key) || typeof text !== "string" || text.length > MAX_CELL_TEXT)
      return fail();
    cells[key] = text;
  }
  const styles = {};
  if (t.styles !== void 0) {
    if (!t.styles || typeof t.styles !== "object" || Array.isArray(t.styles))
      return fail();
    for (const [key, style] of Object.entries(t.styles)) {
      if (!keys.has(key) || !style || typeof style !== "object" || Array.isArray(style))
        return fail();
      const next = {};
      for (const [k, v] of Object.entries(style)) {
        if (!CELL_STYLE_KEYS.includes(k))
          return fail();
        if (k === "fill" || k === "color") {
          if (typeof v !== "string" || !/^#[0-9a-fA-F]{6}$/.test(v))
            return fail();
        }
        if (k === "fontSize" && (typeof v !== "number" || !Number.isFinite(v) || v < 12 || v > 72))
          return fail();
        if ((k === "bold" || k === "italic") && typeof v !== "boolean")
          return fail();
        if (k === "textAlign" && !["left", "center", "right"].includes(v))
          return fail();
        if (k === "verticalAlign" && !["top", "middle", "bottom"].includes(v))
          return fail();
        next[k] = v;
      }
      if (Object.keys(next).length) styles[key] = next;
    }
  }
  const sizes = (input, ids) => {
    if (input === void 0) return void 0;
    if (!input || typeof input !== "object" || Array.isArray(input))
      return fail();
    const result = {};
    for (const [id, v] of Object.entries(input)) {
      if (!ids.includes(id) || typeof v !== "number" || !Number.isFinite(v) || v < 0.25 || v > 8)
        return fail();
      result[id] = v;
    }
    return Object.keys(result).length ? result : void 0;
  };
  const widths = sizes(t.widths, columns), heights = sizes(t.heights, rows);
  return {
    rows,
    columns,
    cells,
    header: t.header,
    ...Object.keys(styles).length ? { styles } : {},
    ...widths ? { widths } : {},
    ...heights ? { heights } : {}
  };
}

// src/model.ts
var MAX_SLIDES = 1e3;
var MAX_FILE_BYTES = 25e6;
var W = 960;
var H = 540;
function parseDeck(input) {
  if (input.length > MAX_FILE_BYTES)
    throw new Error("\u30D5\u30A1\u30A4\u30EB\u304C\u5927\u304D\u3059\u304E\u307E\u3059\uFF0825MB\u307E\u3067\uFF09\u3002");
  const d = JSON.parse(input);
  const fail = () => {
    throw new Error("\u5BFE\u5FDC\u3059\u308BVHSlide\u30D5\u30A1\u30A4\u30EB\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002");
  };
  const str2 = (v, limit = 1e4) => typeof v === "string" && v.length <= limit ? v : fail();
  const num = (v, min, max) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : fail();
  const bool = (v) => typeof v === "boolean" ? v : fail();
  const color = (v) => /^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : fail();
  if (d?.version !== 1 || !Array.isArray(d.slides) || !d.slides.length || d.slides.length > MAX_SLIDES)
    fail();
  let sheets;
  if (d.sheets !== void 0) {
    if (!Array.isArray(d.sheets) || !d.sheets.length || d.sheets.length > 50)
      fail();
    const seen = /* @__PURE__ */ new Set();
    sheets = d.sheets.map((sheet) => {
      const sheetId = str2(sheet?.id, 100), name = str2(sheet?.name, 80);
      if (!sheetId || !name.trim() || seen.has(sheetId)) fail();
      seen.add(sheetId);
      const labels = (value) => {
        if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 100)
          fail();
        const result2 = {};
        for (const [key, text] of Object.entries(
          value
        )) {
          if (!/^(0|[1-9][0-9]?)$/.test(key)) fail();
          result2[key] = str2(text, 80);
        }
        return result2;
      };
      const identities = (value) => {
        const result2 = labels(value);
        const seen2 = /* @__PURE__ */ new Set();
        for (let i = 0; i < 100; i++) {
          const value2 = result2[String(i)] ?? String(i);
          if (!value2 || seen2.has(value2)) fail();
          seen2.add(value2);
        }
        return result2;
      };
      return {
        id: sheetId,
        name,
        ...sheet.rowIds === void 0 ? {} : { rowIds: identities(sheet.rowIds) },
        ...sheet.columnIds === void 0 ? {} : { columnIds: identities(sheet.columnIds) },
        ...sheet.rowLabels === void 0 ? {} : { rowLabels: labels(sheet.rowLabels) },
        ...sheet.columnLabels === void 0 ? {} : { columnLabels: labels(sheet.columnLabels) },
        ...sheet.showRowAccounts === void 0 ? {} : { showRowAccounts: bool(sheet.showRowAccounts) }
      };
    });
  }
  const ids = /* @__PURE__ */ new Set(), cells = /* @__PURE__ */ new Set();
  const id = (v) => {
    const value = str2(v, 100);
    if (!value || ids.has(value)) fail();
    ids.add(value);
    return value;
  };
  const slides = d.slides.map((s) => {
    if (!s || !Array.isArray(s.elements) || s.elements.length > 200) fail();
    const x = num(s.x, 0, 99), y = num(s.y, 0, 99), sheetId = s.sheetId === void 0 ? "main" : str2(s.sheetId, 100), cell = `${sheetId}:${x},${y}`;
    if (sheets ? !sheets.some((sheet) => sheet.id === sheetId) : sheetId !== "main")
      fail();
    if (!Number.isInteger(x) || !Number.isInteger(y) || cells.has(cell)) fail();
    cells.add(cell);
    return {
      id: id(s.id),
      ...s.sheetId === void 0 ? {} : { sheetId },
      x,
      y,
      title: str2(s.title, 200),
      ...s.footerLabel === void 0 ? {} : { footerLabel: str2(s.footerLabel, 80) },
      ...s.speakerNotes === void 0 ? {} : { speakerNotes: str2(s.speakerNotes, 1e4) },
      background: color(s.background),
      elements: s.elements.map((e) => {
        if (!e || !["text", "image", "shape", "table", "line", "chart"].includes(e.type))
          return fail();
        const base = {
          id: id(e.id),
          type: e.type,
          x: num(e.x, 0, W),
          y: num(e.y, 0, H),
          w: num(e.w, 20, W),
          h: num(e.h, 20, H)
        };
        if (e.worksheetResult !== void 0) {
          const b = e.worksheetResult;
          if (e.type !== "chart" || !b || typeof b.deckId !== "string" || typeof b.worksheetId !== "string" || !/^[a-f0-9-]{36}$/.test(b.deckId) || !/^[a-f0-9-]{36}$/.test(b.worksheetId) || typeof b.fieldId !== "string" || !/^[a-zA-Z0-9_-]{1,60}$/.test(b.fieldId) || e.surveyResult !== void 0)
            fail();
          base.worksheetResult = {
            deckId: b.deckId,
            worksheetId: b.worksheetId,
            fieldId: b.fieldId
          };
        }
        if (base.x + base.w > W + 0.1 || base.y + base.h > H + 0.1) fail();
        if (e.responseField !== void 0) {
          if (e.type !== "shape" || e.survey !== void 0 || e.worksheet !== void 0 || e.surveyResult !== void 0 || e.webbing !== void 0)
            fail();
          base.responseField = parseResponseField(e.responseField);
        }
        if (e.webbing !== void 0) {
          if (e.type !== "shape" || e.survey !== void 0 || e.worksheet !== void 0 || e.surveyResult !== void 0 || e.responseField !== void 0)
            fail();
          base.webbing = parseWebbingBinding(e.webbing);
        }
        if (e.surveyResult !== void 0) {
          const binding = parseSurveyResultBinding(e.surveyResult);
          if (e.worksheet !== void 0 || e.survey !== void 0 || (binding.part === "chart" ? e.type !== "chart" : e.type !== "text"))
            fail();
          base.surveyResult = binding;
        }
        if (e.formFontSize !== void 0) {
          if (e.worksheet === void 0 && e.survey === void 0) fail();
          base.formFontSize = num(e.formFontSize, 12, 60);
        }
        if (e.worksheet !== void 0) {
          if (e.type !== "shape" || e.survey !== void 0 || e.webbing !== void 0)
            fail();
          base.worksheet = parseWorksheetBinding(e.worksheet);
        }
        if (e.survey !== void 0) {
          if (e.type !== "shape" || e.webbing !== void 0) fail();
          base.survey = parseSurveyBinding(e.survey);
        }
        if (e.rotation !== void 0)
          base.rotation = [0, 90, 180, 270].includes(e.rotation) ? e.rotation : fail();
        for (const key of ["flipX", "flipY", "aspectLocked"])
          if (e[key] !== void 0) base[key] = bool(e[key]);
        if (e.opacity !== void 0) base.opacity = num(e.opacity, 0, 1);
        if (e.groupId !== void 0) {
          base.groupId = str2(e.groupId, 100);
          if (!base.groupId) fail();
        }
        if (e.link !== void 0) {
          if (!e.link || typeof e.link !== "object" || Object.keys(e.link).some((k) => k !== "slideId" && k !== "url"))
            fail();
          if (e.link.slideId !== void 0 === (e.link.url !== void 0))
            fail();
          if (e.link.url !== void 0)
            base.link = { url: webLink(str2(e.link.url, 2048)) };
          else {
            const slideId = str2(e.link.slideId, 100);
            if (!slideId) fail();
            base.link = { slideId };
          }
        }
        if (e.type === "chart") return { ...base, chart: parseChart(e.chart) };
        if (e.type === "text")
          return {
            ...base,
            text: str2(e.text),
            ...e.writingMode === void 0 ? {} : {
              writingMode: ["horizontal-tb", "vertical-rl"].includes(
                e.writingMode
              ) ? e.writingMode : fail()
            },
            ...e.richText === void 0 ? {} : { richText: parseRichText(e.richText, str2(e.text)) },
            fontSize: num(e.fontSize, 12, 120),
            ...e.bold === void 0 ? {} : { bold: bool(e.bold) },
            ...e.bullets === void 0 ? {} : { bullets: bool(e.bullets) },
            ...e.textAlign === void 0 ? {} : {
              textAlign: ["left", "center", "right"].includes(e.textAlign) ? e.textAlign : fail()
            },
            ...e.verticalAlign === void 0 ? {} : {
              verticalAlign: ["top", "middle", "bottom"].includes(
                e.verticalAlign
              ) ? e.verticalAlign : fail()
            },
            color: color(e.color),
            highlight: e.highlight === void 0 ? void 0 : color(e.highlight)
          };
        if (e.type === "table")
          return {
            ...base,
            table: parseTable(e.table),
            fontSize: num(e.fontSize, 12, 72),
            color: color(e.color),
            fill: color(e.fill),
            stroke: color(e.stroke),
            textAlign: e.textAlign === void 0 ? "left" : ["left", "center", "right"].includes(e.textAlign) ? e.textAlign : fail()
          };
        if (e.type === "image") {
          const src = str2(e.src, 12e6);
          if (!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(
            src
          ) && !/^\/api\/decks\/[a-f0-9-]{36}\/assets\/[a-f0-9-]{36}$/.test(src))
            fail();
          return {
            ...base,
            src,
            ...e.drawing === void 0 ? {} : {
              drawing: (() => {
                if (!Array.isArray(e.drawing) || e.drawing.length > 1e3)
                  fail();
                let total = 0;
                return e.drawing.map((s2) => {
                  if (!s2 || !Array.isArray(s2.points) || !s2.points.length || (total += s2.points.length) > 5e4)
                    fail();
                  return {
                    points: s2.points.map((p) => ({
                      x: num(p.x, 0, 960),
                      y: num(p.y, 0, 540)
                    })),
                    ...s2.fillContours === void 0 ? {} : {
                      fillContours: (() => {
                        if (!Array.isArray(s2.fillContours) || !s2.fillContours.length || s2.fillContours.length > 1e4)
                          fail();
                        return s2.fillContours.map((c) => {
                          if (!Array.isArray(c) || c.length < 3 || (total += c.length) > 5e4)
                            fail();
                          return c.map((p) => ({
                            x: num(p.x, 0, 960),
                            y: num(p.y, 0, 540)
                          }));
                        });
                      })()
                    },
                    ...s2.erase === void 0 ? {} : {
                      erase: typeof s2.erase === "boolean" && !(s2.erase && s2.fillContours) ? s2.erase : fail()
                    },
                    ...s2.shape === void 0 ? {} : {
                      shape: ["line", "rectangle", "ellipse"].includes(
                        s2.shape
                      ) && !s2.erase && !s2.fillContours ? s2.shape : fail()
                    },
                    ...s2.fill === void 0 ? {} : {
                      fill: !s2.erase && !s2.fillContours ? s2.fill === "none" ? "none" : color(s2.fill) : fail()
                    },
                    ...s2.dash === void 0 ? {} : {
                      dash: ["solid", "dash", "dot"].includes(s2.dash) && !s2.erase && !s2.fillContours ? s2.dash : fail()
                    },
                    color: color(s2.color),
                    width: num(s2.width, 1, s2.erase ? 100 : 30)
                  };
                });
              })(),
              ...e.drawingTool === void 0 ? {} : {
                drawingTool: [
                  "select",
                  "pen",
                  "fill",
                  "eraser",
                  "line",
                  "rectangle",
                  "ellipse"
                ].includes(e.drawingTool) ? e.drawingTool : fail()
              },
              ...e.eraserWidth === void 0 ? {} : { eraserWidth: num(e.eraserWidth, 1, 100) },
              ...e.inkShapeFill === void 0 ? {} : {
                inkShapeFill: e.inkShapeFill === "none" ? "none" : color(e.inkShapeFill)
              },
              ...e.inkShapeDash === void 0 ? {} : {
                inkShapeDash: ["solid", "dash", "dot"].includes(
                  e.inkShapeDash
                ) ? e.inkShapeDash : fail()
              },
              stroke: e.stroke === void 0 ? "#173d38" : color(e.stroke),
              strokeWidth: e.strokeWidth === void 0 ? 5 : num(e.strokeWidth, 1, 30)
            },
            ...e.crop === void 0 ? {} : { crop: parseCrop(e.crop) },
            ...e.altText === void 0 ? {} : { altText: str2(e.altText, 500) }
          };
        }
        const lineStyle = {
          ...e.strokeWidth === void 0 ? {} : { strokeWidth: num(e.strokeWidth, 0, 20) },
          ...e.strokeDash === void 0 ? {} : {
            strokeDash: ["solid", "dash", "dot"].includes(e.strokeDash) ? e.strokeDash : fail()
          }
        };
        if (e.type === "line") {
          if (e.rotation !== void 0 && e.rotation !== 0 || e.flipX === true || e.flipY === true)
            fail();
          const points = {};
          for (const key of ["lineStart", "lineEnd"])
            if (e[key] !== void 0)
              points[key] = {
                x: num(e[key]?.x, 0, 100),
                y: num(e[key]?.y, 0, 100)
              };
          return {
            ...base,
            ...lineStyle,
            ...points,
            ...e.startAnchor === void 0 ? {} : { startAnchor: parseAnchor(e.startAnchor) },
            ...e.endAnchor === void 0 ? {} : { endAnchor: parseAnchor(e.endAnchor) },
            stroke: color(e.stroke),
            ...e.lineKind === void 0 ? {} : {
              lineKind: ["straight", "elbow", "curve"].includes(e.lineKind) ? e.lineKind : fail()
            },
            ...e.startArrow === void 0 ? {} : {
              startArrow: ["none", "triangle", "circle"].includes(
                e.startArrow
              ) ? e.startArrow : fail()
            },
            ...e.endArrow === void 0 ? {} : {
              endArrow: ["none", "triangle", "circle"].includes(e.endArrow) ? e.endArrow : fail()
            }
          };
        }
        if (!shapeIds.includes(e.shape)) fail();
        return {
          ...base,
          shape: e.shape,
          fill: e.fill === "none" ? "none" : color(e.fill),
          stroke: color(e.stroke),
          ...lineStyle,
          ...e.text === void 0 ? {} : {
            text: str2(e.text),
            ...e.richText === void 0 ? {} : { richText: parseRichText(e.richText, str2(e.text)) },
            ...e.bullets === void 0 ? {} : { bullets: bool(e.bullets) },
            ...e.highlight === void 0 ? {} : { highlight: color(e.highlight) },
            fontSize: num(e.fontSize ?? 24, 12, 120),
            color: color(e.color ?? "#173d38"),
            ...e.bold === void 0 ? {} : { bold: bool(e.bold) },
            textAlign: e.textAlign === void 0 ? "center" : ["left", "center", "right"].includes(e.textAlign) ? e.textAlign : fail(),
            verticalAlign: e.verticalAlign === void 0 ? "middle" : ["top", "middle", "bottom"].includes(e.verticalAlign) ? e.verticalAlign : fail()
          }
        };
      })
    };
  });
  for (const slide of slides)
    for (const e of slide.elements)
      for (const key of ["startAnchor", "endAnchor"]) {
        const a = e[key];
        if (a) {
          const target = slide.elements.find((t) => t.id === a.elementId);
          if (target?.type === "line" || a.elementId === e.id) fail();
        }
      }
  for (const sheet of sheets ?? [{ id: "main" }])
    if (!cells.has(`${sheet.id}:0,0`)) fail();
  const result = { version: 1, title: str2(d.title, 200), slides };
  if (d.guestPageCreation !== void 0)
    result.guestPageCreation = ["none", "append", "insert"].includes(
      d.guestPageCreation
    ) ? d.guestPageCreation : fail();
  if (d.restrictGuests !== void 0)
    result.restrictGuests = bool(d.restrictGuests);
  if (d.routes !== void 0) {
    if (!Array.isArray(d.routes) || d.routes.length > 30) fail();
    const ids2 = /* @__PURE__ */ new Set();
    result.routes = d.routes.map((r) => {
      const id2 = str2(r?.id, 100), name = str2(r?.name, 80);
      if (!id2 || !name.trim() || ids2.has(id2) || !Array.isArray(r.slides) || r.slides.length > 1e3)
        fail();
      ids2.add(id2);
      return { id: id2, name, slides: r.slides.map((id3) => str2(id3, 100)) };
    });
  }
  if (sheets) result.sheets = sheets;
  if (d.activeSheetId !== void 0) {
    const active = str2(d.activeSheetId, 100);
    if ((sheets ?? [{ id: "main" }]).some((sheet) => sheet.id === active))
      result.activeSheetId = active;
  }
  if (d.linkedRows !== void 0) result.linkedRows = bool(d.linkedRows);
  if (d.rowSelections !== void 0) {
    if (!Array.isArray(d.rowSelections) || d.rowSelections.length > MAX_SLIDES || !d.rowSelections.every(
      (id2) => typeof id2 === "string" && id2.length <= 100
    ))
      fail();
    const seenRows = /* @__PURE__ */ new Set();
    result.rowSelections = d.rowSelections.filter((id2) => {
      const page = slides.find((s) => s.id === id2);
      if (!page || seenRows.has(`${page.sheetId ?? "main"}:${page.y}`))
        return false;
      seenRows.add(`${page.sheetId ?? "main"}:${page.y}`);
      return true;
    });
  }
  return result;
}

// src/formAdoption.ts
var keyOf = (deckId, id) => `${deckId}:${id}`;
function collectForeignForms(deck, ownerDeckId) {
  const embedded = /* @__PURE__ */ new Map();
  const fieldsByKey = /* @__PURE__ */ new Map();
  const surveys = /* @__PURE__ */ new Map();
  const order = [];
  const noteSurvey = (binding) => {
    if (binding.deckId === ownerDeckId) return;
    const key = keyOf(binding.deckId, binding.surveyId);
    if (!surveys.has(key)) {
      surveys.set(key, {
        key,
        sourceDeckId: binding.deckId,
        sourceId: binding.surveyId,
        question: binding.question,
        kind: binding.kind,
        options: [...binding.options]
      });
      order.push(key);
    }
  };
  for (const slide of deck.slides)
    for (const element of slide.elements) {
      if (element.worksheet && element.worksheet.deckId !== ownerDeckId) {
        const binding = element.worksheet;
        const key = keyOf(binding.deckId, binding.worksheetId);
        if (!embedded.has(key)) {
          embedded.set(key, {
            title: binding.title,
            description: binding.description,
            fields: binding.fields,
            ...binding.sections ? { sections: binding.sections } : {},
            ...binding.fontSize !== void 0 ? { fontSize: binding.fontSize } : {},
            ...binding.modalLayout !== void 0 ? { modalLayout: binding.modalLayout } : {}
          });
          if (!fieldsByKey.has(key)) {
            fieldsByKey.set(key, {
              sourceDeckId: binding.deckId,
              sourceId: binding.worksheetId,
              fields: []
            });
            order.push(key);
          }
        }
      }
      const field = element.responseField;
      if (field?.source === "worksheet" && field.deckId !== ownerDeckId) {
        const key = keyOf(field.deckId, field.worksheetId);
        let group = fieldsByKey.get(key);
        if (!group) {
          group = {
            sourceDeckId: field.deckId,
            sourceId: field.worksheetId,
            fields: []
          };
          fieldsByKey.set(key, group);
          order.push(key);
        }
        if (!group.fields.some((f) => f.id === field.field.id))
          group.fields.push(field.field);
      } else if (field?.source === "survey") noteSurvey(field);
      if (element.survey) noteSurvey(element.survey);
    }
  const worksheets = [];
  let unnamed = 0;
  for (const key of order) {
    const group = fieldsByKey.get(key);
    if (!group) continue;
    const definition = embedded.get(key) ?? {
      title: unnamed === 0 ? "\u30EF\u30FC\u30AF\u30B7\u30FC\u30C8" : `\u30EF\u30FC\u30AF\u30B7\u30FC\u30C8${unnamed + 1}`,
      description: "",
      fields: group.fields
    };
    if (!embedded.has(key)) unnamed++;
    try {
      worksheets.push({
        key,
        sourceDeckId: group.sourceDeckId,
        sourceId: group.sourceId,
        definition: parseWorksheet(definition)
      });
    } catch {
    }
  }
  return {
    worksheets,
    surveys: order.filter((key) => surveys.has(key)).map((key) => surveys.get(key))
  };
}
export {
  collectForeignForms,
  parseDeck
};
