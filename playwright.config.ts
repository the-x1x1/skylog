import { defineConfig, devices } from '@playwright/test';

const PORT = 4199;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npx tsx scripts/serve.ts',
    url: `http://127.0.0.1:${PORT}`,
    env: { PORT: String(PORT), ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' },
    reuseExistingServer: false,
    timeout: 90_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } }, testIgnore: /mobile\.spec/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec/ },
  ],
});
