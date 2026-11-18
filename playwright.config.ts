import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const chrome =
  process.env.PLAYWRIGHT_CHROME_PATH ||
  "C:/Program Files/Google/Chrome/Application/chrome.exe";
export default defineConfig({
  testDir: "./tests/ui",
  use: {
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 1440, height: 960 },
    launchOptions: {
      executablePath: existsSync(chrome) ? chrome : undefined,
    },
  },
  webServer: {
    command: "node node_modules/vite/bin/vite.js --host 127.0.0.1",
    port: 5173,
    reuseExistingServer: true,
  },
  reporter: "list",
});
