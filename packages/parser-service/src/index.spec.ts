import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Parser from 'tree-sitter';
// Mock grammars - actual paths might differ based on how they are resolved/loaded
// We'll refine these mocks as needed.
vi.mock('tree-sitter-javascript', () => ({ default: 'mock-js-grammar' }));
vi.mock('@derekstride/tree-sitter-sql', () => ({ default: 'mock-sql-grammar' }));
vi.mock('tree-sitter-python', () => ({ default: 'mock-python-grammar' }));
vi.mock('tree-sitter-java', () => ({ default: 'mock-java-grammar' }));
vi.mock('tree-sitter-typescript', () => ({
  typescript: 'mock-ts-grammar',
  tsx: 'mock-tsx-grammar',
}));


// Mock the tree-sitter Parser
const mockParse = vi.fn();
const mockSetLanguage = vi.fn();
const mockTree = {
  rootNode: {
    toString: vi.fn().mockReturnValue('mock-ast-string'),
  },
};

vi.mock('tree-sitter', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      setLanguage: mockSetLanguage,
      parse: mockParse,
    })),
  };
});

// Mock process.send
const mockProcessSend = vi.fn();

describe('Parser Service IPC Handler', () => {
  let originalProcessSend: any;
  let originalProcessOn: any;
  let messageHandler: ((msg: any) => Promise<void>) | null = null;

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
    mockParse.mockReturnValue(mockTree); // Default success mock

    // Store original process functions
    originalProcessSend = process.send;
    originalProcessOn = process.on;

    // Assign mock process.send
    process.send = mockProcessSend;

    // Mock process.on to capture the message handler
    process.on = vi.fn((event, handler) => {
      if (event === 'message') {
        messageHandler = handler as any;
      }
      return process; // Return process for chaining if needed
    }) as any;

    // Dynamically import the index.ts to register the handler *after* mocks are set up
    // Use a cache-busting query to ensure it re-runs the module code
     import('./index?cacheBust=' + Date.now());
  });

  afterEach(() => {
    // Restore original process functions
    process.send = originalProcessSend;
    process.on = originalProcessOn;
    messageHandler = null;
     // Need to properly unregister the listener if the module attaches it globally
     // Or ensure the dynamic import approach isolates it.
  it('should handle a successful parsing request', async () => {
    // Ensure the handler is captured
    expect(messageHandler).toBeDefined();
    if (!messageHandler) return; // Type guard

    const message = {
      id: 'test-123',
      language: 'javascript',
      content: 'console.log("hello");',
      filePath: '/path/to/file.js',
    };

    // Simulate receiving the message
    await messageHandler(message);

    // Assertions
    expect(Parser).toHaveBeenCalledTimes(1);
    expect(mockSetLanguage).toHaveBeenCalledTimes(1);
    // The actual grammar object might be complex, checking for the mock value
    expect(mockSetLanguage).toHaveBeenCalledWith('mock-js-grammar');

    expect(mockParse).toHaveBeenCalledTimes(1);
    expect(mockParse).toHaveBeenCalledWith(message.content);

    expect(mockProcessSend).toHaveBeenCalledTimes(1);
    expect(mockProcessSend).toHaveBeenCalledWith({
      id: message.id,
      status: 'success',
      ast: 'mock-ast-string', // From the mockTree
      filePath: message.filePath,
      language: message.language,
      metrics: expect.objectContaining({ // Check for presence and type
        parseTimeMs: expect.any(Number),
      }),
    });

  it('should handle unsupported language requests', async () => {
    expect(messageHandler).toBeDefined();
    if (!messageHandler) return;

    const message = {
      id: 'test-456',
      language: 'cobol', // An unsupported language
      content: 'DISPLAY "Hello".',
      filePath: '/path/to/file.cob',
    };

    await messageHandler(message);

    // Assertions
    expect(Parser).not.toHaveBeenCalled(); // Parser instance shouldn't be created
    expect(mockSetLanguage).not.toHaveBeenCalled();
    expect(mockParse).not.toHaveBeenCalled();

    expect(mockProcessSend).toHaveBeenCalledTimes(1);
    expect(mockProcessSend).toHaveBeenCalledWith({
      id: message.id,
      status: 'error',
      filePath: message.filePath,
      language: message.language,
      error: {
        message: `Unsupported language: ${message.language}`,
      },
      metrics: expect.objectContaining({ // Check for presence and type
        parseTimeMs: expect.any(Number), // Should still record time taken until failure
      }),
    });

  it('should handle errors during parsing', async () => {
    expect(messageHandler).toBeDefined();
    if (!messageHandler) return;

    // Configure mockParse to throw an error for this specific test
    const parseError = new Error('Mock parse error');
    mockParse.mockImplementationOnce(() => {
      throw parseError;
    });

    const message = {
      id: 'test-789',
      language: 'python',
      content: 'print("invalid syntax?',
      filePath: '/path/to/file.py',
    };

    await messageHandler(message);

    // Assertions
    expect(Parser).toHaveBeenCalledTimes(1);
    expect(mockSetLanguage).toHaveBeenCalledTimes(1);
    expect(mockSetLanguage).toHaveBeenCalledWith('mock-python-grammar'); // Check correct grammar was attempted
    expect(mockParse).toHaveBeenCalledTimes(1);
    expect(mockParse).toHaveBeenCalledWith(message.content);

    expect(mockProcessSend).toHaveBeenCalledTimes(1);
    expect(mockProcessSend).toHaveBeenCalledWith({
      id: message.id,
      status: 'error',
      filePath: message.filePath,
      language: message.language,
      error: {
        message: `Parsing failed: ${parseError.message}`,
      },
      metrics: expect.objectContaining({
        parseTimeMs: expect.any(Number),
      }),
    });
  });

  });


  });

     // For now, resetting the handler reference.
  });

  // --- Test cases will go here ---

});