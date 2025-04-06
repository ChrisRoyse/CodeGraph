import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'], // Use the new barrel file as the entry point
  format: ['esm', 'cjs'], // Output ESM and CJS formats
  dts: { resolve: true }, // Generate .d.ts files and resolve types
  // splitting: true, // REMOVED: Simplify output
  sourcemap: true, // Generate source maps
  clean: true, // Clean the dist folder before building
  // shims: true, // Shims might not be needed now
  outDir: 'dist', // Output directory
  // Keep external for clarity, though noExternal should take precedence
  external: [ // Keep dependencies external
    'dotenv',
    'ignore',
    'micromatch',
    'neo4j-driver',
    'tree-sitter',
    // Explicitly list tree-sitter grammar packages as external
    // They are native CJS addons loaded via @bmcp/grammar-loader
    'tree-sitter-python',
    'tree-sitter-javascript',
    'tree-sitter-typescript',
    'tree-sitter-sql',
    'tree-sitter-go',
    'tree-sitter-java',
    'tree-sitter-c-sharp',
    'tree-sitter-c',
    'tree-sitter-cpp',
    'ts-morph',
    'typescript',
    'winston',
    '@bmcp/grammar-loader', // Mark the new loader as external
  ],
  // REMOVED: noExternal: [/./], // This was causing issues by bundling external dependencies
});