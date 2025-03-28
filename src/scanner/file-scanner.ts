import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import config from '../config';
import { createContextLogger } from '../utils/logger';
import { FileSystemError } from '../utils/errors';
import micromatch from 'micromatch'; // Use micromatch for better glob pattern matching
import { Dirent } from 'fs'; // Import Dirent from core 'fs'

const logger = createContextLogger('FileScanner');

/**
 * File information interface
 */
export interface FileInfo {
  path: string; // Normalized, absolute path
  name: string; // Base name (e.g., 'index.ts')
  extension: string; // Lowercase extension (e.g., '.ts')
  size: number; // In bytes
  lastModified: Date;
  hash: string; // MD5 hash of content (consider SHA1/SHA256 for less collision risk if needed)
}

/**
 * Scanner result interface
 */
export interface ScanResult {
  files: FileInfo[];
  directories: { path: string; name: string }[]; // Store directories found
  errors: { path: string; error: Error }[]; // Store errors encountered
}

/**
 * Scanner options interface
 */
export interface ScannerOptions {
  extensions?: string[];
  ignorePatterns?: string[];
  maxDepth?: number;
  followSymlinks?: boolean;
}

/**
 * File Scanner class responsible for discovering files in a directory
 */
export class FileScanner {
  private options: Required<ScannerOptions>;
  private visitedPaths = new Set<string>(); // Track visited directories to prevent cycles
  private errors: { path: string; error: Error }[] = [];
  private files: FileInfo[] = [];
  private directories: { path: string; name: string }[] = [];

  /**
   * Creates a new FileScanner
   * @param options Scanner options, defaults merged with config
   */
  constructor(options: ScannerOptions = {}) {
    this.options = {
      extensions: options.extensions || config.files.extensions,
      ignorePatterns: options.ignorePatterns || config.files.ignorePatterns,
      maxDepth: options.maxDepth === undefined ? config.analysis.maxDepth : options.maxDepth,
      followSymlinks: options.followSymlinks === undefined ? config.analysis.followSymlinks : options.followSymlinks,
    };
    // Ensure extensions start with a dot and are lowercase
    this.options.extensions = this.options.extensions.map(ext =>
        (ext.startsWith('.') ? ext : `.${ext}`).toLowerCase()
    );
    logger.debug('FileScanner initialized', { options: this.options });
  }

  /**
   * Scans a directory for files based on configured options.
   * @param directoryPath Path to scan (absolute or relative to CWD)
   * @returns Promise resolving to a scan result
   */
  async scan(directoryPath: string): Promise<ScanResult> {
    const absolutePath = path.resolve(directoryPath); // Ensure absolute path
    logger.info(`Starting scan of directory: ${absolutePath}`);

    // Reset state for a new scan
    this.visitedPaths.clear();
    this.errors = [];
    this.files = [];
    this.directories = [];

    try {
      const stats = await fs.stat(absolutePath);
      if (!stats.isDirectory()) {
        throw new FileSystemError(`Path is not a directory: ${absolutePath}`);
      }

      await this.scanDirectory(absolutePath, 0);

      logger.info(`Scan completed: ${this.files.length} files, ${this.directories.length} directories found. Encountered ${this.errors.length} errors.`);

      return {
        files: this.files,
        directories: this.directories,
        errors: this.errors,
      };
    } catch (error) {
      const wrappedError = error instanceof Error ? error : new Error(String(error));
      logger.error(`Failed to scan directory: ${absolutePath}`, { error: wrappedError });
      throw new FileSystemError(`Failed to scan directory: ${absolutePath}`, {
        originalError: wrappedError.message,
      });
    }
  }

