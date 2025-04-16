/**
 * Tests for the ID Logic Module
 * 
 * This file contains unit tests for the ID generation and parsing functions.
 */

import {
  normalizePath,
  validateEntityType,
  sanitizeName,
  formatParameters,
  determineLanguagePrefix,
  generateCanonicalId,
  generateGid,
  generateId,
  parseCanonicalId,
  parseGid,
  parseId,
  EntityType
} from './id-logic';

// Helper function to run a test and log the result
function runTest(name: string, test: () => boolean): void {
  try {
    const result = test();
    console.log(`${result ? '✓' : '✗'} ${name}`);
    if (!result) {
      throw new Error(`Test failed: ${name}`);
    }
  } catch (error) {
    console.error(`✗ ${name} - Error:`, error);
    throw error;
  }
}

// Test normalizePath
runTest('normalizePath should handle Windows paths', () => {
  const result = normalizePath('path\\to\\file.js');
  return result === 'path/to/file.js';
});

runTest('normalizePath should remove leading and trailing slashes', () => {
  const result = normalizePath('/path/to/file.js/');
  return result === 'path/to/file.js';
});

runTest('normalizePath should normalize double slashes', () => {
  const result = normalizePath('path//to///file.js');
  return result === 'path/to/file.js';
});

// Test validateEntityType
runTest('validateEntityType should normalize entity type case', () => {
  const result = validateEntityType('function');
  return result === 'Function';
});

runTest('validateEntityType should throw for invalid entity types', () => {
  try {
    validateEntityType('invalidType');
    return false; // Should not reach here
  } catch (error) {
    return true; // Expected to throw
  }
});

// Test sanitizeName
runTest('sanitizeName should replace invalid characters', () => {
  const result = sanitizeName('my-function!@#');
  return result === 'my_function___';
});

runTest('sanitizeName should preserve valid characters', () => {
  const result = sanitizeName('myFunction123_$');
  return result === 'myFunction123_$';
});

// Test formatParameters
runTest('formatParameters should format parameter types', () => {
  const result = formatParameters(['string', 'number', 'boolean']);
  return result === '(string,number,boolean)';
});

runTest('formatParameters should handle empty arrays', () => {
  const result = formatParameters([]);
  return result === '';
});

runTest('formatParameters should handle undefined', () => {
  const result = formatParameters(undefined);
  return result === '';
});

// Test determineLanguagePrefix
runTest('determineLanguagePrefix should use language hint if provided', () => {
  const result = determineLanguagePrefix('file.js', 'typescript');
  return result === 'ts';
});

runTest('determineLanguagePrefix should determine from file extension', () => {
  const result = determineLanguagePrefix('file.py');
  return result === 'py';
});

runTest('determineLanguagePrefix should use default for unknown extensions', () => {
  const result = determineLanguagePrefix('file.unknown');
  return result === 'js';
});

// Test generateCanonicalId
runTest('generateCanonicalId should create basic canonical ID', () => {
  const result = generateCanonicalId({
    filePath: 'path/to/file.js',
    entityType: 'Function',
    name: 'myFunction'
  });
  return result === 'path/to/file.js::Function::myFunction';
});

runTest('generateCanonicalId should include parameters', () => {
  const result = generateCanonicalId({
    filePath: 'path/to/file.js',
    entityType: 'Function',
    name: 'myFunction',
    paramTypes: ['string', 'number']
  });
  return result === 'path/to/file.js::Function::myFunction(string,number)';
});

runTest('generateCanonicalId should include parent context', () => {
  const result = generateCanonicalId({
    filePath: 'path/to/file.js',
    entityType: 'Method',
    name: 'myMethod',
    parentCanonicalId: 'path/to/file.js::Class::MyClass'
  });
  return result === 'path/to/file.js::Class::MyClass::Method::myMethod';
});

runTest('generateCanonicalId should include parent context and parameters', () => {
  const result = generateCanonicalId({
    filePath: 'path/to/file.js',
    entityType: 'Method',
    name: 'myMethod',
    parentCanonicalId: 'path/to/file.js::Class::MyClass',
    paramTypes: ['string', 'number']
  });
  return result === 'path/to/file.js::Class::MyClass::Method::myMethod(string,number)';
});

