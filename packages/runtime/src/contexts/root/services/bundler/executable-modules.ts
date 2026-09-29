/** Source maps remain in the upload artifact but are not workerd modules. */
export const executableModules = <
  Module extends { readonly type: string; readonly name: string; readonly content: string },
>(
  modules: readonly Module[],
  root = "",
) =>
  modules
    .filter((module) => module.type !== "application/source-map")
    .map((module) => ({
      type:
        module.type === "application/wasm"
          ? ("CompiledWasm" as const)
          : module.type === "text/plain"
            ? ("Text" as const)
            : module.type === "application/octet-stream"
              ? ("Data" as const)
              : ("ESModule" as const),
      path: root + module.name,
      contents: Buffer.from(module.content, "base64"),
    }));
