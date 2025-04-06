'use strict';

/**
 * @fileoverview Main entry point for the @bmcp/parser-service child process.
 * Listens for IPC messages from the parent process to perform parsing tasks.
 */

// Use require for CJS compatibility with tree-sitter and its grammars
const Parser = require('tree-sitter');
const treeSitterSql = require('@derekstride/tree-sitter-sql');
const treeSitterC = require('tree-sitter-c');
const treeSitterCSharp = require('tree-sitter-c-sharp');
const treeSitterCpp = require('tree-sitter-cpp');
const treeSitterGo = require('tree-sitter-go');
const treeSitterJava = require('tree-sitter-java');
const treeSitterJavascript = require('tree-sitter-javascript');
const treeSitterPython = require('tree-sitter-python');
const treeSitterRust = require('tree-sitter-rust');
const treeSitterTypescript = require('tree-sitter-typescript'); // Contains both typescript and tsx

console.log('Parser service child process started.');

// Check if process.send exists (it should in a child process)
if (!process.send) {
  console.error('Error: process.send is not available. This script must be run as a child process.');
  process.exit(1);
}

// Map language identifiers to their corresponding Tree-sitter grammar objects
const grammarMap: { [key: string]: any } = {
  c: treeSitterC,
  csharp: treeSitterCSharp,
  cpp: treeSitterCpp,
  go: treeSitterGo,
  java: treeSitterJava,
  javascript: treeSitterJavascript,
  python: treeSitterPython,
  rust: treeSitterRust,
  sql: treeSitterSql,
  typescript: treeSitterTypescript.typescript, // Access the specific grammar
  tsx: treeSitterTypescript.tsx,             // Access the specific grammar
};

process.on('message', (message: any) => { // Use 'any' for now, define interface later
  console.log('Parser service received message:', message);

  // Basic validation: Check if message is an object and has an id
  if (!message || typeof message !== 'object' || typeof message.id === 'undefined') {
    console.error('Invalid message received (missing or invalid id):', message);
    // Attempt to send an error back, using a placeholder id if necessary
    const id = (message && typeof message === 'object' && message.id) ? message.id : 'unknown';
    process.send!({ // Use non-null assertion as we checked process.send earlier
      id: id,
      status: 'error',
      error: { message: 'Invalid message format: Missing or invalid id.' },
    });
    return; // Stop processing this message
  }

  const messageId = message.id;

  try {
    // --- Parsing Logic ---
    // Validate required fields for parsing
    if (typeof message.language !== 'string' || !message.language) {
        throw new Error('Missing or invalid "language" property in message.');
    }
    if (typeof message.fileContent !== 'string') {
        // Allow empty string, but not missing or wrong type
        throw new Error('Missing or invalid "fileContent" property in message.');
    }

    const language = message.language.toLowerCase(); // Normalize language name
    const fileContent = message.fileContent;

    // 1. Instantiate Parser
    const parser = new Parser();

    // 2. Select Grammar
    const selectedGrammar = grammarMap[language];
    if (!selectedGrammar) {
      throw new Error(`Unsupported language: ${language}. No grammar found.`);
    }

    // 3. Set Language
    // This might throw if the grammar object is invalid, caught by the outer catch
    parser.setLanguage(selectedGrammar);

    // 4. Parse Code
    // This might throw on syntax errors, but tree-sitter often returns a tree with error nodes
    const tree = parser.parse(fileContent);

    // 5. Prepare Success Response (Placeholder AST)
    const response = {
      id: messageId,
      status: 'success',
      // Placeholder: Send back the AST's S-expression representation for now
      ast: tree.rootNode ? tree.rootNode.toString() : null,
      irSnippet: null, // Placeholder for Intermediate Representation Snippet
    };

    console.log(`Sending success response for message ${messageId}`);
    process.send!(response); // Use non-null assertion

  } catch (err: unknown) { // Catch unknown type
    console.error(`Error processing message ${messageId}:`, err);

    // Send error response
    const errorResponse = {
      id: messageId,
      status: 'error',
      error: {
        message: err instanceof Error ? `Parsing failed: ${err.message}` : 'An unknown error occurred during parsing.',
        // Optionally include stack trace in development? Be cautious in production.
        // stack: process.env.NODE_ENV === 'development' && err instanceof Error ? err.stack : undefined,
      },
    };
    console.log(`Sending error response for message ${messageId}`);
    process.send!(errorResponse); // Use non-null assertion
  }
});

// Graceful shutdown handlers
process.on('disconnect', () => {
  console.log('Parser service disconnected from parent process. Exiting.');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Parser service received SIGINT. Exiting gracefully.');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Parser service received SIGTERM. Exiting gracefully.');
  process.exit(0);
});

// Catch unhandled exceptions to prevent the child process from crashing silently
process.on('uncaughtException', (err) => {
  console.error('Unhandled exception in parser service:', err);
  // Try to inform the parent process if possible
  if (process.send) {
    // We might not know the message ID that caused this
    process.send({
      id: 'unknown', // Or perhaps the last known message ID if tracked
      status: 'error',
      error: { message: `Unhandled exception: ${err.message}` },
    });
  }
  process.exit(1); // Exit with an error code
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled promise rejection in parser service:', reason);
   // Try to inform the parent process if possible
   if (process.send) {
    process.send({
      id: 'unknown',
      status: 'error',
      error: { message: `Unhandled promise rejection: ${reason}` },
    });
  }
  // Consider exiting, depending on whether these rejections are recoverable
  // process.exit(1);
});


console.log('Parser service initialized and listening for messages.');

// Export nothing - this file is executed directly as a child process entry point.
module.exports = {};