  /**
   * Recursively scans a directory.
   * @param dirPath Absolute directory path to scan
   * @param depth Current recursion depth
   */
  private async scanDirectory(dirPath: string, depth: number): Promise<void> {
    // Normalize path for consistent checking
    const normalizedPath = path.normalize(dirPath);

    // Check max depth and visited paths
    if (depth > this.options.maxDepth || this.visitedPaths.has(normalizedPath)) {
      return;
    }
    this.visitedPaths.add(normalizedPath);

    // Check against ignore patterns before reading
    if (this.shouldIgnore(normalizedPath, true)) { // Pass isDirectory=true
        logger.debug(`Ignoring directory based on pattern: ${normalizedPath}`);
        return;
    }

    // Add directory to results
    this.directories.push({ path: normalizedPath, name: path.basename(normalizedPath) });

    let entries: Dirent[] = [];
 // Use imported Dirent type
    try {
      entries = await fs.readdir(normalizedPath, { withFileTypes: true });
    } catch (dirError: any) {
      // Log permission errors etc., but continue scanning other directories
      this.errors.push({ path: normalizedPath, error: dirError });
      logger.warn(`Error reading directory: ${normalizedPath}`, { code: dirError.code, message: dirError.message });
      return; // Stop processing this directory if it can't be read
    }

    for (const entry of entries) {
      const entryPath = path.join(normalizedPath, entry.name);

      // Check ignore patterns for the specific entry
      if (this.shouldIgnore(entryPath, entry.isDirectory())) { // Pass isDirectory flag
         logger.debug(`Ignoring entry based on pattern: ${entryPath}`);
         continue;
      }

      try {
        if (entry.isDirectory()) {
          await this.scanDirectory(entryPath, depth + 1);
        } else if (entry.isFile()) {
          const fileInfo = await this.processFile(entryPath);
          if (fileInfo) {
            this.files.push(fileInfo);
          }
        } else if (entry.isSymbolicLink() && this.options.followSymlinks) {
          await this.handleSymbolicLink(entryPath, depth);
        }
      } catch (entryError: any) {
        // Log errors processing specific entries but continue
        this.errors.push({ path: entryPath, error: entryError });
        logger.warn(`Error processing entry: ${entryPath}`, { code: entryError.code, message: entryError.message });
      }
    }
  }

  /**
   * Processes a file, getting its info if it matches criteria.
   * @param filePath Absolute path to the file
   * @returns FileInfo object or null if skipped
   */
  private async processFile(filePath: string): Promise<FileInfo | null> {
    const extension = path.extname(filePath).toLowerCase();
    if (!this.options.extensions.includes(extension)) {
      return null; // Skip file if extension doesn't match
    }

    try {
      const stats = await fs.stat(filePath);
      // Simple hash for basic change detection - consider more robust methods if needed
      const content = await fs.readFile(filePath);
      const hash = crypto.createHash('md5').update(content).digest('hex');

      return {
        path: filePath,
        name: path.basename(filePath),
        extension: extension,
        size: stats.size,
        lastModified: stats.mtime,
        hash: hash,
      };
    } catch (fileError: any) {
      this.errors.push({ path: filePath, error: fileError });
      logger.warn(`Error processing file: ${filePath}`, { code: fileError.code, message: fileError.message });
      return null;
    }
  }

  /**
   * Handles symbolic links based on options.
   * @param linkPath Absolute path to the symbolic link
   * @param depth Current recursion depth
   */
  private async handleSymbolicLink(linkPath: string, depth: number): Promise<void> {
     try {
        const targetPath = await fs.readlink(linkPath);
        // Resolve target relative to the link's directory
        const resolvedPath = path.resolve(path.dirname(linkPath), targetPath);
        const targetStats = await fs.stat(resolvedPath); // Use stat to follow the link

        if (targetStats.isDirectory()) {
            await this.scanDirectory(resolvedPath, depth + 1); // Recurse into linked directory
        } else if (targetStats.isFile()) {
            const fileInfo = await this.processFile(resolvedPath); // Process linked file
            if (fileInfo) {
                this.files.push(fileInfo);
            }
        }
     } catch (symlinkError: any) {
        this.errors.push({ path: linkPath, error: symlinkError });
        logger.warn(`Failed to process symlink: ${linkPath}`, { code: symlinkError.code, message: symlinkError.message });
     }
  }


  /**
   * Checks if a given path should be ignored based on configured patterns.
   * Uses micromatch for robust glob pattern matching.
   * @param filePath Absolute path to check
   * @returns True if the path should be ignored
   */
  private shouldIgnore(filePath: string, isDirectory: boolean): boolean {
    // Normalize path separators for consistent matching
    const normalizedPath = filePath.replace(/\\/g, '/');
    // Use micromatch for better glob support
    // Append '/' to directory paths for directory-specific matching (e.g., 'node_modules/')
    const pathToCheck = isDirectory ? `${normalizedPath}/` : normalizedPath;
    return micromatch.isMatch(pathToCheck, this.options.ignorePatterns, { dot: true, matchBase: true });
  }
}

// Export singleton instance for convenience if needed, or allow instantiation
export default new FileScanner();