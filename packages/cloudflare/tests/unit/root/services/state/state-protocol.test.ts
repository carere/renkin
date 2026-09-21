import { Buffer } from "node:buffer";
import { expect, it } from "vitest";
import {
  decodeBytes,
  encodeBytes,
} from "../../../../../src/contexts/root/services/state/state-protocol.ts";

it("preserves standard padded Base64 for binary views and large payloads", () => {
  for (const length of [0, 1, 2, 3, 255, 32_767, 32_768, 32_769, 2 * 1024 * 1024 + 1]) {
    const backing = new Uint8Array(length + 8);
    for (let index = 0; index < backing.length; index++) backing[index] = index % 256;
    const bytes = backing.subarray(3, 3 + length);
    const encoded = encodeBytes(bytes);
    expect(encoded === Buffer.from(bytes).toString("base64")).toBe(true);
    expect(Buffer.from(decodeBytes(encoded)).equals(Buffer.from(bytes))).toBe(true);
  }
});

it("accepts existing unpadded and whitespace Base64 while rejecting invalid input", () => {
  expect([...decodeBytes(" YQ\n")]).toEqual([97]);
  expect(() => decodeBytes("!not-base64!")).toThrow();
});
