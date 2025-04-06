import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'], // Assuming src/index.ts is the main entry point
  format: ['esm'], // Output ESM format
  dts: {
    resolve: true, // Attempt to resolve types from workspace packages
  },
  splitting: true, // Enable code splitting
  sourcemap: true, // Generate source maps
  clean: true, // Clean the dist folder before building
  shims: true, // Add shims for __dirname, etc.
  outDir: 'dist', // Output directory
});