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
      {
        test: {
          name: "preparation",
          include: [
            "tests/release-cloud/preparation.test.ts",
            "tests/release-cloud/backend.test.ts",
          ],
        },
      },
      {
        test: {
          name: "installed-cloud",
          include: ["tests/release-cloud/installed.test.ts"],
          fileParallelism: false,
        },
      },
      {
        test: { name: "release", include: ["tests/release/**/*.test.ts"], fileParallelism: false },
      },
      {
        test: {
          name: "astro",
          root: "tests/fixtures/astro-ssr",
          include: ["tests/integration/**/*.test.ts"],
        },
      },
    ].filter(({ test }) => {
      if (mode === "cloud") return test.name === "cloud" || test.name === "installed-cloud";
      if (mode === "release") return test.name === "release";
      return !["cloud", "installed-cloud", "release"].includes(test.name);
    }),
  },
}));
