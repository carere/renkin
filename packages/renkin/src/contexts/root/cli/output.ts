import { Console } from "node:console";

/** CLI-only policy: libraries and infrastructure code cannot corrupt the JSON channel. */
export const routeCliOutput = () => {
  const stdout = process.stdout.write.bind(process.stdout);
  process.stdout.write = process.stderr.write.bind(process.stderr);
  globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });
  return (serialized: string) => {
    stdout(`${serialized}\n`);
  };
};
