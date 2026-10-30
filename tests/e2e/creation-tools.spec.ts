import { test, expect } from "@playwright/test";
test("drawing can be edited directly and reopened after reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".thumbnail").first().click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  await page.getByRole("button", { name: "手描き", exact: true }).click();
  const svg = page.locator(".editor-workspace .ink-editing");
  await expect(svg).toBeVisible();
  const r = (await svg.boundingBox())!;
  await page.mouse.move(r.x + 30, r.y + 30);
  await page.mouse.down();
  await page.mouse.move(r.x + 150, r.y + 80, { steps: 10 });
  await page.mouse.up();
  const length = () =>
    page.evaluate(
      () =>
        JSON.parse(
          localStorage.getItem("vhslide-deck-v1")!,
        ).slides[0].elements.find((e: any) => e.drawing)?.drawing.length,
    );
  await expect.poll(length).toBe(1);
  await page.reload();
  await page.getByRole("button", { name: "ページを編集", exact: true }).click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  await page
    .locator(".editor-workspace .element")
    .filter({ has: page.locator(".ink-object") })
    .click();
  await expect(page.locator(".editor-workspace .ink-editing")).toBeVisible();
  await page
    .getByRole("button", { name: "最後の描画を消す", exact: true })
    .click();
  await expect.poll(length).toBe(0);
});
test("vertical text and web links survive editing and JSON saving", async ({
  page,
}) => {
  const book = {
    version: 1,
    title: "test",
    slides: [
      {
        id: "page",
        x: 0,
        y: 0,
        title: "page",
        background: "#ffffff",
        elements: [
          {
            id: "words",
            type: "text",
            x: 80,
            y: 80,
            w: 300,
            h: 300,
            text: "日本語の縦書き",
            fontSize: 32,
            color: "#173d38",
          },
        ],
      },
    ],
  };
  await page.addInitScript(
    (book) => localStorage.setItem("vhslide-deck-v1", JSON.stringify(book)),
    book,
  );
  await page.goto("/");
  await page.locator(".thumbnail").first().click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  await page
    .locator('.editor-workspace .element[data-element-id="words"]')
    .click();
  const details = page.locator(".whole-text-settings");
  await details.evaluate((n) => n.setAttribute("open", ""));
  await page
    .getByLabel("文字の方向", { exact: true })
    .selectOption("vertical-rl");
  await expect(page.locator(".editor-workspace .text-layout")).toHaveCSS(
    "writing-mode",
    "vertical-rl",
  );
  await expect(page.locator(".editor-workspace .text-layout")).toHaveCSS(
    "text-orientation",
    "upright",
  );
  const flow = await page
    .locator(".editor-workspace .text-layout .slide-text")
    .evaluate((node) => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const t = walker.nextNode()!;
      const a = document.createRange(),
        b = document.createRange();
      a.setStart(t, 0);
      a.setEnd(t, 1);
      b.setStart(t, 1);
      b.setEnd(t, 2);
      const r = a.getBoundingClientRect(),
        s = b.getBoundingClientRect();
      return { dx: Math.abs(s.x - r.x), dy: s.y - r.y };
    });
  expect(flow.dy).toBeGreaterThan(0);
  expect(flow.dx).toBeLessThan(2);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("vhslide-deck-v1")!).slides[0]
            .elements[0].writingMode,
      ),
    )
    .toBe("vertical-rl");
});

test("web URLs are configured on objects and executable URLs are refused", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".thumbnail").first().click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  await page.locator(".editor-workspace .element").first().click();
  await page.getByRole("tab", { name: "リンク", exact: true }).click();
  await page.getByLabel("WebページのURL").fill("javascript:alert(1)");
  await page
    .getByRole("button", { name: "URLリンクを設定", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("http://");
  await page.getByLabel("WebページのURL").fill("https://example.com/lesson");
  await page
    .getByRole("button", { name: "URLリンクを設定", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("vhslide-deck-v1")!).slides[0]
            .elements[0].link?.url,
      ),
    )
    .toBe("https://example.com/lesson");
});

