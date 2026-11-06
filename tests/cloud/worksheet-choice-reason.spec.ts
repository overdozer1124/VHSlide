import { test, expect } from "@playwright/test";
import { blank } from "../../src/model";

const headers = { Origin: "http://127.0.0.1:3187" };
test("a choice and its reason save independently and appear together in CSV", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120_000);
  const context = await browser.newContext(info.project.use);
  const guest = await context.newPage();
  try {
    for (const [p, name] of [
      [page, "reason-host"],
      [guest, "reason-guest"],
    ] as const) {
      const credential =
        process.env.VHSLIDE_TEST_BACKEND === "cloudflare"
          ? await (await p.request.get(`/__test/token?name=${name}`)).text()
          : name;
      expect(
        (
          await p.request.post("/api/auth/google", {
            headers,
            data: { credential },
          })
        ).status(),
      ).toBe(200);
    }
    const created = await page.request.post("/api/decks", {
      headers,
      data: { version: 1, title: "理由付きの選択", slides: [blank(0, 0)] },
    });
    expect(created.status()).toBe(201);
    const { id } = await created.json();
    const invite = await page.request.post(`/api/decks/${id}/invite`, {
      headers,
    });
    const token = new URL((await invite.json()).url).searchParams.get("join");
    const accepted = await guest.request.post(`/api/invites/${token}/accept`, {
      headers,
    });
    const join = await accepted.json();
    if (join.requestId)
      expect(
        (
          await page.request.post(`/api/decks/${id}/join-requests/approve`, {
            headers,
            data: { requestIds: [join.requestId] },
          })
        ).status(),
      ).toBe(200);
    await page.goto(`/?room=${id}`);
    await guest.goto(`/?room=${id}`);
    await page.locator(".thumbnail").first().click();
    await page.getByRole("button", { name: "フォーム", exact: true }).click();
    await page.getByRole("tab", { name: "回答欄を追加", exact: true }).click();
    const tools = page.getByRole("region", {
      name: "回答欄の追加",
      exact: true,
    });
    await tools
      .getByRole("textbox", { name: "新しい入力項目名" })
      .fill("どれを選びますか？");
    await tools.getByRole("button", { name: /^単一選択/ }).click();
    await tools.getByLabel("選択した理由を書く欄を追加").check();
    await tools
      .getByRole("button", { name: "スライドに追加", exact: true })
      .click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect
      .poll(
        async () =>
          (
            (
              await (
                await page.request.get(`/api/decks/${id}/worksheets`)
              ).json()
            ).worksheets ?? []
          ).length,
      )
      .toBe(1);
    const sheet = (
      await (await page.request.get(`/api/decks/${id}/worksheets`)).json()
    ).worksheets[0];
    expect(sheet.fields[0].reason).toBe(true);
    await expect(guest.locator(".slide-card")).toHaveCount(1);
    await guest.locator(".thumbnail").first().click();
    const response = guest.locator(".response-field.interactive");
    await expect(
      response.getByText("どれを選びますか？").first(),
    ).toBeVisible();
    await response.getByLabel("はい").check();
    await response.getByLabel("理由・考え").fill("選んだ理由です");
    await response.getByLabel("理由・考え").blur();
    await expect
      .poll(async () => {
        const data = await (
          await guest.request.get(`/api/decks/${id}/worksheets`)
        ).json();
        return data.worksheets[0]?.own?.values;
      })
      .toMatchObject({
        [sheet.fields[0].id]: [0],
        [`${sheet.fields[0].id}:reason`]: "選んだ理由です",
      });
    await guest.reload();
    await guest.locator(".thumbnail").first().click();
    await expect(
      guest.locator(".response-field.interactive").getByLabel("理由・考え"),
    ).toHaveValue("選んだ理由です");
    await page.getByRole("button", { name: "フォーム", exact: true }).click();
    await page.getByRole("tab", { name: "ワークシート", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("選んだ理由です");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "入力結果をCSV保存" }).click();
    const saved = await download;
    const stream = await saved.createReadStream();
    let csv = "";
    for await (const chunk of stream) csv += chunk.toString();
    expect(csv).toContain("選んだ理由です");
    expect(csv).toContain("どれを選びますか？：理由");
    await page.getByRole("tab", { name: "回答スライド", exact: true }).click();
    await expect(page.locator(".gallery-slide-choice")).toHaveCount(1);
    await page.locator(".gallery-slide-choice").first().click();
    await expect(page.locator(".gallery-card textarea")).toHaveValue(
      "選んだ理由です",
    );
    await page
      .getByRole("button", { name: "選択したスライドの回答を全員に共有" })
      .click();
    const shared = (
      await (await guest.request.get(`/api/decks/${id}/gallery`)).json()
    ).gallery;
    expect(
      shared.cards[0].worksheets[0].own.values[`${sheet.fields[0].id}:reason`],
    ).toBe("選んだ理由です");
  } finally {
    await context.close();
  }
});
