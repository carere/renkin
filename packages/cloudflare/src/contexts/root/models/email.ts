import {
  type EmailOptions,
  type EmailRequirement,
  validateEmailOptions,
} from "@renkin/runtime/models/email";

export const email = (options: EmailOptions = {}): EmailRequirement => ({
  type: "cloudflare.email",
  id: "email",
  options: validateEmailOptions(options),
});
