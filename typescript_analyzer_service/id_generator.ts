// typescript_analyzer_service/id_generator.ts
import * as crypto from 'crypto';
import * as path from 'path';

/**
 * Normalizes a file path for consistency.
 * - Uses forward slashes.
 * - Removes leading './'.
 * - Converts to lowercase.
 * @param filePath - The original file path.
 * @returns The normalized file path.
 */
export function normalizePath(filePath: string | undefined | null): string {
  if (!filePath) return '';
  let normalized = filePath.replace(/\\/g, '/'); // Convert backslashes to forward slashes
  if (normalized.startsWith('./')) {
    normalized = normalized.substring(2);
  }
  return normalized.toLowerCase(); // Ensure consistent case
}

/**
 * Generates a SHA-256 hash of the input string.
 * @param inputString - The string to hash.
 * @returns The hexadecimal SHA-256 hash.
 */
export function sha256(inputString: string): string {
  return crypto.createHash('sha256').update(inputString, 'utf8').digest('hex');
}

/**
 * Generates the Global ID for a code element.
 * Format: lang:sha256(normalized_relative_path:canonical_identifier)
 * @param language - The language identifier (e.g., 'typescript').
 * @param relativePath - The file path relative to the project root.
 * @param canonicalIdentifier - The unique identifier for the element within the file.
 * @returns The generated Global ID.
 */
export function generateGlobalId(language: string, relativePath: string, canonicalIdentifier: string): string {
  const normalized = normalizePath(relativePath);
  const inputString = `${normalized}:${canonicalIdentifier}`;
  const hash = sha256(inputString);
  return `${language}:${hash}`;
}

/**
 * Creates the canonical identifier string for a file node.
 * @param normalizedRelativePath - The normalized file path.
 * @returns The canonical identifier for the file.
 */
export function createCanonicalFile(normalizedRelativePath: string): string {
  // Path is included in the GID hash input, so just need a type marker.
  return "file";
}

/**
 * Creates the canonical identifier string for a function/method.
 * @param functionName - The name of the function/method.
 * @param parameters - An array of parameter names or types (as strings).
 * @param [className] - The name of the enclosing class, if any.
 * @returns The canonical identifier.
 */
export function createCanonicalFunction(functionName: string, parameters: string[], className?: string | null): string {
    // Use parameter count for robustness against renaming
    const paramCount = parameters.length;
    if (className) {
        // Member Method
        return `method:${className}.${functionName}(#${paramCount})`;
    }
    // Module/File level Function
    return `func:${functionName}(#${paramCount})`;
}

/**
 * Creates the canonical identifier string for a class or interface.
 * @param name - The name of the class/interface.
 * @returns The canonical identifier.
 */
export function createCanonicalClassOrInterface(name: string): string {
    // Format: type:TypeName
    return `type:${name}`;
}

/**
 * Creates the canonical identifier string for a variable/property within a scope.
 * @param variableName - The name of the variable/property.
 * @param [scopeIdentifier] - The canonical identifier of the enclosing scope (function/method/class/interface), or null for file/module scope.
 * @returns The canonical identifier.
 */
// Note: We need the normalized path for module-level vars if we align fully with Python.
// For now, let's keep the simpler TS version but add prefixes.
// TODO: Revisit if module-level variable collisions become an issue across files.
export function createCanonicalVariable(variableName: string, scopeIdentifier?: string | null): string {
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
 * @param importedIdentifier - A representative name for what's imported (e.g., default name, namespace, joined named imports).
 * @param sourcePath - The source module path (e.g., 'react', './utils').
 * @returns The canonical identifier.
 */
export function createCanonicalImport(importedIdentifier: string, sourcePath: string): string {
    // Normalize source path slightly for consistency if needed
    const normalizedSource = sourcePath.replace(/['"]/g, ''); // Remove quotes
    // Use @ as separator, matching Python
    return `import:${importedIdentifier}@${normalizedSource}`;
}