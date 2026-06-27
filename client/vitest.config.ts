import { defineConfig } from 'vitest/config';

// Plain Vitest for dependency-free unit tests (pure logic extracted from the
// composables). No Nuxt/Vue runtime needed — tests import the modules directly.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
