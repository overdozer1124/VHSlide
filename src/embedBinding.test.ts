import { describe, expect, it } from "vitest";
import {
  embedHostName,
  normalizeEmbedUrl,
  parseEmbedBinding,
} from "./embedBinding";
import { blank, parseDeck, serializeDeck, type Element } from "./model";

describe("normalizeEmbedUrl", () => {
  it("accepts http/https URLs and normalizes them", () => {
    expect(normalizeEmbedUrl(" https://example.com/app ")).toBe(
      "https://example.com/app",
    );
    expect(normalizeEmbedUrl("http://192.168.0.5:8080/")).toBe(
      "http://192.168.0.5:8080/",
    );
  });

  it("rejects non-web URLs and junk", () => {
    for (const bad of [
      "",
      "example.com",
      "javascript:alert(1)",
      "data:text/html,<p>x</p>",
      "ftp://example.com/",
      `https://example.com/${"a".repeat(2100)}`,
    ])
      expect(() => normalizeEmbedUrl(bad)).toThrow();
  });
});

describe("parseEmbedBinding", () => {
  it("keeps only the normalized URL", () => {
    expect(parseEmbedBinding({ url: "https://example.com" })).toEqual({
      url: "https://example.com/",
    });
    expect(() => parseEmbedBinding({})).toThrow();
    expect(() => parseEmbedBinding(null)).toThrow();
    expect(embedHostName("https://sub.example.com:8443/x")).toBe(
      "sub.example.com:8443",
    );
  });
});

describe("embed elements in a deck", () => {
  const embedElement = {
    id: "embed-1",
    type: "shape",
    shape: "rounded",
    x: 10,
    y: 10,
    w: 400,
    h: 300,
    fill: "#ffffff",
    stroke: "#587d59",
    color: "#173d38",
    fontSize: 20,
    text: "アプリ：example.com",
    embed: { url: "https://example.com/app" },
  } as unknown as Element;
  const deckWith = (element: Element) => {
    const slide = blank(0, 0);
    slide.elements = [element];
    return { version: 1, title: "授業", slides: [slide] };
  };

  it("survives a serialize/parse round trip", () => {
    const parsed = parseDeck(
      serializeDeck(deckWith(embedElement) as never),
    );
    expect(parsed.slides[0].elements[0].embed).toEqual({
      url: "https://example.com/app",
    });
  });

  it("rejects an element that also carries another binding", () => {
    const element = {
      ...embedElement,
      survey: {
        deckId: "123e4567-e89b-42d3-a456-426614174000",
        surveyId: "123e4567-e89b-42d3-a456-426614174001",
        question: "質問",
        kind: "text",
        options: [],
      },
    } as unknown as Element;
    expect(() =>
      parseDeck(JSON.stringify(deckWith(element))),
    ).toThrow();
  });

  it("rejects a dangerous embed URL inside a deck", () => {
    const element = {
      ...embedElement,
      embed: { url: "javascript:alert(1)" },
    } as unknown as Element;
    expect(() =>
      parseDeck(JSON.stringify(deckWith(element))),
    ).toThrow();
  });
});
