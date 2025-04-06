import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'], // Entry point of the package
  format: ['cjs'], // Output format: CommonJS
  outDir: 'dist', // Output directory
  splitting: false, // Keep code in a single file
  sourcemap: true, // Generate source maps
  clean: true, // Clean the output directory before building
  dts: true, // Generate declaration files (.d.ts)
  treeshake: true, // Remove unused code
  minify: false, // Do not minify for better readability during development
});