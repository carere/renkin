import { updateVersionFiles } from "#src/contexts/root/services/release/version-files.ts";

await updateVersionFiles(process.cwd(), process.argv[2] ?? "");
