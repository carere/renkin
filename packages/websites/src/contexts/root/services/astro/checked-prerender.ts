import type { AstroIntegration } from "astro";

type StartHook = NonNullable<AstroIntegration["hooks"]["astro:build:start"]>;
type Register = Parameters<StartHook>[0]["setPrerenderer"];
type Prerenderer = Exclude<Parameters<Register>[0], (...args: never[]) => unknown>;

export const checkPrerenderResponse = async <T extends Response | { response: Response }>(
  result: T,
): Promise<T> => {
  const value: Response | { response: Response } = result;
  const response = "response" in value ? value.response : value;
  if (response.status >= 500) {
    await response.body?.cancel();
    throw new Error(`Astro prerender failed with HTTP ${response.status}.`);
  }
  return result;
};

const checked = (prerenderer: Prerenderer): Prerenderer => ({
  ...prerenderer,
  async render(...args) {
    return checkPrerenderResponse(await prerenderer.render(...args));
  },
});

/** Preview transport errors must fail the build, never become successful static assets. */
export const checkedPrerender = (adapter: AstroIntegration): AstroIntegration => {
  const start = adapter.hooks["astro:build:start"];
  if (!start) return adapter;
  return {
    ...adapter,
    hooks: {
      ...adapter.hooks,
      "astro:build:start": (context) =>
        start({
          ...context,
          setPrerenderer: (prerenderer) =>
            context.setPrerenderer((fallback) =>
              checked(typeof prerenderer === "function" ? prerenderer(fallback) : prerenderer),
            ),
        }),
    },
  };
};
