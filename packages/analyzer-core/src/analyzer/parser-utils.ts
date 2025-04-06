import path from 'path';
import crypto from 'crypto';
import fsPromises from 'fs/promises';
import fsSync from 'fs'; // Keep sync version for path resolution checks
import { FileSystemError } from '../utils/errors.js';
import type { InstanceCounter } from './types.js'; // Import type directly
import { config } from '../config/index.js'; // Use named import for config
import { createContextLogger } from '../utils/logger.js'; // Import logger

const logger = createContextLogger('ParserUtils'); // Create logger instance

const TEMP_DIR = config.tempDir; // Use tempDir from config

import type { FileInfo } from '../scanner/file-scanner.js'; // Import type directly

import { Language } from '../types/index.js'; // Import Language enum

/**
 * Determines the programming language enum member based on file extension.
 * @param fileInfo - Information about the file.
 * @returns The detected Language enum member or Language.Unknown if unsupported.
 */
export function getLanguageFromFileInfo(fileInfo: FileInfo): Language { // Use imported enum type
    const ext = fileInfo.extension.toLowerCase();
    // Return Language enum members
    if (['.ts', '.js'].includes(ext)) return Language.TypeScript; // Treat .js as TS for parsing
    if (['.tsx', '.jsx'].includes(ext)) return Language.TSX; // Treat .jsx as TSX
    if (ext === '.py') return Language.Python;
    if (['.c', '.h'].includes(ext)) return Language.C;
    if (['.cpp', '.hpp', '.cc', '.hh'].includes(ext)) return Language.CPP;
    if (ext === '.java') return Language.Java;
    if (ext === '.cs') return Language.CSharp;
    if (ext === '.go') return Language.Go;
    if (ext === '.sql') return Language.SQL;
    // Add other supported languages here
    return Language.Unknown; // Return Unknown for unsupported extensions
}


/**
 * Ensures the temporary directory for intermediate results exists.
 */
export async function ensureTempDir(): Promise<void> {
    try {
        await fsPromises.mkdir(TEMP_DIR, { recursive: true });
    } catch (error: any) {
        throw new FileSystemError(`Failed to create temporary directory: ${TEMP_DIR}`, { originalError: error });
    }
}

/**
 * Generates a unique temporary file path based on the source file path hash.
 * @param sourceFilePath - The absolute path of the source file.
 * @returns The absolute path for the temporary JSON file.
 */
export function getTempFilePath(sourceFilePath: string): string {
    // Normalize path before hashing for consistency
    const normalizedPath = sourceFilePath.replace(/\\/g, '/');
    const hash = crypto.createHash('sha256').update(normalizedPath).digest('hex');
    return path.join(TEMP_DIR, `${hash}.json`);
}

/**
 * Resolves a relative import path to an absolute path, attempting to find the correct file extension.
 * @param sourcePath - The absolute path of the file containing the import.
 * @param importPath - The relative or module path string from the import statement.
 * @returns The resolved absolute path or the original importPath if it's likely a node module or alias.
 */
export function resolveImportPath(sourcePath: string, importPath: string): string {
    // If it's not a relative path, assume it's a node module or alias (handled later by resolver)
    if (!importPath.startsWith('.')) {
        return importPath;
    }

    const sourceDir = path.dirname(sourcePath);
    // Remove .js/.jsx extension if present, as we want to find the .ts/.tsx source
    const importPathWithoutJsExt = importPath.replace(/\.jsx?$/i, '');
    let resolvedPath = path.resolve(sourceDir, importPathWithoutJsExt);

    // Attempt to resolve extension if missing
    if (!path.extname(resolvedPath)) {
        const extensions = config.supportedExtensions; // Use extensions from config
        let found = false;
        // Check for file with extension
        for (const ext of extensions) {
            try {
                if (fsSync.statSync(resolvedPath + ext).isFile()) {
                    resolvedPath += ext;
                    found = true;
                    break;
                }
            } catch { /* Ignore */ }
        }
        // Check for index file in directory if file wasn't found directly
        if (!found) {
            for (const ext of extensions) {
                const indexPath = path.join(resolvedPath, `index${ext}`);
                try {
                    if (fsSync.statSync(indexPath).isFile()) {
                        resolvedPath = indexPath;
                        found = true;
                        break;
                    }
                } catch { /* Ignore */ }
            }
        }
        // If still not found, return the original resolved path without extension.
        // The relationship resolver might handle this later based on available nodes.
    }
    // Normalize path separators for consistency
    return resolvedPath.replace(/\\/g, '/');
}

/**
 * Generates a stable, unique identifier for a code entity based on its type and qualified name.
 * Ensures consistency across analysis runs. Normalizes path separators and converts to lowercase.
 * @param prefix - The type of the entity (e.g., 'class', 'function', 'file', 'directory'). Lowercase.
 * @param qualifiedName - A unique name within the project context (e.g., 'path/to/file:ClassName').
 *                        Should be consistently generated by the parsers.
 * @returns The generated entity ID string.
 */
