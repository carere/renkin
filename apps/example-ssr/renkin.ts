import { defineStack } from "@carere/renkin";
import { site } from "./resources.ts";
export default defineStack({ name: "example-ssr", resources: [site] });
