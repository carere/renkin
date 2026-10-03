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
          name: "stress",
          include: ["tests/stress/**/*.test.ts"],
          fileParallelism: false,
        },
      },
    ].filter(({ test }) => (mode === "stress" ? test.name === "stress" : test.name !== "stress")),
  },
}));
