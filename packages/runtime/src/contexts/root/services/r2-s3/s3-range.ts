export interface ByteRange {
  readonly offset: number;
  readonly length: number;
}
/** Multiple ranges match the reference's full-object fallback; malformed single ranges fail. */
export const parseRange = (
  header: string | null,
  size: number,
): ByteRange | "invalid" | undefined => {
  if (!header || header.includes(",")) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size === 0) return "invalid";
  const first = Number(match[1]);
  const last = Number(match[2]);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return "invalid";
  if (!match[1]) {
    if (last <= 0) return "invalid";
    const length = Math.min(last, size);
    return { offset: size - length, length };
  }
  if (first >= size || (match[2] && last < first)) return "invalid";
  const end = match[2] ? Math.min(last, size - 1) : size - 1;
  return { offset: first, length: end - first + 1 };
};
