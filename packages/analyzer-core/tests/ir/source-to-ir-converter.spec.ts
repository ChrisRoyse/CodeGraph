import { describe, it, expect, vi } from 'vitest';
import { convertSourceToIr } from '../../src/ir/source-to-ir-converter';
import { Language, FileIr } from '../../src/ir/schema'; // Added FileIr import
import * as tsConverter from '../../src/ir/converters/typescript-converter';
import * as pyConverter from '../../src/ir/converters/python-converter';
// Import other converters as needed

// Mock the language-specific converters
vi.mock('../../src/ir/converters/typescript-converter');
vi.mock('../../src/ir/converters/python-converter');
// Mock other converters similarly

describe('SourceToIrConverter', () => {
  const sampleFilePath = 'src/app.ts';
  const sampleSourceCode = 'const x = 1;';
  const testProjectId = 'test-project-id'; // Define a project ID for tests

  it('should be callable and return a FileIr object', async () => { // Updated description
    // Arrange
    // Mock to return a minimal FileIr object
   const mockFileIr: FileIr = {
       schemaVersion: '1.0', projectId: testProjectId, fileId: 'test-id', filePath: sampleFilePath,
       language: Language.TypeScript, elements: [], potentialRelationships: []
    };
    const mockTsConvert = vi.spyOn(tsConverter, 'convertToIr').mockResolvedValue(mockFileIr);

    // Act
    const result = await convertSourceToIr(sampleFilePath, sampleSourceCode, Language.TypeScript, testProjectId);

    // Assert
    expect(result).toBeDefined();
    expect(result.filePath).toBe(sampleFilePath); // Check if it looks like FileIr
    expect(result.elements).toBeInstanceOf(Array);
    expect(result.potentialRelationships).toBeInstanceOf(Array);
    expect(mockTsConvert).toHaveBeenCalledOnce();
    expect(mockTsConvert).toHaveBeenCalledWith(sampleSourceCode, sampleFilePath, testProjectId); // Check argument order including projectId
  });

  it('should dispatch to the correct converter based on language (TypeScript)', async () => {
    // Arrange
   const mockFileIr: FileIr = {
       schemaVersion: '1.0', projectId: testProjectId, fileId: 'test-id', filePath: sampleFilePath,
       language: Language.TypeScript, elements: [], potentialRelationships: []
    };
    const mockTsConvert = vi.spyOn(tsConverter, 'convertToIr').mockResolvedValue(mockFileIr);
    const mockPyConvert = vi.spyOn(pyConverter, 'convertToIr'); // No mock implementation needed, just check if called

    // Act
    await convertSourceToIr(sampleFilePath, sampleSourceCode, Language.TypeScript, testProjectId);

    // Assert
    expect(mockTsConvert).toHaveBeenCalledOnce();
    expect(mockPyConvert).not.toHaveBeenCalled();
  });

  it('should dispatch to the correct converter based on language (Python)', async () => {
    // Arrange
    const mockTsConvert = vi.spyOn(tsConverter, 'convertToIr'); // Corrected function name
    // Declare python variables before use
    const pythonFilePath = 'src/main.py';
    const pythonSourceCode = 'def main():\n  pass';
    const mockFileIr: FileIr = {
        schemaVersion: '1.0', projectId: testProjectId, fileId: 'test-id-py', filePath: pythonFilePath,
        language: Language.Python, elements: [], potentialRelationships: []
    };
    const mockPyConvert = vi.spyOn(pyConverter, 'convertToIr').mockResolvedValue(mockFileIr);

    // Act
    await convertSourceToIr(pythonFilePath, pythonSourceCode, Language.Python, testProjectId);

    // Assert
    expect(mockPyConvert).toHaveBeenCalledOnce();
    expect(mockPyConvert).toHaveBeenCalledWith(pythonSourceCode, pythonFilePath, testProjectId); // Check argument order including projectId
    expect(mockTsConvert).not.toHaveBeenCalled();
  });

  it('should return a minimal FileIr if no converter is found for the language', async () => { // Updated description
     // Arrange
     const unsupportedLanguage = 'UnsupportedLang' as Language; // Simulate unsupported

     // Act
     const result = await convertSourceToIr(sampleFilePath, sampleSourceCode, unsupportedLanguage, testProjectId);

     // Assert
     expect(result).toBeDefined();
     expect(result.filePath).toBe(sampleFilePath);
     expect(result.elements).toEqual([]);
     expect(result.potentialRelationships).toEqual([]);
     // Optionally, check for a warning log if implemented
  });

   it('should handle errors during conversion gracefully (e.g., return minimal FileIr)', async () => { // Updated description
    // Arrange
    const error = new Error('Mock conversion failed');
    const mockTsConvert = vi.spyOn(tsConverter, 'convertToIr').mockRejectedValue(error); // Corrected function name

    // Act
    const result = await convertSourceToIr(sampleFilePath, sampleSourceCode, Language.TypeScript, testProjectId);

    // Assert
    expect(result).toBeDefined();
    expect(result.filePath).toBe(sampleFilePath);
    expect(result.elements).toEqual([]);
    expect(result.potentialRelationships).toEqual([]);
    expect(mockTsConvert).toHaveBeenCalledOnce();
    // Optionally, check if the error was logged
  });

  // TODO: Add tests for other supported languages (SQL, Java, etc.) when mocks are added
});