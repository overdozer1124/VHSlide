import { expect, type Page } from "@playwright/test";
import { WebSocket } from "ws";
import * as Y from "yjs";
import type { Deck } from "../../src/model";
import {
  applyDeckChange,
  fromBase64,
  readSharedDeck,
  toBase64,
} from "../../src/sharedDeck";
import { COLLABORATION_PROTOCOL } from "../../src/collaborationProtocol";
import { scopeBook } from "./scopeBook";
export const scopeOrigin = "http://127.0.0.1:3187";
export async function scopeLogin(page: Page, name: string) {
  await page.route("https://accounts.google.com/**", (r) => r.abort());
  const credential =
    process.env.VHSLIDE_TEST_BACKEND === "cloudflare"
      ? await (await page.request.get(`/__test/token?name=${name}`)).text()
      : name;
  expect(
    (
      await page.request.post("/api/auth/google", {
        headers: { Origin: scopeOrigin },
        data: { credential },
      })
    ).status(),
  ).toBe(200);
  await page.addInitScript(() => {
    // Init scripts can run before the HTML root exists. Override the prototype
    // so this test-only denial also works during that early navigation phase.
    Element.prototype.requestFullscreen = () =>
      Promise.reject(new Error("local denial"));
  });
}
export async function scopeFixture(page: Page, name: string) {
  await scopeLogin(page, name);
  const made = await page.request.post("/api/decks", {
    headers: { Origin: scopeOrigin },
    data: scopeBook(),
  });
  expect(made.status()).toBe(201);
  const { id } = await made.json();
  await page.goto(`/?room=${id}`);
  await expect(page.locator(".cloud-presence")).toContainText(
    "クラウドに保存済み",
  );
  return id as string;
}
/** Separate authenticated host connection, on a temporary local test work only. */
export async function changeScopeBook(
  page: Page,
  id: string,
  change: (book: Deck) => Deck,
) {
  const result = await (await page.request.get(`/api/decks/${id}`)).json(),
    doc = new Y.Doc();
  Y.applyUpdate(doc, fromBase64(result.state));
  const before = readSharedDeck(doc),
    updates: Uint8Array[] = [];
  doc.on("update", (u) => updates.push(u));
  applyDeckChange(doc, before, change(structuredClone(before)));
  const cookies = (await page.context().cookies())
      .map((c) => `${c.name}=${c.value}`)
      .join("; "),
    ws = new WebSocket(`ws://127.0.0.1:3187/api/decks/${id}/live`, {
      headers: { Origin: scopeOrigin, Cookie: cookies },
    });
  try {
    await new Promise<void>((resolve, reject) => {
      ws.once("error", reject);
      ws.once("open", () => {
        ws.on("message", (data, binary) => {
          if (binary) return;
          const m = JSON.parse(data.toString());
          if (m.type === "ack") resolve();
          if (m.type === "error") reject(new Error(m.message));
        });
        ws.send(
          JSON.stringify({
            type: "update",
            protocol: COLLABORATION_PROTOCOL,
            id: crypto.randomUUID(),
            update: toBase64(Y.mergeUpdates(updates)),
          }),
        );
      });
    });
  } finally {
    ws.close();
    doc.destroy();
  }
}
