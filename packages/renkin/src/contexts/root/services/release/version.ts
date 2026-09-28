/** Strict SemVer precedence; build metadata never makes a release newer. */
export const parseVersion = (value: string) => {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
      value,
    );
  if (
    !match ||
    match[0] !== value ||
    match[4]?.split(".").some((part) => /^\d+$/.test(part) && /^0\d/.test(part))
  )
    throw new Error(`Invalid release version: ${value}`);
  return {
    base: `${match[1]}.${match[2]}.${match[3]}`,
    numbers: match.slice(1, 4).map(BigInt),
    pre: match[4]?.split(".") ?? [],
  };
};
const compareIdentifier = (a: string, b: string) => {
  if (a === b) return 0;
  const numericA = /^\d+$/.test(a);
  const numericB = /^\d+$/.test(b);
  if (numericA && numericB) return BigInt(a) > BigInt(b) ? 1 : -1;
  if (numericA !== numericB) return numericA ? -1 : 1;
  return a > b ? 1 : -1;
};
export const compareVersions = (a: string, b: string): number => {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    const x = left.numbers[i] ?? 0n;
    const y = right.numbers[i] ?? 0n;
    if (x !== y) return x > y ? 1 : -1;
  }
  if (!left.pre.length || !right.pre.length)
    return Number(!left.pre.length) - Number(!right.pre.length);
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i];
    const y = right.pre[i];
    if (x === undefined || y === undefined)
      return Number(x !== undefined) - Number(y !== undefined);
    const compared = compareIdentifier(x, y);
    if (compared) return compared;
  }
  return 0;
};
export const bumpArguments = (current: string, requested = ""): readonly string[] => {
  const parsed = parseVersion(current);
  if (requested) {
    if (compareVersions(requested, current) <= 0)
      throw new Error(`Requested version must be newer than ${current}.`);
    return ["--version", requested];
  }
  if (!parsed.pre.length) return ["--auto"];
  const stage = parsed.pre.slice(0, -1).join(".");
  if (!stage || !/^\d+$/.test(parsed.pre.at(-1) ?? ""))
    throw new Error(
      "This prerelease format requires an explicit version (use alpha.1, beta.1 or rc.1 for automatic increments).",
    );
  return ["--version", parsed.base, "--pre", `${stage}.*`];
};
