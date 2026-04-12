import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/crm-v2",
  timeout: 60_000,
  fullyParallel: false,
  use: {
    baseURL: process.env.CRM_V2_BASE_URL || "http://localhost:3000",
  },
  reporter: [["list"]],
});
