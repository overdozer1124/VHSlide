import { test, expect, type Page } from "@playwright/test";
import { WebSocket } from "ws";
import * as Y from "yjs";
import { sample, blank } from "../../src/model";
import { defaultAccess } from "../../src/permissions";
import {
  applyDeckChange,
  fromBase64,
  readSharedDeck,
  toBase64,
} from "../../src/sharedDeck";
import { COLLABORATION_PROTOCOL } from "../../src/collaborationProtocol";
const origin = "http://127.0.0.1:3187";
async function login(page: Page, name: string) {
  await page.route("https://accounts.google.com/**", (r) => r.abort());
  const credential =
    process.env.VHSLIDE_TEST_BACKEND === "cloudflare"
      ? await (await page.request.get(`/__test/token?name=${name}`)).text()
      : name;
  expect(
    (
      await page.request.post("/api/auth/google", {
        headers: { Origin: origin },
        data: { credential },
      })
    ).status(),
  ).toBe(200);
}
async function create(page: Page) {
  const r = await page.request.post("/api/decks", {
    headers: { Origin: origin },
    data: sample(),
  });
  expect(r.status()).toBe(201);
  return (await r.json()).id as string;
}
async function serverTitle(page: Page, id: string) {
  return (await (await page.request.get(`/api/decks/${id}/backup`)).json()).deck
    .title;
}
const jsonInput = (page: Page) =>
  page.locator('input[type=file][accept=".json,application/json"]');
const importFile = {
  name: "local.json",
  mimeType: "application/json",
  buffer: Buffer.from(
    JSON.stringify({ ...sample(), title: "読み込む端末の作品" }),
  ),
};

test("uncreated assigned rows are preparation, become ready on a live page addition, and never create pages implicitly", async ({
  page,
  browser,
}, info) => {
  await login(page, `${info.project.name}-readiness-host`);
  const id = await create(page),
    guest = `${info.project.name}-readiness-student`;
  const access = {
    ...defaultAccess(),
    mode: "scoped",
    rows: [{ sheetId: "main", index: 9 }],
  };
  expect(
    (
      await page.request.post(`/api/decks/${id}/recipients`, {
        headers: { Origin: origin },
        data: { recipients: [{ email: `${guest}@example.test`, access }] },
      })
    ).status(),
  ).toBe(200);
  await page.goto(`/?room=${id}`);
  await expect(page.locator(".cloud-presence")).toContainText(
    "クラウドに保存済み",
  );
  await page.getByRole("button", { name: "クラウド", exact: true }).click();
  await expect(
    page
      .locator(".sharing-person")
      .filter({ hasText: `${guest}@example.test` }),
  ).toContainText("担当ページの準備待ち");
  const count = (
    await (await page.request.get(`/api/decks/${id}/backup`)).json()
  ).deck.slides.length;
  expect(count).toBe(5);
  const context = await browser.newContext({
      baseURL: origin,
      viewport: { width: 1366, height: 768 },
    }),
    student = await context.newPage();
  try {
    await login(student, guest);
    await student.goto(`/?room=${id}`);
    await expect(student.locator(".cloud-presence")).toContainText(
      "担当ページの準備待ち",
    );
    await student
      .getByRole("button", { name: "マップをフィルタ", exact: true })
      .click();
    const filter = student.getByRole("region", {
      name: "マップのフィルタ設定",
      exact: true,
    });
    await expect(filter).toContainText("10行目");
    await expect(
      filter.getByRole("button", {
        name: "自分の担当を選択（0枚）",
        exact: true,
      }),
    ).toBeDisabled();
    await student.screenshot({
      path: info.outputPath("assignment-preparation.png"),
    });
    const state = await (await page.request.get(`/api/decks/${id}`)).json(),
      doc = new Y.Doc();
    Y.applyUpdate(doc, fromBase64(state.state));
    const before = readSharedDeck(doc);
    let update!: Uint8Array;
    doc.on("update", (u) => (update = u));
    applyDeckChange(doc, before, {
      ...before,
      slides: [...before.slides, blank(0, 9)],
    });
    const cookies = (await page.context().cookies())
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
    const ws = new WebSocket(`ws://127.0.0.1:3187/api/decks/${id}/live`, {
      headers: { Origin: origin, Cookie: cookies },
    });
    try {
      await new Promise<void>((resolve, reject) => {
        ws.once("error", reject);
        ws.once("open", () => {
          ws.on("message", (m, binary) => {
            if (!binary && JSON.parse(m.toString()).type === "ack") resolve();
          });
          ws.send(
            JSON.stringify({
              type: "update",
              id: crypto.randomUUID(),
              protocol: COLLABORATION_PROTOCOL,
              update: toBase64(update),
            }),
          );
        });
      });
      await expect(
        filter.getByRole("button", {
          name: "自分の担当を選択（1枚）",
          exact: true,
        }),
      ).toBeEnabled();
      await expect(filter).not.toContainText("担当ページの準備待ち");
    } finally {
      ws.close();
      doc.destroy();
    }
  } finally {
    await context.close();
  }
});

test("JSON import preserves the cloud source and refuses to detach with unsent changes", async ({
  page,
}, info) => {
  let block = false,
    held: ((message: string | Buffer) => void) | undefined,
    pending: (string | Buffer)[] = [];
  await page.routeWebSocket("**/live", (ws) => {
    const server = ws.connectToServer();
    held = (message) => server.send(message);
    ws.onMessage((message) => {
      if (block) pending.push(message);
      else server.send(message);
    });
  });
  await login(page, `${info.project.name}-json-open`);
  const id = await create(page);
  await page.goto(`/?room=${id}`);
  await expect(page.locator(".cloud-presence")).toContainText(
    "クラウドに保存済み",
  );
  const url = page.url();
  block = true;
  await page.locator(".deck-title").fill("未送信のクラウド作品");
  await expect.poll(() => pending.length).toBeGreaterThan(0);
  await jsonInput(page).setInputFiles(importFile);
  await expect(page.locator(".toast")).toContainText("未保存の変更や付箋");
  expect(page.url()).toBe(url);
  await expect(page.locator(".deck-title")).toHaveValue("未送信のクラウド作品");
  block = false;
  for (const message of pending) held!(message);
  pending = [];
  await expect.poll(() => serverTitle(page, id)).toBe("未送信のクラウド作品");
  await expect(page.locator(".cloud-presence")).toContainText(
    "クラウドに保存済み",
  );
  await jsonInput(page).setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from("broken"),
  });
  expect(page.url()).toBe(url);
  await jsonInput(page).setInputFiles(importFile);
  await expect(page.locator(".deck-title")).toHaveValue("読み込む端末の作品");
  await expect(page.locator(".cloud-presence")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "もとに戻す", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".toast")).not.toContainText("もとに戻す");
  await page.screenshot({ path: info.outputPath("json-source-notice.png") });
  await page
    .getByRole("button", { name: "作品一覧を開く", exact: true })
    .click();
  await expect(page.getByRole("tab", { name: /作品一覧/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page
    .getByRole("button", {
      name: "作品を開く：未送信のクラウド作品",
      exact: true,
    })
    .click();
  await expect(page.locator(".deck-title")).toHaveValue("未送信のクラウド作品");
  expect(page.url()).toBe(url);
});
