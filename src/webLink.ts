/** External object links are restricted to ordinary web pages. */
export function webLink(value: string): string {
  const url = new URL(value.trim());
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("http:// または https:// で始まるURLを指定してください。");
  return url.href;
}
