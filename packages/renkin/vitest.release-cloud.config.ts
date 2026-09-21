import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "preparation",
          include: [
            "tests/release-cloud/preparation.test.ts",
            "tests/release-cloud/backend.test.ts",
          ],
        },
      },
      { test: { name: "installed-cloud", include: ["tests/release-cloud/installed.test.ts"] } },
    ],
  },
});
