# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: collaboration.spec.ts >> pasted accounts receive ordered rows before joining, open without an invite, and retain assignments through invite entry
- Location: tests/cloud/collaboration.spec.ts:556:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('.cloud-presence')
Expected substring: "共有停止"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" locator('.cloud-presence') with timeout 5000ms
  - waiting for locator('.cloud-presence')
    7 × locator resolved to <div class="cloud-presence">…</div>
      - unexpected value "クラウドに保存済み指定範囲を編集3人が参加中roster-cloud-desktop-b、roster-cloud-desktop-a、roster-cloud-desktop"

```

```yaml
- alert:
  - heading "作品へのアクセスを確認してください" [level=1]
  - paragraph: 参加権限またはログイン状態が変わったため、作品の表示を停止しました。
  - button "ログイン状態を確認して開き直す"
  - button "作品一覧を開く"
```

# Test source

```ts
  577 |       configurable: true,
  578 |       value: {
  579 |         writeText: async (text: string) => {
  580 |           (window as unknown as { copiedLink: string }).copiedLink = text;
  581 |         },
  582 |       },
  583 |     }),
  584 |   );
  585 |   await button(page, "作品リンクをコピー").click();
  586 |   await expect(page.locator(".cloud-copy-feedback").first()).toHaveText(
  587 |     "コピーしました",
  588 |   );
  589 |   expect(
  590 |     await page.evaluate(
  591 |       () => (window as unknown as { copiedLink: string }).copiedLink,
  592 |     ),
  593 |   ).toContain("/?room=");
  594 |
  595 |   const paste = page.getByRole("textbox", {
  596 |     name: "事前共有するメールアドレス",
  597 |     exact: true,
  598 |   });
  599 |   await paste.fill(
  600 |     `${a.toUpperCase()}@EXAMPLE.TEST,\n児童B <${b}@example.test>\n${a}@example.test`,
  601 |   );
  602 |   const preview = page.getByRole("region", {
  603 |     name: "事前共有のプレビュー",
  604 |     exact: true,
  605 |   });
  606 |   await expect(preview.locator("li")).toHaveCount(2);
  607 |   await expect(preview.locator("li").nth(0)).toContainText("1行目");
  608 |   await expect(preview.locator("li").nth(1)).toContainText("2行目");
  609 |   await page
  610 |     .getByRole("combobox", { name: "割り当てを開始する行", exact: true })
  611 |     .selectOption("99");
  612 |   await expect(page.locator(".pre-sharing [role=alert]")).toContainText(
  613 |     "100行を超えます",
  614 |   );
  615 |   await expect(button(page, "事前共有を保存")).toBeDisabled();
  616 |   await page
  617 |     .getByRole("combobox", { name: "割り当てを開始する行", exact: true })
  618 |     .selectOption("0");
  619 |   await preview.scrollIntoViewIfNeeded();
  620 |   await page.screenshot({ path: info.outputPath("pre-sharing-preview.png") });
  621 |   await button(page, "事前共有を保存").click();
  622 |   await expect(page.locator(".pre-share-account")).toHaveCount(2);
  623 |   await expect(paste).toHaveValue("");
  624 |   await page.reload();
  625 |   await saved(page);
  626 |   await page.getByRole("button", { name: "クラウド", exact: true }).click();
  627 |   await button(page, "共有するアカウントを追加").click();
  628 |   await expect(page.locator(".pre-share-account")).toHaveCount(2);
  629 |   await expect(
  630 |     page.getByRole("combobox", { name: "割り当てを開始する行", exact: true }),
  631 |   ).toHaveValue("2");
  632 |   const ca = await browser.newContext({
  633 |       baseURL: "http://127.0.0.1:3187",
  634 |       viewport: { width: 1440, height: 1000 },
  635 |     }),
  636 |     cb = await browser.newContext({
  637 |       baseURL: "http://127.0.0.1:3187",
  638 |       viewport: { width: 1440, height: 1000 },
  639 |     });
  640 |   const pa = await ca.newPage(),
  641 |     pb = await cb.newPage();
  642 |   try {
  643 |     await signIn(pa, a);
  644 |     await button(pa, "作品を開く：わたしたちのまちの、いいところ").click();
  645 |     await saved(pa);
  646 |     await openEditor(pa);
  647 |     await expect(button(pa, "文字")).toBeEnabled();
  648 |     await expect(button(pa, "空のシートを追加")).toBeDisabled();
  649 |     await pa.locator(".editor-workspace .element").first().click();
  650 |     const text = pa.getByRole("textbox", {
  651 |       name: "スライド内の文字",
  652 |       exact: true,
  653 |     });
  654 |     await text.press("Home");
  655 |     await pa.keyboard.type("assigned ");
  656 |     await saved(pa);
  657 |     await pa.keyboard.press("Escape");
  658 |     await signIn(pb, b, invite, page);
  659 |     await saved(pb);
  660 |     await openEditor(pb);
  661 |     await expect(button(pb, "文字")).toBeDisabled();
  662 |     await button(pb, "2段目の横のページをひらく").click();
  663 |     await expect(button(pb, "文字")).toBeEnabled();
  664 |     await button(page, "参加者一覧を更新").click();
  665 |     await expect(
  666 |       page
  667 |         .locator(".pre-share-account")
  668 |         .filter({ hasText: `${a}@example.test` }),
  669 |     ).toContainText("参加済み");
  670 |     await button(page, `${a}@example.testの事前編集権限を設定`).click();
  671 |     await page
  672 |       .getByRole("combobox", { name: "編集の権限", exact: true })
  673 |       .selectOption("none");
  674 |     await button(page, "事前編集権限を保存").click();
  675 |     await expect(button(pa, "文字")).toBeDisabled();
  676 |     await button(page, `${b}@example.testの事前共有を解除`).click();
> 677 |     await expect(pb.locator(".cloud-presence")).toContainText("共有停止");
      |                                                 ^ Error: expect(locator).toContainText(expected) failed
  678 |     await expect(page.locator(".pre-share-account")).toHaveCount(1);
  679 |   } finally {
  680 |     await ca.close();
  681 |     await cb.close();
  682 |   }
  683 | });
  684 |
  685 | test("sticky cards save in place, flush on navigation, and move by mouse or touch", async ({
  686 |   page,
  687 | }, info) => {
  688 |   const button = (name: string) =>
  689 |     page.getByRole("button", { name, exact: true });
  690 |   await signIn(page, `sticky-${info.project.name}`);
  691 |   await button("この作品をクラウドに保存").click();
  692 |   await saved(page);
  693 |   const room = new URL(page.url()).searchParams.get("room")!;
  694 |   await openEditor(page);
  695 |   await button("付箋を追加").click();
  696 |   const inputs = page.getByRole("textbox", {
  697 |     name: "付箋のコメント",
  698 |     exact: true,
  699 |   });
  700 |   await expect(inputs.first()).toBeFocused();
  701 |   // Hold a save open while the author continues typing. Both versions must
  702 |   // serialize correctly rather than a busy flag dropping the second one.
  703 |   await page.route("**/comments/*", async (route) => {
  704 |     if (route.request().method() === "PUT")
  705 |       await new Promise((resolve) => setTimeout(resolve, 350));
  706 |     await route.continue();
  707 |   });
  708 |   const firstRequest = page.waitForRequest(
  709 |     (r) => r.method() === "PUT" && r.url().includes("/comments/"),
  710 |   );
  711 |   await inputs.first().fill("最初の入力");
  712 |   await firstRequest;
  713 |   await inputs.first().fill("続けて入力した内容も保存");
  714 |   await button("付箋を追加").click();
  715 |   await expect(inputs).toHaveCount(2);
  716 |   await inputs.last().fill("画面を移る直前の入力");
  717 |   await button("全体マップへ").click();
  718 |   await expect
  719 |     .poll(async () => {
  720 |       const data = await (
  721 |         await page.request.get(`/api/decks/${room}/comments`)
  722 |       ).json();
  723 |       return data.comments.map((n: { text: string }) => n.text).sort();
  724 |     })
  725 |     .toEqual(["続けて入力した内容も保存", "画面を移る直前の入力"].sort());
  726 |   await openEditor(page);
  727 |   const note = page.locator(".sticky-note").first();
  728 |   const handle = note.getByRole("button", { name: "付箋を移動", exact: true });
  729 |   const before = (await note.boundingBox())!;
  730 |   const h = (await handle.boundingBox())!;
  731 |   const x = h.x + h.width / 2,
  732 |     y = h.y + h.height / 2;
  733 |   if (info.project.name === "cloud-touch") {
  734 |     const cdp = await page.context().newCDPSession(page);
  735 |     await cdp.send("Input.dispatchTouchEvent", {
  736 |       type: "touchStart",
  737 |       touchPoints: [{ id: 1, x, y }],
  738 |     });
  739 |     for (let step = 1; step <= 5; step++)
  740 |       await cdp.send("Input.dispatchTouchEvent", {
  741 |         type: "touchMove",
  742 |         touchPoints: [
  743 |           { id: 1, x: x - (80 * step) / 5, y: y + (35 * step) / 5 },
  744 |         ],
  745 |       });
  746 |     await cdp.send("Input.dispatchTouchEvent", {
  747 |       type: "touchEnd",
  748 |       touchPoints: [],
  749 |     });
  750 |   } else {
  751 |     await page.mouse.move(x, y);
  752 |     await page.mouse.down();
  753 |     await page.mouse.move(x - 80, y + 35, { steps: 5 });
  754 |     await page.mouse.up();
  755 |   }
  756 |   await expect
  757 |     .poll(async () => Math.round((await note.boundingBox())!.x))
  758 |     .toBeLessThan(Math.round(before.x - 50));
  759 |   await expect(note).toContainText("保存済み");
  760 |   const moved = (
  761 |     await (await page.request.get(`/api/decks/${room}/comments`)).json()
  762 |   ).comments;
  763 |   await page.screenshot({ path: info.outputPath("direct-sticky-notes.png") });
  764 |   await page.reload();
  765 |   await saved(page);
  766 |   await openEditor(page);
  767 |   await expect(inputs).toHaveCount(2);
  768 |   expect(
  769 |     (await (await page.request.get(`/api/decks/${room}/comments`)).json())
  770 |       .comments,
  771 |   ).toEqual(moved);
  772 |   // Bring an overlapping card to the front by focusing its text, just as
  773 |   // clicking the exposed part of a sticky does.
  774 |   await inputs.first().focus();
  775 |   await page
  776 |     .locator(".sticky-note")
  777 |     .first()
```
