import { join } from "node:path";
import { Effect } from "effect";
import type { SourcePackage } from "./layout.ts";
import { writeFile } from "./release-files.ts";
import { releaseCommand } from "./release-git.ts";

export const emitDeclarations = (
  root: string,
  temporary: string,
  packages: readonly SourcePackage[],
) =>
  Effect.gen(function* () {
    const config = join(temporary, "tsconfig.json");
    const types = join(temporary, "types");
    yield* writeFile(
      config,
      JSON.stringify(
        {
          extends: join(root, "tsconfig.options.json"),
          compilerOptions: {
            composite: false,
            incremental: false,
            declaration: true,
            declarationMap: false,
            emitDeclarationOnly: true,
            rootDir: join(root, "packages"),
            outDir: types,
            typeRoots: [join(root, "node_modules/@types")],
          },
          include: packages.map(({ directory }) => `${directory}/src/**/*.ts`),
          exclude: [join(root, "packages/renkin/src/contexts/root/services/release")],
        },
        null,
        2,
      ),
    );
    yield* releaseCommand(root, process.execPath, [
      join(root, "node_modules/typescript/bin/tsc"),
      "--project",
      config,
    ]);
    return types;
  });
