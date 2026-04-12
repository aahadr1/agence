import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/calendar",
  timeout: 60_000,
  fullyParallel: false,
  use: {
    baseURL:
      process.env.CALENDAR_BASE_URL ||
      process.env.CRM_V2_BASE_URL ||
      "http://localhost:3000",
  },
  reporter: [["list"]],
});
