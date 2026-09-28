import * as fs from "node:fs/promises";
import type { Effect } from "effect";
import { type ReleaseError, releaseAttempt } from "./release-error.ts";

export function readFile(path: string, encoding: "utf8"): Effect.Effect<string, ReleaseError>;
export function readFile(path: string): Effect.Effect<Buffer, ReleaseError>;
export function readFile(path: string, encoding?: "utf8") {
  return releaseAttempt<string | Buffer>(() =>
    encoding ? fs.readFile(path, encoding) : fs.readFile(path),
  );
}
export const writeFile = (...args: Parameters<typeof fs.writeFile>) =>
  releaseAttempt(() => fs.writeFile(...args));
export const mkdir = (path: string, options: { recursive: true }) =>
  releaseAttempt(() => fs.mkdir(path, options));
export const mkdtemp = (prefix: string) => releaseAttempt(() => fs.mkdtemp(prefix));
export const rm = (...args: Parameters<typeof fs.rm>) => releaseAttempt(() => fs.rm(...args));
export const chmod = (...args: Parameters<typeof fs.chmod>) =>
  releaseAttempt(() => fs.chmod(...args));
export const copyFile = (...args: Parameters<typeof fs.copyFile>) =>
  releaseAttempt(() => fs.copyFile(...args));
export const access = (path: string) => releaseAttempt(() => fs.access(path));
export const stat = (path: string) => releaseAttempt(() => fs.stat(path));
export const readdir = (path: string) =>
  releaseAttempt(() => fs.readdir(path, { withFileTypes: true }));
