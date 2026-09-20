import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["{apps,packages}/*/tests/unit/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["{apps,packages}/*/tests/integration/**/*.test.ts"],
        },
      },
    ],
  },
});