test("links open on Ctrl-click in editor without a separate marker", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__opened = [];
    window.open = ((url: any) => {
      (window as any).__opened.push(url);
      return null;
    }) as any;
    const book = JSON.parse(localStorage.getItem("vhslide-deck-v1") || "null");
  });
  await page.goto("/");
  await page.locator(".thumbnail").first().click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  await page.locator(".editor-workspace .element").first().click();
  await page.getByRole("tab", { name: "リンク", exact: true }).click();
  await page.getByLabel("WebページのURL").fill("https://example.com/");
  await page
    .getByRole("button", { name: "URLリンクを設定", exact: true })
    .click();
  await expect(page.locator(".canvas-object-link")).toHaveCount(0);
  const object = page.locator(".editor-workspace .element").first();
  await object.click({ modifiers: ["Control"] });
  expect(await page.evaluate(() => (window as any).__opened)).toEqual([
    "https://example.com/",
  ]);
  await page.getByRole("button", { name: "発表する", exact: true }).click();
  await expect(page.locator(".present-mode")).toBeVisible();
  await page.locator(".present-slide .element").first().click();
  expect(await page.evaluate(() => (window as any).__opened)).toEqual([
    "https://example.com/",
    "https://example.com/",
  ]);
});

test("bucket fills regions enclosed by separate strokes and survives reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".thumbnail").first().click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  await page.getByRole("button", { name: "手描き", exact: true }).click();
  const svg = page.locator(".editor-workspace .ink-editing");
  const r = (await svg.boundingBox())!;
  const pos = (x: number, y: number) => ({
    x: r.x + r.width * x,
    y: r.y + r.height * y,
  });
  const corners = [
    [0.2, 0.2],
    [0.8, 0.2],
    [0.8, 0.8],
    [0.2, 0.8],
    [0.2, 0.2],
  ];
  for (let i = 0; i < 4; i++) {
    const a = pos(...(corners[i] as [number, number])),
      b = pos(...(corners[i + 1] as [number, number]));
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.mouse.up();
  }
  await page.getByRole("button", { name: "塗りつぶし", exact: true }).click();
  const c = pos(0.5, 0.5);
  await page.mouse.click(c.x, c.y);
  const fills = svg.locator('path[fill-rule="evenodd"]:not([fill="none"])');
  await expect(fills).toHaveCount(1);
  const bounds = await fills.first().evaluate((n) => {
    const b = (n as SVGPathElement).getBBox();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  expect(bounds.x).toBeGreaterThan(150);
  expect(bounds.w).toBeLessThan(650);
  expect(bounds.y).toBeGreaterThan(70);
  expect(bounds.h).toBeLessThan(380);
  await page.getByLabel("描画の色", { exact: true }).fill("#ff0000");
  await page.mouse.click(c.x, c.y);
  await expect(fills.last()).toHaveAttribute("fill", "#ff0000");
  await page.reload();
  await page.getByRole("button", { name: "ページを編集", exact: true }).click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  await page
    .locator(".editor-workspace .element")
    .filter({ has: page.locator(".ink-object") })
    .click();
  await expect(fills).toHaveCount(2);
  await page
    .getByRole("button", { name: "塗りつぶしを消す", exact: true })
    .click();
  await expect(fills).toHaveCount(0);
  await expect(svg.locator("path")).toHaveCount(4);
});

test("eraser removes only the traced area, persists and lets new ink cover it", async ({
  page,
  hasTouch,
}) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("vhslide-deck-v1")) return;
    localStorage.setItem(
      "vhslide-deck-v1",
      JSON.stringify({
        version: 1,
        title: "eraser",
        slides: [
          {
            id: "page",
            x: 0,
            y: 0,
            title: "ink",
            background: "#abcabc",
            elements: [
              {
                id: "ink",
                type: "image",
                x: 100,
                y: 100,
                w: 600,
                h: 337.5,
                src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
                drawing: [
                  {
                    points: [{ x: 200, y: 200 }],
                    color: "#0000ff",
                    width: 1,
                    fillContours: [
                      [
                        { x: 100, y: 100 },
                        { x: 860, y: 100 },
                        { x: 860, y: 440 },
                        { x: 100, y: 440 },
                      ],
                    ],
                  },
                  {
                    points: [
                      { x: 100, y: 270 },
                      { x: 860, y: 270 },
                    ],
                    color: "#000000",
                    width: 20,
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
  });
  await page.goto("/");
  await page.locator(".thumbnail").first().click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  await page.locator(".editor-workspace .element").first().click();
  const group = page.getByRole("group", { name: "描画ツール", exact: true });
  await expect(group.getByRole("combobox")).toHaveCount(0);
  const eraser = group.getByRole("button", { name: "消しゴム", exact: true });
  await eraser.click();
  await expect(eraser).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("消しゴムの大きさ", { exact: true }).fill("80");
  const svg = page.locator(".editor-workspace .ink-editing");
  const r = (await svg.boundingBox())!;
  if (hasTouch) {
    const cdp = await page.context().newCDPSession(page);
    const x = r.x + r.width * 0.5;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y: r.y + (r.height * 150) / 540, id: 1 }],
    });
    for (let i = 1; i <= 12; i++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { x, y: r.y + (r.height * (150 + (240 * i) / 12)) / 540, id: 1 },
        ],
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
  } else {
    await page.mouse.move(r.x + r.width * 0.5, r.y + (r.height * 150) / 540);
    await page.mouse.down();
    await page.mouse.move(r.x + r.width * 0.5, r.y + (r.height * 390) / 540, {
      steps: 12,
    });
    await page.mouse.up();
  }
  const sample = async (x: number, y: number) =>
    svg.evaluate(
      async (n, { x, y }) => {
        const copy = n.cloneNode(true) as SVGSVGElement;
        copy.setAttribute("width", "960");
        copy.setAttribute("height", "540");
        copy.querySelectorAll(".ink-eraser-cursor").forEach((c) => c.remove());
        const blob = new Blob([new XMLSerializer().serializeToString(copy)], {
          type: "image/svg+xml",
        });
        const url = URL.createObjectURL(blob),
          image = new Image();
        try {
          image.src = url;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = 960;
          canvas.height = 540;
          const c = canvas.getContext("2d")!;
          c.drawImage(image, 0, 0);
          return [...c.getImageData(x, y, 1, 1).data];
        } finally {
          URL.revokeObjectURL(url);
        }
      },
      { x, y },
    );
  await expect(svg.locator("mask")).toHaveCount(1);
  expect(await sample(480, 270)).toEqual([0, 0, 0, 0]);
  expect(await sample(400, 270)).toEqual([0, 0, 0, 255]);
  expect(await sample(400, 200)).toEqual([0, 0, 255, 255]);
  expect(await sample(480, 200)).toEqual([0, 0, 0, 0]);
  await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
  expect(await sample(480, 270)).toEqual([0, 0, 0, 255]);
  await page.getByRole("button", { name: "やり直す", exact: true }).click();
  expect(await sample(480, 270)).toEqual([0, 0, 0, 0]);
  await page.reload();
  await page.getByRole("button", { name: "ページを編集", exact: true }).click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  await page.locator(".editor-workspace .element").first().click();
  expect(await sample(480, 270)).toEqual([0, 0, 0, 0]);
  await group.getByRole("button", { name: "ペン", exact: true }).click();
  await page.getByLabel("描画の色", { exact: true }).fill("#ff0000");
  const p = (await svg.boundingBox())!;
  await page.mouse.click(p.x + p.width * 0.5, p.y + p.height * 0.5);
  expect(await sample(480, 270)).toEqual([255, 0, 0, 255]);
  await page
    .getByRole("button", { name: "最後の描画を消す", exact: true })
    .click();
  expect(await sample(480, 270)).toEqual([0, 0, 0, 0]);
  await page
    .getByRole("button", { name: "最後の描画を消す", exact: true })
    .click();
  expect(await sample(480, 270)).toEqual([0, 0, 0, 255]);
});

test("ink geometry previews, fills, erases and reloads within one drawing object", async ({
  page,
  hasTouch,
}) => {
  await page.goto("/");
  await page.locator(".thumbnail").first().click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  await page.getByRole("button", { name: "手描き", exact: true }).click();
  const svg = page.locator(".editor-workspace .ink-editing");
  const group = page.getByRole("group", { name: "描画ツール", exact: true });
  const r = (await svg.boundingBox())!;
  const drag = async (
    name: string,
    a: number[],
    b: number[],
    count: number,
    cancel = false,
  ) => {
    await group.getByRole("button", { name, exact: true }).click();
    const x = r.x + r.width * a[0],
      y = r.y + r.height * a[1],
      ex = r.x + r.width * b[0],
      ey = r.y + r.height * b[1];
    if (hasTouch) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y, id: 1 }],
      });
      for (let i = 1; i <= 5; i++)
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [
            { x: x + ((ex - x) * i) / 5, y: y + ((ey - y) * i) / 5, id: 1 },
          ],
        });
      await expect(svg.locator("[data-ink-paint]")).toHaveCount(count + 1);
      await cdp.send("Input.dispatchTouchEvent", {
        type: cancel ? "touchCancel" : "touchEnd",
        touchPoints: [],
      });
      await cdp.detach();
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(ex, ey, { steps: 5 });
      await expect(svg.locator("[data-ink-paint]")).toHaveCount(count + 1);
      if (cancel) await svg.dispatchEvent("pointercancel");
      await page.mouse.up();
    }
    await expect(svg.locator("[data-ink-paint]")).toHaveCount(
      cancel ? count : count + 1,
    );
  };
  await drag("直線", [0.1, 0.1], [0.9, 0.2], 0);
  await drag("四角形", [0.1, 0.35], [0.45, 0.9], 1);
  await drag("楕円", [0.55, 0.35], [0.9, 0.9], 2);
  await drag("直線", [0.1, 0.25], [0.9, 0.3], 3, true);
  await group.getByRole("button", { name: "塗りつぶし", exact: true }).click();
  await svg.click({ position: { x: r.width * 0.25, y: r.height * 0.6 } });
  await expect(svg.locator("[data-ink-paint]")).toHaveCount(4);
  await group.getByRole("button", { name: "消しゴム", exact: true }).click();
  await svg.click({ position: { x: r.width * 0.25, y: r.height * 0.6 } });
  await expect(svg.locator("mask")).toHaveCount(1);
  await page.reload();
  await page.getByRole("button", { name: "ページを編集", exact: true }).click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  await page
    .locator(".editor-workspace .element")
    .filter({ has: page.locator(".ink-object") })
    .click();
  await expect(svg.locator("[data-ink-paint]")).toHaveCount(4);
  await expect(svg.locator("mask")).toHaveCount(1);
  const data = await page.evaluate(() =>
    JSON.parse(
      localStorage.getItem("vhslide-deck-v1")!,
    ).slides[0].elements.filter((e: any) => e.drawing),
  );
  expect(data).toHaveLength(1);
  expect(data[0].drawing[0].points).toHaveLength(2);
  expect(data[0].drawing[1].points).toHaveLength(5);
  expect(data[0].drawing[2].points).toHaveLength(65);
});

