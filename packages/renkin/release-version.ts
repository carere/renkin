import { Effect } from "effect";
import { updateVersionFiles } from "#src/contexts/root/services/release/version-files.ts";

await Effect.runPromise(updateVersionFiles(process.cwd(), process.argv[2] ?? ""));
