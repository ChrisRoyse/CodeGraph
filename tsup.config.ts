import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'], // Entry point for the root CLI
  format: ['esm'],        // Output ESM format
  dts: true,              // Generate .d.ts files
  sourcemap: true,        // Generate source maps
  clean: false,           // Let the root clean script handle cleaning
  outDir: 'dist',         // Output directory
  // Treat workspace dependencies and other node_modules as external
  // This prevents bundling issues like the dynamic requires we saw
  external: [
    '@bmcp/analyzer-core',
    '@bmcp/watcher-service', // Although commented out in usage, keep external if re-enabled
    /node_modules/, // General rule for node_modules
  ],
  // Ensure node built-ins are not bundled if needed (though external should cover this)
  platform: 'node',
  target: 'node18', // Or your target Node.js version
});