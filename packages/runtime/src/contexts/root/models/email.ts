import type { SendEmail } from "@cloudflare/workers-types";
import { Effect } from "effect";

export interface EmailOptions {
  readonly destinationAddress?: string;
  readonly allowedDestinationAddresses?: readonly string[];
  readonly allowedSenderAddresses?: readonly string[];
}
export interface EmailRequirement {
  readonly type: "cloudflare.email";
  readonly id: "email";
  readonly options: EmailOptions;
}
export const validateEmailOptions = (value: unknown): EmailOptions => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid email binding options.");
  const options = value as EmailOptions;
  if (options.destinationAddress && options.allowedDestinationAddresses)
    throw new Error("Email accepts either one destination or an allowlist, not both.");
  for (const list of [options.allowedDestinationAddresses, options.allowedSenderAddresses])
    if (list !== undefined && (!Array.isArray(list) || !list.length))
      throw new Error("Email allowlists must be nonempty arrays.");
  for (const address of [
    options.destinationAddress,
    ...(options.allowedDestinationAddresses ?? []),
    ...(options.allowedSenderAddresses ?? []),
  ])
    if (
      address !== undefined &&
      (typeof address !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))
    )
      throw new Error("Invalid email binding address.");
  return options;
};
export type NativeEmail = SendEmail;
export class EmailError extends Error {
  readonly name = "EmailError";
  constructor(readonly binding: string) {
    super(`Email binding ${binding} failed to send.`);
  }
}
export const emailClient = (native: NativeEmail, binding: string) => ({
  native,
  send: (message: Parameters<NativeEmail["send"]>[0]) =>
    Effect.tryPromise({ try: () => native.send(message), catch: () => new EmailError(binding) }),
});
export type EmailClient = ReturnType<typeof emailClient>;
