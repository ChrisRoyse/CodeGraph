import fsPromises from 'fs/promises';
import fs, { Dirent } from 'fs'; // Import fs and Dirent type
import path from 'path';
import micromatch from 'micromatch'; // For glob pattern matching
import { createContextLogger } from '../utils/logger.js';
import { FileSystemError } from '../utils/errors.js';
import { config } from '../config/index.js'; // Use named import

const logger = createContextLogger('FileScanner');

/**
 * Represents basic information about a scanned file.
 */
interface FileInfo {
    /** Absolute path to the file. */
    path: string;
    /** File name. */
    name: string;
    /** File extension (including the dot). */
    extension: string;
        /** Detected language (added during analysis). */
        language?: string; // Make optional as it's added later
}

/**
 * Scans a directory recursively for files matching specified extensions,
 * respecting ignore patterns.
 */
class FileScanner {
    private readonly targetDirectory: string;
    private readonly extensions: string[];
    private readonly combinedIgnorePatterns: string[]; // Store the final combined list

    /**
     * Creates an instance of FileScanner.
     * @param targetDirectory - The absolute path to the directory to scan.
     * @param extensions - An array of file extensions to include (e.g., ['.ts', '.js']).
     * @param userIgnorePatterns - An array of glob patterns to ignore.
     */
    constructor(targetDirectory: string, extensions: string[], userIgnorePatterns: string[] = []) {
        if (!path.isAbsolute(targetDirectory)) {
            throw new FileSystemError('FileScanner requires an absolute target directory path.');
        }
        this.targetDirectory = targetDirectory;
        this.extensions = extensions.map(ext => ext.startsWith('.') ? ext : `.${ext}`);

        let baseIgnorePatterns = [...config.ignorePatterns];
        const isScanningFixtures = targetDirectory.includes('__tests__');
        if (isScanningFixtures) {
            baseIgnorePatterns = baseIgnorePatterns.filter(pattern => pattern !== '**/__tests__/**');
        }

        const combinedPatterns = new Set([...baseIgnorePatterns, ...userIgnorePatterns]);
        this.combinedIgnorePatterns = Array.from(combinedPatterns);

        logger.debug('FileScanner initialized', { targetDirectory, extensions: this.extensions, combinedIgnorePatterns: this.combinedIgnorePatterns });
    }

    /**
     * Performs the recursive file scan.
     * @returns A promise that resolves to an array of FileInfo objects.
     * @throws {FileSystemError} If the target directory cannot be accessed.
     */
    async scan(): Promise<FileInfo[]> {
        logger.info(`Starting scan of directory: ${this.targetDirectory}`);
        const foundFiles: FileInfo[] = [];
        let scannedCount = 0;
        let errorCount = 0;

        try {
            await this.scanDirectoryRecursive(this.targetDirectory, foundFiles, (count) => scannedCount = count, (count) => errorCount = count);
            logger.info(`Scan completed: ${foundFiles.length} files matching criteria found. Scanned ${scannedCount} total items. Encountered ${errorCount} errors.`);
            return foundFiles;
        } catch (error: any) {
            logger.error(`Failed to scan directory: ${this.targetDirectory}`, { message: error.message });
            throw new FileSystemError(`Failed to scan directory: ${this.targetDirectory}`, { originalError: error });
        }
    }

    /**
     * Recursive helper function to scan directories.
     */
    private async scanDirectoryRecursive(
        currentPath: string,
        foundFiles: FileInfo[],
        updateScannedCount: (count: number) => void,
        updateErrorCount: (count: number) => void,
        currentScannedCount: number = 0,
        currentErrorCount: number = 0
    ): Promise<void> {
        let localScannedCount = currentScannedCount;
        let localErrorCount = currentErrorCount;

        if (this.isIgnored(currentPath)) {
            logger.debug(`Ignoring path (pre-check): ${currentPath}`);
            return;
        }

        let entries: Dirent[];
        try {
            entries = await fsPromises.readdir(currentPath, { withFileTypes: true });
             localScannedCount += entries.length;
            updateScannedCount(localScannedCount);
        } catch (error: any) {
            logger.warn(`Cannot read directory, skipping: ${currentPath}`, { code: error.code });
            localErrorCount++;
            updateErrorCount(localErrorCount);
            return;
        }

        for (const entry of entries) {
            const entryPath = path.join(currentPath, entry.name);

            if (this.isIgnored(entryPath)) {
                logger.debug(`Ignoring path (entry check): ${entryPath}`);
                continue;
            }

            if (entry.isDirectory()) {
                await this.scanDirectoryRecursive(entryPath, foundFiles, updateScannedCount, updateErrorCount, localScannedCount, localErrorCount);
            } else if (entry.isFile()) {
                const extension = path.extname(entry.name).toLowerCase();
                if (this.extensions.includes(extension)) {
                    foundFiles.push({
                        path: entryPath.replace(/\\/g, '/'), // Normalize path separators
                        name: entry.name,
                        extension: extension,
                    });
                }
            }
        }
    }

    /**
     * Checks if a given path should be ignored based on configured patterns.
     * Uses micromatch for robust glob pattern matching.
     * @param filePath - Absolute path to check.
     * @returns True if the path should be ignored, false otherwise.
     */
    private isIgnored(filePath: string): boolean {
        const normalizedPath = filePath.replace(/\\/g, '/');
        const isMatch = micromatch.isMatch(normalizedPath, this.combinedIgnorePatterns);
        return isMatch;
    }

    /**
     * Public method to check if a file path is both supported (by extension)
     * and not ignored (by pattern).
     * @param filePath - Absolute path to the file.
     * @returns True if the file should be processed, false otherwise.
     */
    public isSupportedAndNotIgnored(filePath: string): boolean {
        if (this.isIgnored(filePath)) {
            return false; // Ignored by pattern
        }
        const extension = path.extname(filePath).toLowerCase();
        if (!this.extensions.includes(extension)) {
            return false; // Unsupported extension
        }
        return true; // Supported and not ignored
    }
}

// Export using ESM syntax
export { FileScanner }; // Export the class value
export type { FileInfo }; // Export the interface type separately