test("ink shapes keep independent fill and stroke styles and can be restyled", async ({
  page,
  hasTouch,
}) => {
  await page.goto("/");
  await page.locator(".thumbnail").first().click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  await page.getByRole("button", { name: "手描き", exact: true }).click();
  const tool = page.getByRole("group", { name: "描画ツール", exact: true });
  await tool.getByRole("button", { name: "四角形", exact: true }).click();
  await page.getByLabel("線の色", { exact: true }).fill("#ff0000");
  await page.getByLabel("線の太さ", { exact: true }).fill("8");
  await page
    .getByRole("group", { name: "線の種類" })
    .getByRole("button", { name: "破線", exact: true })
    .click();
  await page.getByLabel("図形を塗りつぶす", { exact: true }).check();
  await page.getByLabel("図形の塗り色", { exact: true }).fill("#0000ff");
  const svg = page.locator(".editor-workspace .ink-editing");
  const r = (await svg.boundingBox())!;
  const draw = async () => {
    if (hasTouch) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [
          { x: r.x + r.width * 0.2, y: r.y + r.height * 0.2, id: 1 },
        ],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { x: r.x + r.width * 0.8, y: r.y + r.height * 0.8, id: 1 },
        ],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await cdp.detach();
    } else {
      await page.mouse.move(r.x + r.width * 0.2, r.y + r.height * 0.2);
      await page.mouse.down();
      await page.mouse.move(r.x + r.width * 0.8, r.y + r.height * 0.8, {
        steps: 5,
      });
      await page.mouse.up();
    }
  };
  await draw();
  const path = svg.locator("[data-ink-paint]").first();
  await expect(path).toHaveAttribute("fill", "#0000ff");
  await expect(path).toHaveAttribute("stroke", "#ff0000");
  await expect(path).toHaveAttribute("stroke-width", "8");
  await expect(path).toHaveAttribute("stroke-dasharray", "32 24");
  await tool.getByRole("button", { name: "図形を選択", exact: true }).click();
  if (hasTouch)
    await svg.tap({ position: { x: r.width * 0.5, y: r.height * 0.5 } });
  else await svg.click({ position: { x: r.width * 0.5, y: r.height * 0.5 } });
  await expect(svg.locator(".ink-shape-selection")).toBeVisible();
  await page.getByLabel("線の色", { exact: true }).fill("#008800");
  await page.getByLabel("線の太さ", { exact: true }).fill("12");
  await page
    .getByRole("group", { name: "線の種類" })
    .getByRole("button", { name: "点線", exact: true })
    .click();
  await page.getByLabel("図形の塗り色", { exact: true }).fill("#ffff00");
  await expect(path).toHaveAttribute("stroke", "#008800");
  await expect(path).toHaveAttribute("stroke-width", "12");
  await expect(path).toHaveAttribute("stroke-dasharray", "0.01 30");
  await expect(path).toHaveAttribute("fill", "#ffff00");
  await page.getByLabel("図形を塗りつぶす", { exact: true }).uncheck();
  await expect(path).toHaveAttribute("fill", "none");
  await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
  await expect(path).toHaveAttribute("fill", "#ffff00");
  await tool.getByRole("button", { name: "楕円", exact: true }).click();
  await draw();
  await expect(svg.locator("[data-ink-paint]").nth(1)).toHaveAttribute(
    "fill",
    "#0000ff",
  );
  await expect(svg.locator("[data-ink-paint]").nth(1)).toHaveAttribute(
    "stroke",
    "#ff0000",
  );
  await page.reload();
  await page.getByRole("button", { name: "ページを編集", exact: true }).click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  await page
    .locator(".editor-workspace .element")
    .filter({ has: page.locator(".ink-object") })
    .click();
  await expect(path).toHaveAttribute("fill", "#ffff00");
  await expect(path).toHaveAttribute("stroke-dasharray", "0.01 30");
  await expect(svg.locator("[data-ink-paint]").nth(1)).toHaveAttribute(
    "fill",
    "#0000ff",
  );
});

