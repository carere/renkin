import type { WorkerResource } from "@renkin/cloudflare/models/worker";
import type { BuildCommandOptions } from "@renkin/runtime/models/build-command";
import { buildCommand } from "@renkin/runtime/services/build-command/build-command";

/** Keep the declared graph and local development recipe; replace only production compilation. */
export const withBuildCommand = <Site extends WorkerResource>(
  site: Site,
  options: BuildCommandOptions,
): Site => {
  const command = buildCommand(options);
  const { build: _build, ...workerOptions } = site.options;
  return {
    ...site,
    options: {
      ...workerOptions,
      builder: {
        ...site.options.builder,
        build: command.build,
      },
    },
  };
};
