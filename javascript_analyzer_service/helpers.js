// javascript_analyzer_service/helpers.js
// Contains utility functions for JavaScript analysis

/**
 * Converts a Tree-sitter point (0-based) to a location (1-based)
 * @param {Object} point - Tree-sitter point with row and column properties
 * @returns {Object} Location with line and column properties (1-based)
 */
function pointToLocation(point) {
    // Tree-sitter points are 0-based row/column
    return { line: point.row + 1, column: point.column + 1 };
}

/**
 * Extracts text from a node using source code
 * @param {Object} node - Tree-sitter syntax node
 * @param {string} sourceCode - Source code string
 * @returns {string} Text of the node
 */
function getNodeText(node, sourceCode) {
    if (!node) return '';
    return sourceCode.substring(node.startIndex, node.endIndex);
}

/**
 * Gets the code location for a node
 * @param {Object} node - Tree-sitter syntax node
 * @param {string} filePath - Path of the file
 * @returns {Object} Location object with file_path, start_line, start_column, end_line, end_column
 */
function getCodeLocation(node, filePath) {
    if (!node) {
        // Fallback or default location if node is somehow null/undefined
        return { file_path: filePath, start_line: 0, start_column: 0, end_line: 0, end_column: 0 };
    }
    const start = pointToLocation(node.startPosition);
    const end = pointToLocation(node.endPosition);
    return {
        file_path: filePath,
        start_line: start.line,
        start_column: start.column,
        end_line: end.line,
        end_column: end.column,
    };
}

// Heuristic for potential API calls (can be expanded)
const API_CALL_IDENTIFIERS = [
    'fetch', 
    'axios.get', 
    'axios.post', 
    'axios.put', 
    'axios.delete', 
    'app.get', 
    'app.post', 
    'app.put', 
    'app.delete', 
    'router.get', 
    'router.post'
];

module.exports = {
    pointToLocation,
    getNodeText,
    getCodeLocation,
    API_CALL_IDENTIFIERS
};