import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/**
 * The tests that need WebGPU (the playground's live preview: the phone dock,
 * Touch-node patches). Headless Chromium has none, so those skip themselves
 * in the normal run; the installed Chrome, headless, has it on a machine
 * with a GPU. `bun run test:gpu`.
 */
export default defineConfig({
  ...base,
  projects: [
    {
      name: "chrome-gpu",
      use: {
        channel: "chrome",
        launchOptions: {
          args: [
            "--enable-unsafe-webgpu",
            "--enable-features=Vulkan",
            "--ignore-gpu-blocklist",
          ],
        },
      },
    },
  ],
  webServer: { ...base.webServer!, reuseExistingServer: true },
});
