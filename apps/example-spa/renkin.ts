import { defineStack } from "renkin";
import { site } from "./resources.ts";
export default defineStack({ name: "example-spa", resources: [site] });