// Test generateGid
runTest('generateGid should create GID with correct format', () => {
  const canonicalId = 'path/to/file.js::Function::myFunction';
  const result = generateGid(canonicalId, 'file.js');
  
  // Check format: language prefix + underscore + 16-char hash
  return /^js_[0-9a-f]{16}$/.test(result);
});

runTest('generateGid should use language hint', () => {
  const canonicalId = 'path/to/file.py::Function::myFunction';
  const result = generateGid(canonicalId, 'file.js', 'python');
  
  // Should start with 'py_'
  return result.startsWith('py_');
});

// Test generateId
runTest('generateId should generate both canonical ID and GID', () => {
  const result = generateId({
    filePath: 'path/to/file.js',
    entityType: 'Function',
    name: 'myFunction'
  });
  
  return (
    result.canonicalId === 'path/to/file.js::Function::myFunction' &&
    /^js_[0-9a-f]{16}$/.test(result.gid)
  );
});

runTest('generateId should throw for missing required fields', () => {
  try {
    generateId({
      filePath: '',
      entityType: 'Function',
      name: 'myFunction'
    });
    return false; // Should not reach here
  } catch (error) {
    return true; // Expected to throw
  }
});

// Test parseCanonicalId
runTest('parseCanonicalId should parse basic canonical ID', () => {
  const result = parseCanonicalId('path/to/file.js::Function::myFunction');
  
  return (
    result.filePath === 'path/to/file.js' &&
    result.entityType === 'Function' &&
    result.name === 'myFunction'
  );
});

runTest('parseCanonicalId should parse canonical ID with parameters', () => {
  const result = parseCanonicalId('path/to/file.js::Function::myFunction(string,number)');
  
  return (
    result.filePath === 'path/to/file.js' &&
    result.entityType === 'Function' &&
    result.name === 'myFunction' &&
    result.paramTypes?.length === 2 &&
    result.paramTypes[0] === 'string' &&
    result.paramTypes[1] === 'number'
  );
});

runTest('parseCanonicalId should parse canonical ID with parent context', () => {
  const result = parseCanonicalId('path/to/file.js::Class::MyClass::Method::myMethod');
  
  return (
    result.filePath === 'path/to/file.js' &&
    result.entityType === 'Method' &&
    result.name === 'myMethod' &&
    result.parentCanonicalId === 'path/to/file.js::Class::MyClass'
  );
});

runTest('parseCanonicalId should parse canonical ID with parent context and parameters', () => {
  const result = parseCanonicalId('path/to/file.js::Class::MyClass::Method::myMethod(string,number)');
  
  return (
    result.filePath === 'path/to/file.js' &&
    result.entityType === 'Method' &&
    result.name === 'myMethod' &&
    result.parentCanonicalId === 'path/to/file.js::Class::MyClass' &&
    result.paramTypes?.length === 2 &&
    result.paramTypes[0] === 'string' &&
    result.paramTypes[1] === 'number'
  );
});

// Test parseGid
runTest('parseGid should parse valid GID', () => {
  const result = parseGid('js_1234567890abcdef');
  
  return (
    result !== null &&
    result.languagePrefix === 'js' &&
    result.hash === '1234567890abcdef'
  );
});

runTest('parseGid should return null for invalid GID', () => {
  const result = parseGid('invalid_gid_format');
  
  return result === null;
});

// Test parseId
runTest('parseId should parse canonical ID', () => {
  const result = parseId('path/to/file.js::Function::myFunction');
  
  return (
    result.filePath === 'path/to/file.js' &&
    result.entityType === 'Function' &&
    result.name === 'myFunction' &&
    result.gid !== undefined &&
    result.gid.startsWith('js_')
  );
});

runTest('parseId should parse GID (partially)', () => {
  const result = parseId('js_1234567890abcdef');
  
  return (
    result.languagePrefix === 'js' &&
    result.gid === 'js_1234567890abcdef'
  );
});

runTest('parseId should throw for invalid ID string', () => {
  try {
    parseId('');
    return false; // Should not reach here
  } catch (error) {
    return true; // Expected to throw
  }
});

console.log('All tests completed!');