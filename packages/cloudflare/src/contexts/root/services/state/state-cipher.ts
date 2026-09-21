import { decodeBytes, encodeBytes } from "./state-protocol.ts";

interface Envelope {
  readonly version: 1;
  readonly algorithm: "AES-GCM";
  readonly nonce: string;
  readonly ciphertext: string;
}
const keyFor = (raw: string) =>
  crypto.subtle.importKey("raw", decodeBytes(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
export const newStateKey = (): string => encodeBytes(crypto.getRandomValues(new Uint8Array(32)));
export const encryptState = async (
  rawKey: string,
  context: string,
  value: string,
): Promise<string> => {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode(context) },
    await keyFor(rawKey),
    new TextEncoder().encode(value),
  );
  return JSON.stringify({
    version: 1,
    algorithm: "AES-GCM",
    nonce: encodeBytes(nonce),
    ciphertext: encodeBytes(new Uint8Array(ciphertext)),
  } satisfies Envelope);
};
export const decryptState = async (
  rawKey: string,
  context: string,
  value: string,
): Promise<string> => {
  const envelope: Envelope = JSON.parse(value);
  if (envelope.version !== 1 || envelope.algorithm !== "AES-GCM")
    throw new Error("Unsupported state envelope.");
  return new TextDecoder("utf-8", { fatal: true }).decode(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decodeBytes(envelope.nonce),
        additionalData: new TextEncoder().encode(context),
      },
      await keyFor(rawKey),
      decodeBytes(envelope.ciphertext),
    ),
  );
};
