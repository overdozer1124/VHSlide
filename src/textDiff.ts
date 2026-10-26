/** UTF-16 offsets as used by Yjs/Quill, never split a surrogate pair. */
export function textDifference(before: string, after: string) {
  let start = 0,
    suffix = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  )
    start++;
  const low = (s: string, i: number) =>
    i > 0 &&
    i < s.length &&
    s.charCodeAt(i) >= 0xdc00 &&
    s.charCodeAt(i) <= 0xdfff &&
    s.charCodeAt(i - 1) >= 0xd800 &&
    s.charCodeAt(i - 1) <= 0xdbff;
  if (low(before, start) || low(after, start)) start--;
  while (
    suffix < before.length - start &&
    suffix < after.length - start &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix++;
  if (low(before, before.length - suffix) || low(after, after.length - suffix))
    suffix--;
  return { start, suffix };
}
