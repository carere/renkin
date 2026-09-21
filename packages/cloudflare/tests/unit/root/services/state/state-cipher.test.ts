import { expect, it } from "vitest";
import {
  decryptState,
  encryptState,
  newStateKey,
} from "../../../../../src/contexts/root/services/state/state-cipher.ts";

it("reads a version-one envelope produced by the previous binary-string encoder", async () => {
  const envelope =
    '{"version":1,"algorithm":"AES-GCM","nonce":"4AWPGj/lkvwfqWc9","ciphertext":"A+CIgGZAaz7oJCrM5qvCJsR3aipoTq2tIfh9dNokDGxod9Hr0o0kXg=="}';
  const key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  expect(await decryptState(key, JSON.stringify([1, "stack", "preview"]), envelope)).toBe(
    '{"secret":"legacy 🦊"}',
  );
  await expect(
    decryptState(key, JSON.stringify([1, "stack", "production"]), envelope),
  ).rejects.toThrow();
});

it("authenticates state and its stack/environment identity with unique nonces", async () => {
  const key = newStateKey();
  const context = JSON.stringify([1, "stack", "preview"]);
  const first = await encryptState(key, context, '{"secret":"value"}');
  const second = await encryptState(key, context, '{"secret":"value"}');
  expect(first).not.toBe(second);
  expect(first).not.toContain("secret");
  expect(await decryptState(key, context, first)).toBe('{"secret":"value"}');
  await expect(decryptState(newStateKey(), context, first)).rejects.toThrow();
  await expect(
    decryptState(key, JSON.stringify([1, "stack", "production"]), first),
  ).rejects.toThrow();
  const corrupted = JSON.parse(first) as { ciphertext: string };
  corrupted.ciphertext = `AAAA${corrupted.ciphertext.slice(4)}`;
  await expect(decryptState(key, context, JSON.stringify(corrupted))).rejects.toThrow();
  await expect(decryptState(key, context, "not json")).rejects.toThrow();
});
