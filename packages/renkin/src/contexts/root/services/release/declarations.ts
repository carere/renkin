import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { SourcePackage } from "./layout.ts";

export const emitDeclarations = async (
  root: string,
  temporary: string,
  packages: readonly SourcePackage[],
) => {
  const config = join(temporary, "tsconfig.json");
  const types = join(temporary, "types");
  await writeFile(
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
  await promisify(execFile)(
    process.execPath,
    [join(root, "node_modules/typescript/bin/tsc"), "--project", config],
    { cwd: root, maxBuffer: 2000000 },
  );
  return types;
};
