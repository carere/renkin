import { expect, it } from "vitest";
import {
  decryptState,
  encryptState,
  newStateKey,
} from "../../../../../src/contexts/root/services/state/state-cipher.ts";

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
