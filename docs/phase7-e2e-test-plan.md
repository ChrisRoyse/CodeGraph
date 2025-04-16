# CodeGraph Phase 7.1: Comprehensive End-to-End Test Plan

This document defines end-to-end test scenarios for CodeGraph Phase 7.1, covering complex, cross-system interactions. Each scenario includes setup, test steps, expected outcomes, and Neo4j validation queries.

---

## 1. Multi-Language Interaction

**Goal:** Verify that cross-language relationships (e.g., Python→JS API, JS↔SQL, Java↔C# interop) are correctly identified and resolved in Neo4j.

### Setup
- Create a test project with:
  - Python code calling a JS REST API.
  - JS code querying a SQL database.
  - Java code using a C# component (interop).
- Place files in appropriate language directories.
- Use/extend scripts/test_integration.py for orchestration.

### Test Steps
1. Add Python, JS, Java, C# files with explicit cross-language calls/imports.
2. Trigger analysis (file watcher or manual scan via API Gateway).
3. Wait for ingestion and graph update.

### Expected Outcomes
- Neo4j contains nodes for all files/functions/classes.
- Relationships between languages (e.g., Python→JS API call) are present.
- No :CompatibilityIssue or :DependencyIssue unless intentional.

### Validation Queries (Cypher)
```cypher
// Python calls JS API
MATCH (p:Function {language: 'Python'})-[:CALLS_API]->(j:Function {language: 'JavaScript'}) RETURN p, j;

// JS uses SQL
MATCH (j:Function {language: 'JavaScript'})-[:QUERIES]->(s:Table {language: 'SQL'}) RETURN j, s;

// Java uses C# interop
MATCH (j:Class {language: 'Java'})-[:USES_INTEROP]->(c:Class {language: 'CSharp'}) RETURN j, c;
```

---

## 2. Rapid Changes & Deletions

**Goal:** Simulate rapid file modifications, creations, and deletions. Verify debouncing, cascading deletions, and graph consistency.

### Setup
- Use scripts/phase3_test_debouncing.py and scripts/phase3_test_deletion.py as templates.
- Create multiple files in quick succession, modify and delete them rapidly.

### Test Steps
1. Start file watcher service.
2. Rapidly create, modify, and delete files (automate via script).
3. Observe ingestion logs and Neo4j updates.

### Expected Outcomes
- Debouncing prevents redundant analysis.
- Deleted files and their relationships are removed from Neo4j.
- No orphaned nodes or stale relationships.

### Validation Queries
```cypher
// No nodes for deleted files
MATCH (f:File) WHERE f.name IN ['deleted1.py', 'deleted2.js'] RETURN f;

// No relationships from deleted nodes
MATCH (f:File)-[r]-() WHERE f.name IN ['deleted1.py', 'deleted2.js'] RETURN r;
```

---

## 3. Error Conditions

**Goal:** Test system behavior under component failures (e.g., RabbitMQ down, ID service restart, analyzer crash).

### Setup
- Use scripts/test_infrastructure.sh and setup_rabbitmq.sh.
- Simulate failures by stopping services or killing processes.

### Test Steps
1. Stop RabbitMQ or ID service during active ingestion.
2. Restart analyzer mid-analysis.
3. Observe retry mechanisms and error logs.
4. Restore services and verify system recovers.

### Expected Outcomes
- Errors are logged and retried.
- No data loss or graph inconsistency after recovery.
- Eventual consistency is achieved.

### Validation Queries
```cypher
// All expected nodes/relationships present after recovery
MATCH (n) RETURN count(n);
```
- Compare count before and after failure/recovery.

---

## 4. Hint Usage

**Goal:** Verify that `bmcp:` hints override or supplement automatic analysis and result in correct graph relationships.

### Setup
- Add `bmcp:` hints to code comments in test files (see analyzer docs for syntax).
- Use/extend scripts/test_integration.py.

### Test Steps
1. Insert hints (e.g., `# bmcp: CALLS_API my_api_func`) in Python/JS/Java files.
2. Trigger analysis.
3. Check Neo4j for relationships specified by hints.

### Expected Outcomes
- Hinted relationships appear in Neo4j, even if not statically detectable.
- No duplicate/conflicting relationships.

### Validation Queries
```cypher
// Hinted relationship
MATCH (a)-[:CALLS_API]->(b) WHERE a.name = 'caller' AND b.name = 'my_api_func' RETURN a, b;
```

---

## 5. Bulk Load & Incremental Update

**Goal:** Test bulk loading followed by incremental changes. Ensure graph state is correct after both.

### Setup
- Use scripts/bulk_load.py for initial load.
- Make incremental file changes (add/modify/delete).

### Test Steps
1. Run bulk_load.py on a large test project.
2. Add, modify, and delete files incrementally.
3. Trigger incremental ingestion.

### Expected Outcomes
- Graph reflects bulk load state, then updates correctly for incremental changes.
- No duplicate or missing nodes/relationships.

### Validation Queries
```cypher
// Validate node counts and relationships after each phase
MATCH (n) RETURN count(n);
MATCH ()-[r]->() RETURN count(r);
```

---

## 6. API Gateway Interaction

**Goal:** Use API Gateway endpoints during tests to monitor and interact with the system.

### Setup
- Use services/api_gateway/main.py and test_api_gateway.py.
- Identify endpoints: /status, /query, /scan.

### Test Steps
1. During above tests, call API Gateway endpoints:
   - `/status` to check system health.
   - `/query` to run graph queries.
   - `/scan` to trigger rescans.
2. Validate API responses and system state.

### Expected Outcomes
- API Gateway returns correct status and query results.
- Scan triggers analysis as expected.
- No errors or inconsistencies.

### Example API Calls
```bash
curl http://localhost:8000/status
curl -X POST http://localhost:8000/scan -d '{"path": "test_project/"}'
curl -X POST http://localhost:8000/query -d '{"cypher": "MATCH (n) RETURN count(n)"}'
```

---

## Notes

- Extend/modify scripts in `scripts/` as needed for automation.
- For language-specific tests, use test files in `services/analyzers/*_analyzer/test/`.
- Validate interface compatibility and shared modules.
- Check for `:CompatibilityIssue` and `:DependencyIssue` nodes in Neo4j after each scenario.
- Document any issues or deviations from expected outcomes.

---

## References

- [scripts/test_integration.py](../scripts/test_integration.py)
- [scripts/bulk_load.py](../scripts/bulk_load.py)
- [services/api_gateway/test_api_gateway.py](../services/api_gateway/test_api_gateway.py)
- [Analyzer test files](../services/analyzers/)