test("old unfilled ink rectangles can be selected by their interior and restyled", async ({
  page,
  hasTouch,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "vhslide-deck-v1",
      JSON.stringify({
        version: 1,
        title: "legacy",
        slides: [
          {
            id: "page",
            x: 0,
            y: 0,
            title: "legacy",
            background: "#ffffff",
            elements: [
              {
                id: "legacy-ink",
                type: "image",
                x: 100,
                y: 100,
                w: 480,
                h: 270,
                src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
                drawing: [
                  {
                    points: [
                      { x: 100, y: 100 },
                      { x: 800, y: 100 },
                      { x: 800, y: 400 },
                      { x: 100, y: 400 },
                      { x: 100, y: 100 },
                    ],
                    width: 5,
                    color: "#173d38",
                  },
                ],
              },
            ],
          },
        ],
      }),
    ),
  );
  await page.goto("/");
  await page.locator(".thumbnail").first().click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  await page.locator(".editor-workspace .element").first().click();
  await page
    .getByRole("group", { name: "描画ツール", exact: true })
    .getByRole("button", { name: "図形を選択", exact: true })
    .click();
  const svg = page.locator(".editor-workspace .ink-editing"),
    r = (await svg.boundingBox())!;
  if (hasTouch)
    await svg.tap({ position: { x: r.width * 0.5, y: r.height * 0.5 } });
  else await svg.click({ position: { x: r.width * 0.5, y: r.height * 0.5 } });
  await expect(svg.locator(".ink-shape-selection")).toBeVisible();
  await page.getByLabel("図形を塗りつぶす", { exact: true }).check();
  await page.getByLabel("図形の塗り色", { exact: true }).fill("#ff00ff");
  await expect(svg.locator("[data-ink-paint]")).toHaveCount(1);
  await expect(svg.locator("[data-ink-paint]")).toHaveAttribute(
    "fill",
    "#ff00ff",
  );
});
