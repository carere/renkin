import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import ignore from "ignore";
import type { BuildProducer, BuildValue } from "#src/contexts/root/models/build-reuse.ts";
import { workspaceInputs } from "./workspace-inputs.ts";

export const digest = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");
export const canonicalBuildValue = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalBuildValue).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${JSON.stringify(key)}:${canonicalBuildValue(value)}`)
      .join(",")}}`;
  if (
    value !== null &&
    typeof value !== "string" &&
    typeof value !== "boolean" &&
    !(typeof value === "number" && Number.isFinite(value))
  )
    throw new Error("Build identities must contain only finite JSON values.");
  return JSON.stringify(value);
};
export const missing = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";
const defaults = [
  ".git",
  ".moon/",
  ".git/",
  "node_modules",
  ".renkin/",
  ".renkin-*/",
  ".wrangler/",
  ".astro/",
  ".tanstack/",
  "dist/",
  "coverage/",
  "*.tsbuildinfo",
  "**/routeTree.gen.ts",
];

const inventory = async (root: string, excludes: readonly string[]) => {
  const matcher = ignore().add([...defaults, ...excludes]);
  const entries: [string, string][] = [];
  const walk = async (path: string): Promise<void> => {
    const name = relative(root, path).replaceAll("\\", "/");
    const stat = await lstat(path);
    if (name && matcher.ignores(`${name}${stat.isDirectory() ? "/" : ""}`)) return;
    if (stat.isSymbolicLink())
      throw new Error(
        "Build inputs must not contain symbolic links; declare their target explicitly.",
      );
    if (stat.isDirectory()) {
      entries.push([`${name}/`, "directory"]);
      for (const child of (await readdir(path)).sort()) await walk(resolve(path, child));
    } else if (stat.isFile()) entries.push([name, digest(await readFile(path))]);
    else throw new Error("Build inputs must be regular files or directories.");
  };
  await walk(root);
  return entries;
};

const ancestors = async (root: string) => {
  const files: string[] = [];
  for (let current = root; ; current = dirname(current)) {
    for (const name of [
      "package.json",
      "bun.lock",
      "bun.lockb",
      "pnpm-lock.yaml",
      "package-lock.json",
      "yarn.lock",
      "tsconfig.json",
    ]) {
      const path = resolve(current, name);
      try {
        if ((await lstat(path)).isFile()) files.push(path);
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
    if (dirname(current) === current) break;
  }
  return files;
};

export const fingerprint = async (producer: BuildProducer) => {
  const root = await realpath(resolve(producer.root));
  const options = producer.reuse || {};
  const dependencies = new Set(await workspaceInputs(root));
  const explicit = new Set((options.inputs ?? []).map((path) => resolve(root, path)));
  const inputs = [
    ...new Set([root, ...explicit, ...(await ancestors(root)), ...dependencies]),
  ].sort();
  const source = await Promise.all(
    inputs.map(async (path) => [
      path,
      await inventory(path, [
        ...(dependencies.has(path) && path !== root && !explicit.has(path)
          ? ["/tests/", "/test/"]
          : []),
        ...(options.exclude ?? []),
      ]),
    ]),
  );
  return digest(
    canonicalBuildValue({
      schema: 1,
      adapter: producer.adapter,
      root,
      runtime: `${process.versions.bun ?? process.versions.node}:${process.platform}:${process.arch}`,
      values: producer.values,
      explicit: options.values ?? null,
      key: options.key ?? null,
      outputRoot: resolve(root, options.outputRoot ?? "."),
      sources: source as BuildValue,
    }),
  );
};
