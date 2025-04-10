// javascript_analyzer_service/id_generator.js
const crypto = require('crypto');
const path = require('path');

/**
 * Normalizes a file path for consistency.
 * - Uses forward slashes.
 * - Removes leading './'.
 * - Converts to lowercase.
 * @param {string} filePath - The original file path.
 * @returns {string} The normalized file path.
 */
function normalizePath(filePath) {
  if (!filePath) return '';
  let normalized = filePath.replace(/\\/g, '/'); // Convert backslashes to forward slashes
  if (normalized.startsWith('./')) {
    normalized = normalized.substring(2);
  }
  return normalized.toLowerCase(); // Ensure consistent case
}

/**
 * Generates a SHA-256 hash of the input string.
 * @param {string} inputString - The string to hash.
 * @returns {string} The hexadecimal SHA-256 hash.
 */
function sha256(inputString) {
  return crypto.createHash('sha256').update(inputString, 'utf8').digest('hex');
}

/**
 * Generates the Global ID for a code element.
 * Format: lang:sha256(normalized_relative_path:canonical_identifier)
 * @param {string} language - The language identifier (e.g., 'javascript').
 * @param {string} relativePath - The file path relative to the project root.
 * @param {string} canonicalIdentifier - The unique identifier for the element within the file.
 * @returns {string} The generated Global ID.
 */
function generateGlobalId(language, relativePath, canonicalIdentifier) {
  const normalized = normalizePath(relativePath);
  const inputString = `${normalized}:${canonicalIdentifier}`;
  const hash = sha256(inputString);
  return `${language}:${hash}`;
}

/**
 * Creates the canonical identifier string for a file node.
 * @param {string} normalizedRelativePath - The normalized file path.
 * @returns {string} The canonical identifier for the file.
 */
function createCanonicalFile(normalizedRelativePath) {
  // Path is included in the GID hash input, so just need a type marker.
  return "file";
}

/**
 * Creates the canonical identifier string for a function/method.
 * @param {string} functionName - The name of the function/method.
 * @param {string[]} parameters - An array of parameter names.
 * @param {string|null} [className=null] - The name of the enclosing class, if any.
 * @returns {string} The canonical identifier.
 */
function createCanonicalFunction(functionName, parameters, className = null) {
    // Use parameter count for robustness, matching Python/TS
    const paramCount = parameters.length;
    if (className) {
        // Member Method
        return `method:${className}.${functionName}(#${paramCount})`;
    }
    // Module/File level Function
    return `func:${functionName}(#${paramCount})`;
}

/**
 * Creates the canonical identifier string for a class.
 * @param {string} className - The name of the class.
 * @returns {string} The canonical identifier.
 */
function createCanonicalClass(className) {
    // Format: type:TypeName
    return `type:${className}`;
}

/**
 * Creates the canonical identifier string for a variable within a scope.
 * @param {string} variableName - The name of the variable.
 * @param {string|null} scopeIdentifier - The canonical identifier of the enclosing scope (function/method/class), or null for file scope.
 * @returns {string} The canonical identifier.
 */
// Note: We need the normalized path for module-level vars if we align fully with Python/TS.
// Keeping simpler JS version for now but adding prefixes.
// TODO: Revisit if module-level variable collisions become an issue across files.
function createCanonicalVariable(variableName, scopeIdentifier) {
    if (scopeIdentifier) { // Assumes scopeIdentifier is ParentTypeName for properties
        // Property/Attribute
        // Assuming scopeIdentifier might be like 'type:MyClass', get the name part
        const cleanScope = scopeIdentifier.split(':').pop() || scopeIdentifier;
        return `prop:${cleanScope}.${variableName}`;
    }
    // Module/File level Variable
    return `var:${variableName}`;
}

/**
 * Creates the canonical identifier string for an import statement.
 * @param {string} importedIdentifier - The name being imported (e.g., 'useState', '* as React').
 * @param {string} sourcePath - The source module path (e.g., 'react', './utils').
 * @returns {string} The canonical identifier.
 */
function createCanonicalImport(importedIdentifier, sourcePath) {
    // Normalize source path slightly for consistency if needed
    const normalizedSource = sourcePath.replace(/['"]/g, ''); // Remove quotes
    // Use @ as separator, matching Python/TS
    return `import:${importedIdentifier}@${normalizedSource}`;
}


module.exports = {
  normalizePath,
  sha256,
  generateGlobalId,
  createCanonicalFile,
  createCanonicalFunction,
  createCanonicalClass,
  createCanonicalVariable,
  createCanonicalImport,
};