import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "app/email-engine/**/*.test.ts",
      "app/email-delivery/**/*.test.ts",
      "app/dashboard/**/*.test.ts",
      "app/brand-studio/**/*.test.ts",
      "email-templates/**/*.test.ts",
    ],
    clearMocks: true,
    restoreMocks: true,
  },
});
