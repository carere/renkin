import { Log, LogLevel, Miniflare, supportedCompatibilityDate } from "miniflare";
import type { BindingRequirement, Requirements } from "../../models/binding.ts";
import { validateEmailOptions } from "../../models/email.ts";

const inspect = (value: unknown): Requirements => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Worker requirements.");
  const result: Record<string, BindingRequirement> = {};
  for (const [name, item] of Object.entries(value)) {
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ||
      name.startsWith("__RENKIN_") ||
      !item ||
      typeof item !== "object" ||
      !("type" in item) ||
      !("id" in item) ||
      typeof item.id !== "string"
    )
      throw new Error("Invalid Worker requirement.");
    if (
      item.type !== "cloudflare.kv" &&
      item.type !== "cloudflare.d1" &&
      item.type !== "cloudflare.queue" &&
      item.type !== "cloudflare.workflow" &&
      item.type !== "cloudflare.email" &&
      item.type !== "cloudflare.worker-reference"
    )
      throw new Error("Unsupported Worker requirement.");
    if (item.type === "cloudflare.email") {
      result[name] = {
        type: "cloudflare.email",
        id: "email",
        options: validateEmailOptions("options" in item ? item.options : {}),
      };
      continue;
    }
    const entrypoint = "entrypoint" in item ? item.entrypoint : undefined;
    if (entrypoint !== undefined && typeof entrypoint !== "string")
      throw new Error("Invalid Worker entrypoint.");
    const external = "external" in item ? item.external : undefined;
    if (
      external !== undefined &&
      (!external ||
        typeof external !== "object" ||
        !("name" in external) ||
        typeof external.name !== "string" ||
        ("localEntry" in external && typeof external.localEntry !== "string"))
    )
      throw new Error("Invalid external Worker.");
    result[name] = {
      type: item.type,
      id: item.id,
      ...(entrypoint ? { entrypoint } : {}),
      ...(external ? { external: external as { name: string; localEntry?: string } } : {}),
    };
  }
  return result;
};

/** Only read inert descriptor metadata. No handler/factory calls, filesystem or outbound network. */
export const inspectRequirements = async (
  source: string,
  compatibilityDate: string,
  compatibilityFlags: readonly string[] = ["nodejs_compat"],
  artifact: {
    readonly mainModule: string;
    readonly modules: readonly {
      readonly name: string;
      readonly type: string;
      readonly content: string;
    }[];
  } = { mainModule: "worker.mjs", modules: [] },
): Promise<Requirements> => {
  const runtime = new Miniflare({
    log: new Log(LogLevel.NONE),
    modules: [
      {
        type: "ESModule",
        path: "inspect.mjs",
        contents: `import * as implementation from ${JSON.stringify(`./${artifact.mainModule}`)}; export default {fetch(){const result={};for(const exported of Object.values(implementation)){for(const [name, requirement] of Object.entries(exported?.__renkinRequirements ?? {})){if(name in result && JSON.stringify(result[name])!==JSON.stringify(requirement))throw new Error("Conflicting Worker requirements");result[name]=requirement;}}return Response.json(result)}}`,
      },
      { type: "ESModule", path: artifact.mainModule, contents: source },
      ...artifact.modules.map((module) => ({
        type:
          module.type === "application/wasm"
            ? ("CompiledWasm" as const)
            : module.type === "text/plain"
              ? ("Text" as const)
              : module.type === "application/octet-stream"
                ? ("Data" as const)
                : ("ESModule" as const),
        path: module.name,
        contents: Buffer.from(module.content, "base64"),
      })),
    ],
    modulesRoot: "/",
    compatibilityDate:
      compatibilityDate > supportedCompatibilityDate
        ? supportedCompatibilityDate
        : compatibilityDate,
    compatibilityFlags: [...compatibilityFlags],
    outboundService: () =>
      new Response("Metadata inspection cannot access the network.", { status: 403 }),
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      runtime.dispatchFetch("http://inspect.invalid/").then((response) => response.json()),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Worker metadata inspection timed out.")), 10000);
      }),
    ]);
    return inspect(result);
  } catch {
    throw new Error("Worker requirements could not be inspected in the isolated runtime.");
  } finally {
    if (timer) clearTimeout(timer);
    await runtime.dispose().catch(() => {});
  }
};
