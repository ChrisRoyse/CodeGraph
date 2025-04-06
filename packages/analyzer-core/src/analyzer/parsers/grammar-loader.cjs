// packages/analyzer-core/src/analyzer/parsers/grammar-loader.cjs
// This file uses CommonJS require to load tree-sitter grammars,
// isolating it from the main ESM codebase.

// Use the standard Node.js require
const requireFunc = require;

async function loadGrammar(packageName) {
  console.log(`[grammar-loader.cjs] Attempting to require: ${packageName}`);
  try {
    // Dynamically require the package
    const grammar = requireFunc(packageName);
    console.log(`[grammar-loader.cjs] Successfully required: ${packageName}`);
    return grammar;
  } catch (error) {
    console.error(`[grammar-loader.cjs] Failed to require package ${packageName}:`, error);
    throw error; // Re-throw the error to be caught by the caller
  }
}

module.exports = { loadGrammar };