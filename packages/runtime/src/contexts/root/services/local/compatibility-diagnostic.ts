/** Only retain dates from known runtime diagnostics, never arbitrary stderr or bindings. */
export const compatibilityDiagnostic = (error: unknown): Error | undefined => {
  for (let depth = 0; depth < 4 && typeof error === "object" && error !== null; depth++) {
    if (error instanceof LocalCompatibilityDateError) return error;
    const message = Object.getOwnPropertyDescriptor(error, "message")?.value;
    if (typeof message === "string") {
      const unsupported = message.match(
        /This Worker requires compatibility date "(\d{4}-\d{2}-\d{2})", but the newest date supported by this server binary is "(\d{4}-\d{2}-\d{2})"/,
      );
      const future = message.match(
        /Compatibility date "(\d{4}-\d{2}-\d{2})" is in the future and unsupported/,
      );
      if (unsupported || future) {
        return new LocalCompatibilityDateError(
          unsupported?.[1] ?? future?.[1] ?? "",
          unsupported?.[2],
        );
      }
    }
    error = Object.getOwnPropertyDescriptor(error, "cause")?.value;
  }
  return undefined;
};

export class LocalCompatibilityDateError extends Error {
  readonly name = "LocalCompatibilityDateError";
  constructor(requested: string, supported?: string) {
    super(
      `Requested compatibility date ${requested} is unsupported by the local runtime. ${
        supported
          ? `The running workerd binary reports support through ${supported}. Upgrade @carere/renkin and refresh your dependency lockfile to install a newer runtime.`
          : "The runtime rejects future compatibility dates. Choose an intentional application date that is not in the future."
      } Renkin does not downgrade application compatibility dates.`,
    );
  }
}
