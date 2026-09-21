export const cloudSuites = [
  "worker",
  "connected-worker",
  "d1",
  "background",
  "durable-object",
  "durable-object-recovery",
  "durable-object-retirement",
  "r2",
  "protected-site",
  "astro",
  "tanstack",
  "full-graph",
] as const;
export type CloudSuite = (typeof cloudSuites)[number];
export const supportFiles = [
  "cloud-d1-fixture.ts",
  "cloud-background-fixture.ts",
  "cloud-durable-object-fixture.ts",
  "cloud-r2-fixture.ts",
  "cloud-astro-fixture.ts",
  "tanstack-cloud.ts",
  "site-http.ts",
  "cloud-full-graph/fixture.ts",
  "cloud-full-graph/cloud-stack.ts",
  "cloud-full-graph/assertions.ts",
  "cloud-full-graph/bounded-fetch.ts",
];
export const consumerConfig = `import { defineConfig } from "vitest/config";
export default defineConfig({test:{include:["tests/cloud/root/*.test.ts"],fileParallelism:false,
maxWorkers:1,bail:1,testTimeout:120000,hookTimeout:120000,disableConsoleIntercept:true}});
`;
export const installedPaths = `import {readFile,realpath} from "node:fs/promises";
import {dirname,resolve,relative,isAbsolute} from "node:path";
import {fileURLToPath} from "node:url";
export const installedCli=async()=>{
 const manifest=fileURLToPath(new URL("../../../../../node_modules/renkin/package.json",import.meta.url));
 const root=await realpath(dirname(manifest));
 const pkg=JSON.parse(await readFile(manifest,"utf8"));
 const bin=typeof pkg.bin==="string"?pkg.bin:pkg.bin?.renkin;
 if(pkg.name!=="renkin"||typeof bin!=="string")throw Error("Installed Renkin CLI missing.");
 const path=await realpath(resolve(root,bin));const child=relative(root,path);
 if(child.startsWith("..")||isAbsolute(child))throw Error("Installed CLI escapes package.");
 return path;
};
`;
