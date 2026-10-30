# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: collaboration.spec.ts >> host edits shared map headings and row account names update vertically for guests
- Location: tests/cloud/collaboration.spec.ts:825:1

# Error details

```
Error: expect(locator).toHaveValue(expected) failed

Locator:  getByRole('textbox', { name: '行1の見出し', exact: true })
Expected: "headings-cloud-desktop-guest"
Received: ""
Timeout:  5000ms

Call log:
  - Expect "toHaveValue" getByRole('textbox', { name: '行1の見出し', exact: true }) with timeout 5000ms
  - waiting for getByRole('textbox', { name: '行1の見出し', exact: true })
    2 × locator resolved to <textarea title="" rows="1" readonly placeholder="" maxlength="80" spellcheck="false" aria-label="行1の見出し" class="map-heading-input vertical"></textarea>
      - unexpected value ""

```

```yaml
- textbox "行1の見出し":
  - /placeholder: ""
```

# Test source

```ts
  768 |   await expect(note).toContainText("保存済み");
  769 |   const moved = (
  770 |     await (await page.request.get(`/api/decks/${room}/comments`)).json()
  771 |   ).comments;
  772 |   await page.screenshot({ path: info.outputPath("direct-sticky-notes.png") });
  773 |   await page.reload();
  774 |   await saved(page);
  775 |   await openEditor(page);
  776 |   await expect(inputs).toHaveCount(2);
  777 |   expect(
  778 |     (await (await page.request.get(`/api/decks/${room}/comments`)).json())
  779 |       .comments,
  780 |   ).toEqual(moved);
  781 |   // Bring an overlapping card to the front by focusing its text, just as
  782 |   // clicking the exposed part of a sticky does.
  783 |   await inputs.first().focus();
  784 |   await page
  785 |     .locator(".sticky-note")
  786 |     .first()
  787 |     .getByRole("button", { name: "付箋を削除", exact: true })
  788 |     .click();
  789 |   await expect(inputs).toHaveCount(1);
  790 | });
  791 |
  792 | test("failed sticky autosaves keep the input and can be retried", async ({
  793 |   page,
  794 | }, info) => {
  795 |   const button = (name: string) =>
  796 |     page.getByRole("button", { name, exact: true });
  797 |   await signIn(page, `sticky-retry-${info.project.name}`);
  798 |   await button("この作品をクラウドに保存").click();
  799 |   await saved(page);
  800 |   await openEditor(page);
  801 |   let fail = true;
  802 |   await page.route("**/comments/*", async (route) => {
  803 |     if (route.request().method() === "PUT" && fail) {
  804 |       fail = false;
  805 |       await route.abort();
  806 |     } else await route.continue();
  807 |   });
  808 |   await button("付箋を追加").click();
  809 |   const input = page.getByRole("textbox", {
  810 |     name: "付箋のコメント",
  811 |     exact: true,
  812 |   });
  813 |   await input.fill("通信が失敗しても入力を残す");
  814 |   await expect(page.locator(".sticky-error")).toBeVisible();
  815 |   await expect(input).toHaveValue("通信が失敗しても入力を残す");
  816 |   await button("再試行").click();
  817 |   await expect(page.locator(".sticky-note")).toContainText("保存済み");
  818 |   await expect(page.locator(".sticky-error")).toHaveCount(0);
  819 |   await page.reload();
  820 |   await saved(page);
  821 |   await openEditor(page);
  822 |   await expect(input).toHaveValue("通信が失敗しても入力を残す");
  823 | });
  824 |
  825 | test("host edits shared map headings and row account names update vertically for guests", async ({
  826 |   page,
  827 |   browser,
  828 | }, info) => {
  829 |   const owner = `headings-${info.project.name}`,
  830 |     guest = `${owner}-guest`;
  831 |   const button = (p: Page, name: string) =>
  832 |     p.getByRole("button", { name, exact: true });
  833 |   await signIn(page, owner);
  834 |   await button(page, "この作品をクラウドに保存").click();
  835 |   await saved(page);
  836 |   await page.getByRole("button", { name: "クラウド", exact: true }).click();
  837 |   await button(page, "共有するアカウントを追加").click();
  838 |   await page
  839 |     .getByRole("textbox", { name: "事前共有するメールアドレス", exact: true })
  840 |     .fill(`${guest}@example.test`);
  841 |   await button(page, "事前共有を保存").click();
  842 |   await expect(page.locator(".pre-share-account")).toHaveCount(1);
  843 |   await button(page, "クラウドの作品を閉じる").click();
  844 |   const toggle = page.getByRole("switch", {
  845 |     name: "行に共有相手の名前を表示",
  846 |     exact: true,
  847 |   });
  848 |   await button(page, "マップの表示設定").click();
  849 |   await toggle.click();
  850 |   await expect(toggle).toHaveAttribute("aria-checked", "true");
  851 |   await page.keyboard.press("Escape");
  852 |   const heading = (p: Page, name: string) =>
  853 |     p.getByRole("textbox", { name, exact: true });
  854 |   await expect(heading(page, "行1の見出し")).toHaveValue(guest);
  855 |   await heading(page, "列2の見出し").fill("共同調査");
  856 |   await heading(page, "列2の見出し").press("Enter");
  857 |   const context = await browser.newContext({
  858 |     baseURL: "http://127.0.0.1:3187",
  859 |     viewport: { width: 1366, height: 768 },
  860 |   });
  861 |   const other = await context.newPage();
  862 |   try {
  863 |     await signIn(other, guest);
  864 |     await button(other, "作品を開く：わたしたちのまちの、いいところ").click();
  865 |     await saved(other);
  866 |     await expect(heading(other, "列2の見出し")).toHaveValue("共同調査");
  867 |     await expect(heading(other, "列2の見出し")).toHaveAttribute("readonly", "");
> 868 |     await expect(heading(other, "行1の見出し")).toHaveValue(guest);
      |                                            ^ Error: expect(locator).toHaveValue(expected) failed
  869 |     await expect(heading(other, "行1の見出し")).toHaveCSS(
  870 |       "writing-mode",
  871 |       "vertical-rl",
  872 |     );
  873 |     await button(other, "マップの表示設定").click();
  874 |     await expect(
  875 |       other.getByRole("switch", {
  876 |         name: "行に共有相手の名前を表示",
  877 |         exact: true,
  878 |       }),
  879 |     ).toBeDisabled();
  880 |     await other.keyboard.press("Escape");
  881 |     await heading(page, "行1の見出し").fill("1班");
  882 |     await heading(page, "行1の見出し").press("Enter");
  883 |     await expect(heading(other, "行1の見出し")).toHaveValue("1班");
  884 |     await heading(page, "行1の見出し").fill("");
  885 |     await heading(page, "行1の見出し").press("Enter");
  886 |     await expect(heading(other, "行1の見出し")).toHaveValue(guest);
  887 |
  888 |     const footer = (p: Page, position: string) =>
  889 |       p.getByRole("textbox", { name: `${position}のフッター`, exact: true });
  890 |     await expect(footer(other, "1.1")).toHaveValue(guest);
  891 |     await expect(footer(other, "2.1")).toHaveAttribute("readonly", "");
  892 |     await footer(other, "1.1").fill("わたしの調査");
  893 |     await footer(other, "1.1").press("Enter");
  894 |     await expect(footer(page, "1.1")).toHaveValue("わたしの調査");
  895 |     await openEditor(other);
  896 |     const assignees = other.getByRole("group", {
  897 |       name: "このスライドの共有者",
  898 |       exact: true,
  899 |     });
  900 |     // The actual shared names stay visible even with a custom thumbnail label.
  901 |     await expect(assignees).toContainText(guest);
  902 |     await expect(assignees).not.toContainText("わたしの調査");
  903 |     await expect(other.locator(".workspace-flight")).toHaveCount(0);
  904 |     await other.screenshot({
  905 |       path: info.outputPath("editor-shared-names.png"),
  906 |     });
  907 |     await button(other, "全体マップへ").click();
  908 |     await footer(other, "1.1").fill("");
  909 |     await footer(other, "1.1").press("Enter");
  910 |     await expect(footer(page, "1.1")).toHaveValue(guest);
  911 |     // Moving the assignment changes the name's row on all clients without reloading.
  912 |     const room = new URL(page.url()).searchParams.get("room")!;
  913 |     const response = await page.request.post(`/api/decks/${room}/recipients`, {
  914 |       headers: { Origin: "http://127.0.0.1:3187" },
  915 |       data: {
  916 |         recipients: [
  917 |           {
  918 |             email: `${guest}@example.test`,
  919 |             access: {
  920 |               mode: "scoped",
  921 |               comment: true,
  922 |               rows: [{ sheetId: "main", index: 1 }],
  923 |               columns: [],
  924 |               slides: [],
  925 |             },
  926 |           },
  927 |         ],
  928 |       },
  929 |     });
  930 |     expect(response.ok(), await response.text()).toBe(true);
  931 |     await expect(heading(other, "行1の見出し")).toHaveValue("");
  932 |     await expect(heading(other, "行2の見出し")).toHaveValue(guest);
  933 |     await expect(footer(page, "2.1")).toHaveValue(guest);
  934 |     await expect(footer(other, "1.1")).toHaveAttribute("readonly", "");
  935 |     await openEditor(other);
  936 |     await expect(assignees).toHaveCount(0);
  937 |     await button(other, "2段目の横のページをひらく").click();
  938 |     await button(other, "2.1 まちを歩いてみたらを編集").click();
  939 |     await expect(assignees).toContainText(guest);
  940 |     await button(other, "全体マップへ").click();
  941 |     await page.screenshot({ path: info.outputPath("shared-row-headings.png") });
  942 |     await other.reload();
  943 |     await saved(other);
  944 |     await expect(heading(other, "行2の見出し")).toHaveValue(guest);
  945 |   } finally {
  946 |     await context.close();
  947 |   }
  948 | });
  949 |
  950 | test("sticky color, presets and direct resize persist with mouse and touch", async ({
  951 |   page,
  952 | }, info) => {
  953 |   const button = (name: string) =>
  954 |     page.getByRole("button", { name, exact: true });
  955 |   await signIn(page, `sticky-style-${info.project.name}`);
  956 |   await button("この作品をクラウドに保存").click();
  957 |   await saved(page);
  958 |   await openEditor(page);
  959 |   // Measure preset growth above the accessible 120px minimum note width.
  960 |   // Touch still uses real touch events; narrow-canvas layout is a separate concern.
  961 |   await button("右のサイドバーをたたむ").click();
  962 |   await expect
  963 |     .poll(
  964 |       async () =>
  965 |         (await page.locator(".editor-workspace .slide-canvas").boundingBox())!
  966 |           .width,
  967 |     )
  968 |     .toBeGreaterThan(450);
```
