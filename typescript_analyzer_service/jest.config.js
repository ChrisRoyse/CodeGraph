/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Optional: Add any specific Jest configurations here
  // For example, setup files, module name mappers, etc.
  // setupFilesAfterEnv: ['./jest.setup.js'], // If you need setup files
  // moduleNameMapper: { // If you need module aliases
  //   '^@/(.*)$': '<rootDir>/src/$1',
  // },
  testPathIgnorePatterns: ['/node_modules/', '/dist/'], // Ignore dist and node_modules
  collectCoverage: true, // Enable coverage collection
  coverageDirectory: 'coverage', // Directory for coverage reports
  coverageProvider: 'v8', // Use v8 for coverage
};