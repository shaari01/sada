import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e', timeout: 90000, retries: 0, workers: 1,
  use: { baseURL: 'http://localhost:4173/', trace: 'off', launchOptions: { args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } },
  webServer: { command: 'npx vite preview --port 4173 --strictPort', port: 4173, reuseExistingServer: true },
  projects: [
    { name: 'laptop', use: { viewport: { width: 1366, height: 768 } } },
  ],
});
