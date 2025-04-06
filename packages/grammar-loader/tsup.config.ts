import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'], // Output CJS format
  dts: true, // Generate .d.ts files
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  // No need for external or shims as this is a simple CJS package
});