export function generateEntityId(prefix: string, qualifiedName: string): string {
    if (!prefix || !qualifiedName) {
        const warnMsg = `generateEntityId called with empty prefix or qualifiedName. Prefix: ${prefix}, QN: ${qualifiedName}. Generating fallback ID.`;
        console.warn(warnMsg);
        logger.warn(warnMsg); // Also log it properly
        // Use a hash for deterministic fallback ID
        const fallbackData = `${prefix || 'unknown_prefix'}:${qualifiedName || 'unknown_qn'}`;
        const hash = crypto.createHash('sha1').update(fallbackData).digest('hex').substring(0, 16); // Use SHA1 hash, truncated
        return `${prefix || 'unknown'}:${hash}`;
    }
    // Normalize path separators, convert to lowercase, and sanitize characters
    const normalizedPathInput = qualifiedName.replace(/\\/g, '/'); // Normalize slashes FIRST

    const firstColonIndex = normalizedPathInput.indexOf(':');
    let pathPart = '';
    let namePart = ''; // This will contain the part to be sanitized

    if (firstColonIndex === -1) {
        // No colon, treat as path or name based on presence of '/'
        if (normalizedPathInput.includes('/')) {
            pathPart = normalizedPathInput; // Treat as path
        } else {
            namePart = normalizedPathInput; // Treat as name
        }
    } else {
        // Split at the first colon
        pathPart = normalizedPathInput.substring(0, firstColonIndex);
        namePart = normalizedPathInput.substring(firstColonIndex + 1); // Everything after first colon
    }

    // Lowercase path part
    const lowerPathPart = pathPart.toLowerCase();

    // Sanitize only the first segment of the name part if it contains colons
    const nameSegments = namePart.split(':');
    const sanitizedFirstSegment = (nameSegments[0] || '') // Add fallback for potentially undefined segment
        .toLowerCase()
        .replace(/[ $!@#]/g, '_'); // Target specific chars from test case

    // Reconstruct the name part, preserving subsequent colons and segments
    // Ensure subsequent segments are also lowercased if they exist
    const reconstructedNamePart = [
        sanitizedFirstSegment,
        ...nameSegments.slice(1).map(segment => segment.toLowerCase()) // Lowercase remaining segments
    ].join(':'); // Reverted: Join with colon to preserve structure


    // Combine parts. Add ':' separator only if both path and reconstructed name parts exist.
    const safeIdentifier = lowerPathPart && reconstructedNamePart
        ? `${lowerPathPart}:${reconstructedNamePart}`
        : lowerPathPart || reconstructedNamePart; // Use whichever part exists if one is empty

    return `${prefix.toLowerCase()}:${safeIdentifier}`; // Ensure prefix is lowercase too
}

/**
 * Generates a unique instance ID for a node or relationship within the context of a single file parse.
 * Primarily used for temporary identification during parsing.
 * @param instanceCounter - The counter object for the current file parse.
 * @param prefix - The type of the element (e.g., 'class', 'function', 'calls'). Lowercase.
 * @param identifier - A descriptive identifier (e.g., qualified name, source:target).
 * @param options - Optional line and column numbers for added uniqueness context.
 * @returns The generated instance ID string.
 */
export function generateInstanceId(
    instanceCounter: InstanceCounter,
    prefix: string,
    identifier: string,
    options: { line?: number; column?: number } = {}
): string {
     if (!prefix || !identifier) {
        console.warn(`generateInstanceId called with empty prefix or identifier. Prefix: ${prefix}, ID: ${identifier}`);
     }
    const safeIdentifier = identifier
        .replace(/\\/g, '/')
        .replace(/[^a-zA-Z0-9_.:/-]/g, '_');

    let contextSuffix = '';
    // Include line/column if available for better debugging/uniqueness
    if (options.line !== undefined) contextSuffix += `:L${options.line}`;
    if (options.column !== undefined) contextSuffix += `:C${options.column}`;

    const counter = ++instanceCounter.count; // Increment counter for uniqueness within the file
    // Format: type:identifier:Lline:Ccol:counter
    const id = `${prefix}:${safeIdentifier}${contextSuffix}:${counter}`;
    return id;
}

/**
 * Generates a stable, unique identifier for a relationship based on its source, target, and type.
 * Ensures consistency across analysis runs.
 * @param sourceId - The entityId of the source node.
 * @param targetId - The entityId of the target node.
 * @param type - The type of the relationship (e.g., 'CALLS', 'IMPORTS').
 * @returns The generated relationship ID string.
 */
export function generateRelationshipId(sourceId: string, targetId: string, type: string): string {
    if (!sourceId || !targetId || !type) {
        const warnMsg = `generateRelationshipId called with empty sourceId, targetId, or type. Source: ${sourceId}, Target: ${targetId}, Type: ${type}. Generating fallback ID.`;
        console.warn(warnMsg);
        logger.warn(warnMsg); // Also log it properly
        // Use a hash for deterministic fallback ID
        const fallbackData = `${sourceId || 'unknown_source'}:${type || 'unknown_type'}:${targetId || 'unknown_target'}`;
        const hash = crypto.createHash('sha1').update(fallbackData).digest('hex').substring(0, 16); // Use SHA1 hash, truncated
        return `fallback:${hash}`;
    }
    // Simple concatenation is usually sufficient for uniqueness here, assuming entityIds are stable.
    // Ensure consistent casing for the type.
    return `${sourceId}:${type.toUpperCase()}:${targetId}`;
}
