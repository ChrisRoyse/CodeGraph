/**
 * Enum representing supported programming languages for parsing.
 */
export enum Language {
    Python = 'PYTHON',
    JavaScript = 'JAVASCRIPT',
    TypeScript = 'TYPESCRIPT',
    TSX = 'TSX',
    SQL = 'SQL',
    Go = 'GO',
    Java = 'JAVA',
    CSharp = 'CSHARP', // Consistent naming
    C = 'C',
    CPP = 'CPP', // Consistent naming
    // Add other languages as needed
    Unknown = 'UNKNOWN', // Fallback for unsupported types
}

// Re-export other types if they are moved here or defined here later
// export * from './some-other-type-definition';