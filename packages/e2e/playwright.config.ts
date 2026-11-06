import { defineConfig } from '@playwright/test';

// The tests drive the built CLI (`pnpm -r build` first): a real daemon, real viewer bundle.
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  snapshotPathTemplate: '{testDir}/__snapshots__/{testFileName}/{arg}{ext}',
  projects: [{ name: 'chromium', use: { browserName: 'chromium', headless: true } }],
});
