import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "cloud",
          include: ["tests/cloud/**/*.test.ts"],
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ].filter(({ test }) => {
      if (mode === "cloud") return test.name === "cloud" || test.name === "installed-cloud";
      if (mode === "release") return test.name === "release";
      return !["cloud", "installed-cloud", "release"].includes(test.name);
    }),
  },
}));
