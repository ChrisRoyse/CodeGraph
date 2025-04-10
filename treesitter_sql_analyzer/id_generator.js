// treesitter_sql_analyzer/id_generator.js
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
 * @param {string} language - The language identifier (e.g., 'sql').
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
  return normalizedRelativePath;
}

/**
 * Creates the canonical identifier string for an SQL Table.
 * @param {string} tableName - The name of the table.
 * @returns {string} The canonical identifier.
 */
function createCanonicalTable(tableName) {
    // Simple identifier for now, might need schema prefix later if schemas are used
    return `TABLE:${tableName}`;
}

/**
 * Creates the canonical identifier string for an SQL Column.
 * @param {string} tableName - The name of the table the column belongs to.
 * @param {string} columnName - The name of the column.
 * @returns {string} The canonical identifier.
 */
function createCanonicalColumn(tableName, columnName) {
    // Include table name for uniqueness
    return `TABLE:${tableName}:COLUMN:${columnName}`;
}

// Add other SQL-specific canonical identifier functions as needed (e.g., for Views, Functions, Procedures)


module.exports = {
  normalizePath,
  sha256,
  generateGlobalId,
  createCanonicalFile,
  createCanonicalTable,
  createCanonicalColumn,
};