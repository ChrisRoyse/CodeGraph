/**
 * @file Orchestrates the conversion of source code from various languages into the standardized IR.
 */

import { FileIr, Language } from './schema.js'; // Import types/values directly

// Import converters using ESM syntax
import { convertToIr as convertTypeScriptToIr } from './converters/typescript-converter.js';
import { convertToIr as convertPythonToIr } from './converters/python-converter.js'; // Enabled Python converter
import { convertToIr as convertSqlToIr } from './converters/sql-converter.js';
// import { convertJavaToIr } from './converters/java-converter.js'; // Not implemented yet
// Import other converters as they are implemented

/**
 * Interface for language-specific converters.
 */
interface ILanguageConverter {
  (sourceCode: string, filePath: string, projectId: string): Promise<FileIr>; // Added projectId
}

/**
 * Selects the appropriate converter based on the language and converts source code to IR entities.
 *
 * @param sourceCode The source code content.
 * @param filePath The path to the source file.
 * @param language The language of the source code.
 * @returns A promise that resolves to an array of IR entities.
 * @throws Error if no suitable converter is found for the language.
 */
async function convertSourceToIr(
  filePath: string,
  sourceCode: string,
  language: Language,
  projectId: string // Added projectId
): Promise<FileIr> {
  console.log(`Converting ${filePath} (${language}) to IR...`); // Basic logging

  let converter: ILanguageConverter | null = null; // Use interface type directly

  switch (language) {
    case Language.TypeScript:
    case Language.JavaScript: // Assuming TS converter handles JS for now
      converter = convertTypeScriptToIr;
      break;
    case Language.Python: // Enabled Python converter
      converter = convertPythonToIr;
      break;
    case Language.SQL: // Enabled SQL converter
      converter = convertSqlToIr;
      break;
    // case Language.Java: // Commented out: Not implemented yet
    //   converter = convertJavaToIr;
    //   break;
    // Add cases for other supported languages
    default:
      console.warn(`No specific IR converter found for language: ${language}. Skipping file: ${filePath}`);
      // Return a minimal FileIr for skipped files
      return {
        schemaVersion: '1.0', // Use a constant or import from schema if defined
        projectId: projectId, // Use passed projectId
        fileId: `connectome://${projectId}/file:${filePath}`, // Use passed projectId
        filePath: filePath,
        language: language,
        elements: [],
        potentialRelationships: [],
      };
      // Or throw an error: throw new Error(`Unsupported language for IR conversion: ${language}`);
  }

  if (!converter) {
     // This case should ideally be handled by the default case, but added for safety.
     console.warn(`Converter function is null for language: ${language}. Skipping file: ${filePath}`);
     // Return a minimal FileIr for skipped files
     return {
        schemaVersion: '1.0',
       projectId: projectId, // Use passed projectId
       fileId: `connectome://${projectId}/file:${filePath}`, // Use passed projectId
        filePath: filePath,
        language: language,
        elements: [],
        potentialRelationships: [],
      };
  }

  try {
    // Pass arguments in the order expected by the specific converter functions
    // Assuming converters expect (filePath, sourceCode) based on test mocks
    const fileIr = await converter(sourceCode, filePath, projectId); // Pass projectId
    console.log(`Successfully converted ${filePath} to IR (${fileIr.elements.length} elements, ${fileIr.potentialRelationships.length} potential relationships).`);
    // TODO: Add ID generation step here or within each converter?
    // For now, assume converters handle basic structure. ID generation is Task 4.
    // TODO: Add project ID properly
    // fileIr.projectId should be set correctly by the converter now
    return fileIr;
  } catch (error) {
    console.error(`Error converting ${filePath} to IR:`, error);
    // Return a minimal FileIr on error
    return {
        schemaVersion: '1.0',
        projectId: projectId, // Use passed projectId
        fileId: `connectome://${projectId}/file:${filePath}`, // Use passed projectId
        filePath: filePath,
        language: language,
        elements: [],
        potentialRelationships: [],
      };
  }
}

// Export using ESM syntax
export { convertSourceToIr };