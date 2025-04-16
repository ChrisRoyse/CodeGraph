# CodeGraph Test Suite

This directory contains comprehensive tests for the CodeGraph system, including:

- **End-to-End (E2E) Tests**: Simulate real-world scenarios, covering the entire pipeline from code ingestion, analysis, ID generation, to storage and retrieval.
- **Unit Tests**: (Planned) For isolated testing of core modules and utilities.
- **Fixtures**: Sample codebases and data for analyzers in various languages (Go, Java, C#, SQL, HTML, etc.).

## Directory Structure

- `e2e/` — End-to-end tests
- `unit/` — Unit tests (optional/for future use)
- `fixtures/` — Sample codebases and input files

## Running Tests

1. Ensure all services (ID service, analyzers, database, etc.) are running (e.g., via `docker-compose`).
2. Run the E2E tests:
   
   ```sh
   npm run test:e2e
   # or
   yarn test:e2e
   ```

3. Review test output for any failures or issues.

## Adding New Tests
- Place new E2E test files in `e2e/`
- Add new fixtures in `fixtures/`

## Coverage
- ID generation (all entity types)
- Analyzer integration (all supported languages)
- Database/graph storage and retrieval
- API gateway and external endpoints
- Error handling, concurrency, and edge cases

---

**If all tests in this suite pass, the system should be considered robust and production-ready.**
