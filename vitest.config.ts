import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true, // Use Vitest's globals like describe, it, expect
    environment: 'node', // Specify the environment
    include: ['src/**/*.{test,spec}.ts', 'packages/**/*.{test,spec}.ts'], // Include test files in src and packages
    // setupFiles: ['./src/__tests__/setup.ts'], // Example setup file path
    testTimeout: 30000, // Increase timeout for potentially longer integration tests
    // threads: false, // Deprecated or incorrect option
    // minThreads: 1, // Incorrect option location
    // maxThreads: 1, // Incorrect option location
    sequence: { // Configure sequential execution
      concurrent: false
    },
    // reporters: ['verbose'], // Optional: More detailed reporting
    // coverage: { // Optional: Configure coverage
    //   provider: 'v8', // or 'istanbul'
    //   reporter: ['text', 'json', 'html'],
    // },
  },
  resolve: {
    alias: {
      '@bmcp/analyzer-core': path.resolve(__dirname, './packages/analyzer-core/src'),
      // Add other aliases if needed
    },
  },
});