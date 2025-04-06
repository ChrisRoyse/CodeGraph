# Specification: Multi-Language Connectome Test Program

**Version:** 1.0
**Date:** 2025-04-03

## 1. Objective

This document specifies a multi-language test program designed to validate the Code Connectome analyzer. The program includes components written in Python, TypeScript, SQL, and Java, demonstrating various cross-language interactions like API calls, database queries, and inter-process communication. The goal is to ensure the analyzer correctly identifies these interactions and represents them accurately in the Neo4j graph database according to the definitions in `docs/architecture_connectome.md`.

## 2. Test Program Location

The test program will reside in the following directory:
`test_fixtures/multi_lang_connectome_test/`

## 3. Directory Structure

```
test_fixtures/multi_lang_connectome_test/
├── backend/                  # Python backend (Flask)
│   ├── app.py
│   └── db_utils.py
├── frontend/                 # TypeScript frontend
│   └── index.ts
├── database/                 # SQL schema
│   └── schema.sql
└── java_service/             # Simple Java utility
    └── src/
        └── main/
            └── java/
                └── com/
                    └── example/
                        └── utils/
                            └── StringProcessor.java
```

## 4. File Contents & Code Snippets

Minimal code examples demonstrating the required interactions.

*(Note: These are simplified examples focused on demonstrating relationships, not production-ready code.)*

### 4.1. Python Backend (`backend/app.py`)

```python
# backend/app.py
from flask import Flask, jsonify, request
import subprocess
from db_utils import get_user_email # Intra-language call

app = Flask(__name__)

# API Definition
@app.route('/api/users/<int:user_id>', methods=['GET'])
def get_user(user_id):
    """API endpoint to get user data."""
    email = get_user_email(user_id) # Intra-language call

    # Cross-language call (Python -> Java via subprocess)
    try:
        # Assumes Java service source is accessible relative to where Python runs
        # Adjust classpath based on actual build/deployment structure if needed
        java_class_path = "../java_service/src/main/java" 
        java_class_name = "com.example.utils.StringProcessor"
        result = subprocess.run(
            ['java', '-cp', java_class_path, java_class_name, f"user_id:{user_id}"],
            capture_output=True, text=True, check=True, timeout=5 # Added timeout
        )
        processed_data = result.stdout.strip()
    except subprocess.TimeoutExpired:
         processed_data = "Error: Java call timed out"
    except Exception as e:
        processed_data = f"Error calling Java: {e}"

    if email:
        return jsonify({"user_id": user_id, "email": email, "processed": processed_data})
    else:
        return jsonify({"error": "User not found"}), 404

if __name__ == '__main__':
    # Use 0.0.0.0 to be accessible externally if needed, e.g. from frontend running elsewhere
    app.run(host='0.0.0.0', port=5000) 

```

### 4.2. Python DB Utils (`backend/db_utils.py`)

```python
# backend/db_utils.py
import sqlite3 # Using sqlite for simplicity, no external DB needed
import os

# Construct path relative to this file's directory
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE_PATH = os.path.join(BASE_DIR, '..', 'database', 'test_db.sqlite') 

def _ensure_db_exists():
    """Creates the DB from schema if it doesn't exist."""
    if not os.path.exists(DATABASE_PATH):
        print(f"Database not found at {DATABASE_PATH}. Creating...")
        SCHEMA_PATH = os.path.join(BASE_DIR, '..', 'database', 'schema.sql')
        if not os.path.exists(SCHEMA_PATH):
             print(f"ERROR: Schema file not found at {SCHEMA_PATH}")
             return False
        try:
            conn = sqlite3.connect(DATABASE_PATH)
            cursor = conn.cursor()
            with open(SCHEMA_PATH, 'r') as f:
                schema_sql = f.read()
            cursor.executescript(schema_sql)
            conn.commit()
            print("Database created and schema applied.")
            return True
        except sqlite3.Error as e:
            print(f"Database creation error: {e}")
            return False
        finally:
            if conn:
                conn.close()
    return True


def get_user_email(user_id):
    """Queries the database for a user's email."""
    if not _ensure_db_exists():
        return None
        
    conn = None
    try:
        conn = sqlite3.connect(DATABASE_PATH)
        cursor = conn.cursor()

        # Database Query (Raw SQL)
        query = "SELECT email FROM users WHERE id = ?"
        cursor.execute(query, (user_id,))
        result = cursor.fetchone()

        return result[0] if result else None
    except sqlite3.Error as e:
        print(f"Database query error: {e}")
        return None
    finally:
        if conn:
            conn.close()

```

### 4.3. TypeScript Frontend (`frontend/index.ts`)

```typescript
// frontend/index.ts
// Assuming 'fetch' is available (e.g., in a browser or Node environment with node-fetch)
// To run in Node: npm install node-fetch; then use: import fetch from 'node-fetch';

// Use environment variable or default for flexibility
const API_BASE_URL = process.env.API_URL || 'http://localhost:5000'; 

interface UserData {
    user_id: number;
    email: string;
    processed: string;
}

interface ErrorResponse {
    error: string;
}

async function fetchUserData(userId: number): Promise<void> {
  console.log(`Fetching data for user ${userId}...`);
  const url = `${API_BASE_URL}/api/users/${userId}`;
  console.log(`Requesting URL: ${url}`); // Log the URL being fetched

  try {
    // API Call (TypeScript -> Python)
    // Note: Ensure CORS is handled on the Flask backend if running from a browser
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json', // Explicitly accept JSON
        },
        // Add timeout if using node-fetch or similar library supporting it
        // signal: AbortSignal.timeout(5000), // Example for newer fetch APIs
    });

    console.log(`Response Status: ${response.status}`); // Log status

    if (!response.ok) {
      const errorText = await response.text(); // Get error body
      throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
    }

    // Type assertion after checking response.ok
    const data = await response.json() as UserData | ErrorResponse;
    console.log('Data received:', data);

    if ('error' in data) {
         console.error(`API Error: ${data.error}`);
    } else {
        // Example of using the data
        displayUserInfo(data); // Intra-language call
    }

  } catch (error) {
    console.error('Failed to fetch user data:', error);
  }
}

function displayUserInfo(userData: UserData): void {
    // Simple display logic
    console.log(`User ID: ${userData.user_id}, Email: ${userData.email}, Processed: ${userData.processed}`);
}

// Example usage: Get user ID from command line argument or default to 1
const userIdArg = process.argv[2]; // process.argv[0] is node, [1] is script path
const userIdToFetch = userIdArg ? parseInt(userIdArg, 10) : 1;

if (isNaN(userIdToFetch)) {
    console.error("Invalid User ID provided.");
} else {
    fetchUserData(userIdToFetch);
}

```

### 4.4. SQL Schema (`database/schema.sql`)

```sql
-- database/schema.sql

-- Ensure tables are dropped if they exist for a clean setup
DROP TABLE IF EXISTS users;

-- Database Schema Definition
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Optional: Insert sample data for testing
INSERT INTO users (username, email) VALUES ('testuser1', 'test1@example.com');
INSERT INTO users (username, email) VALUES ('testuser2', 'test2@example.com');

```

### 4.5. Java Utility (`java_service/src/main/java/com/example/utils/StringProcessor.java`)

```java
// java_service/src/main/java/com/example/utils/StringProcessor.java
package com.example.utils;

// Basic class demonstrating a callable method
public class StringProcessor {

    /**
     * Processes the input string (e.g., reverses it).
     * @param input The string to process.
     * @return The processed string.
     */
    public String process(String input) {
        // Example processing: Reverse the input string
        // Intra-language call
        System.out.println("Java: Processing input: " + input); // Add logging
        String reversed = reverseString(input);
        System.out.println("Java: Reversed string: " + reversed); // Add logging
        return reversed;
    }

    /**
     * Utility method to reverse a string.
     * @param str The string to reverse.
     * @return The reversed string.
     */
    private String reverseString(String str) {
        if (str == null) {
            return null;
        }
        return new StringBuilder(str).reverse().toString();
    }

    /**
     * Main method to allow execution via subprocess call from Python.
     * Expects one argument: the string to process.
     * Prints the processed string to standard output.
     * @param args Command line arguments.
     */
    public static void main(String[] args) {
         System.out.println("Java: StringProcessor starting..."); // Add logging
        if (args.length > 0) {
            StringProcessor processor = new StringProcessor(); // Intra-language call (constructor)
            String result = processor.process(args[0]); // Intra-language call
            // Output ONLY the result for Python script to capture easily
            System.out.println(result); 
            System.out.println("Java: Processing complete."); // Add logging
        } else {
            System.err.println("Error: No input string provided."); // Use stderr for errors
            System.out.println("Usage: java com.example.utils.StringProcessor <input_string>");
            System.exit(1); // Indicate error
        }
         System.out.println("Java: StringProcessor finished."); // Add logging
    }
}
```

## 5. Expected Neo4j Graph Elements & Relationships

Based on the architecture (`docs/architecture_connectome.md`) and the code snippets above.
Assume `project_id` = `multi-lang-test`. Canonical IDs are approximate and depend on exact parsing/resolution.

### 5.1. Expected Nodes (`IrElement` -> Neo4j Nodes)

*   **Files:**
    *   `connectome://multi-lang-test/file:backend/app.py`
    *   `connectome://multi-lang-test/file:backend/db_utils.py`
    *   `connectome://multi-lang-test/file:frontend/index.ts`
    *   `connectome://multi-lang-test/file:database/schema.sql`
    *   `connectome://multi-lang-test/file:java_service/src/main/java/com/example/utils/StringProcessor.java`
*   **Functions:**
    *   `connectome://multi-lang-test/function:backend/app.py:get_user`
    *   `connectome://multi-lang-test/function:backend/db_utils.py:_ensure_db_exists`
    *   `connectome://multi-lang-test/function:backend/db_utils.py:get_user_email`
    *   `connectome://multi-lang-test/function:frontend/index.ts:fetchUserData`
    *   `connectome://multi-lang-test/function:frontend/index.ts:displayUserInfo`
    *   `connectome://multi-lang-test/function:java_service/src/main/java/com/example/utils/StringProcessor.java:StringProcessor.process`
    *   `connectome://multi-lang-test/function:java_service/src/main/java/com/example/utils/StringProcessor.java:StringProcessor.reverseString`
    *   `connectome://multi-lang-test/function:java_service/src/main/java/com/example/utils/StringProcessor.java:StringProcessor.main`
*   **Classes:**
    *   `connectome://multi-lang-test/class:java_service/src/main/java/com/example/utils/StringProcessor.java:StringProcessor`
*   **Variables:** (Examples, more might be identified)
    *   `connectome://multi-lang-test/variable:backend/app.py:app`
    *   `connectome://multi-lang-test/variable:backend/db_utils.py:BASE_DIR`
    *   `connectome://multi-lang-test/variable:backend/db_utils.py:DATABASE_PATH`
    *   `connectome://multi-lang-test/variable:frontend/index.ts:API_BASE_URL`
*   **ApiRouteDefinitions / ApiRoute:**
    *   `connectome://multi-lang-test/api:GET:/api/users/{user_id}` (or similar based on Flask parsing, e.g., `<int:user_id>`)
*   **DatabaseTables:**
    *   `connectome://multi-lang-test/dbtable:users` (Schema name might be absent or 'main' for sqlite)
*   **DatabaseColumns:**
    *   `connectome://multi-lang-test/dbcolumn:users.id`
    *   `connectome://multi-lang-test/dbcolumn:users.username`
    *   `connectome://multi-lang-test/dbcolumn:users.email`
    *   `connectome://multi-lang-test/dbcolumn:users.created_at`

### 5.2. Expected Relationships

*   **Intra-language Calls (`CALLS`):**
    *   `(Function:backend/app.py:get_user) -[:CALLS]-> (Function:backend/db_utils.py:get_user_email)`
    *   `(Function:backend/db_utils.py:get_user_email) -[:CALLS]-> (Function:backend/db_utils.py:_ensure_db_exists)`
    *   `(Function:frontend/index.ts:fetchUserData) -[:CALLS]-> (Function:frontend/index.ts:displayUserInfo)`
    *   `(Function:java_service/.../StringProcessor.java:StringProcessor.process) -[:CALLS]-> (Function:java_service/.../StringProcessor.java:StringProcessor.reverseString)`
    *   `(Function:java_service/.../StringProcessor.java:StringProcessor.main) -[:CALLS]-> (Function:java_service/.../StringProcessor.java:StringProcessor.process)`
    *   `(Function:java_service/.../StringProcessor.java:StringProcessor.main) -[:INSTANTIATES]-> (Class:java_service/.../StringProcessor.java:StringProcessor)` (Or CALLS constructor)
*   **API Call (`FETCHES`):**
    *   `(Function:frontend/index.ts:fetchUserData) -[:FETCHES {httpMethod: "GET", urlPattern: "http://localhost:5000/api/users/{userId}"}]-> (ApiRoute:GET:/api/users/{user_id})` (Properties might vary slightly based on resolver logic)
*   **API Handling (`HANDLED_BY`):**
    *   `(ApiRoute:GET:/api/users/{user_id}) -[:HANDLED_BY]-> (Function:backend/app.py:get_user)`
*   **Database Query (`REFERENCES_TABLE`, `REFERENCES_COLUMN`):**
    *   `(Function:backend/db_utils.py:get_user_email) -[:REFERENCES_TABLE {queryType: "SELECT"}]-> (DatabaseTable:users)`
    *   `(Function:backend/db_utils.py:get_user_email) -[:REFERENCES_COLUMN {accessType: "READ"}]-> (DatabaseColumn:users.email)`
    *   `(Function:backend/db_utils.py:get_user_email) -[:REFERENCES_COLUMN {accessType: "READ"}]-> (DatabaseColumn:users.id)`
*   **Cross-language Call (Python -> Java):**
    *   *(This is complex)* The analyzer might create a generic `CALLS` or a specific `INTER_PROCESS_CALL` relationship if the subprocess call is recognized.
    *   `(Function:backend/app.py:get_user) -[:CALLS {mechanism: "subprocess", targetSignature: "com.example.utils.StringProcessor.main(String[])"}]-> (Function:java_service/.../StringProcessor.java:StringProcessor.main)` (Ideal, but might require specific resolver logic recognizing `java -cp ... classname`)
    *   Alternatively, it might just link to the Java *file* or *class* if the specific method isn't resolvable via static analysis of the subprocess call.
*   **File Definitions (`DEFINES`):**
    *   `(File:backend/app.py) -[:DEFINES]-> (Function:backend/app.py:get_user)`
    *   `(File:backend/app.py) -[:DEFINES]-> (ApiRoute:GET:/api/users/{user_id})` (If detected via decorator)
    *   `(File:backend/db_utils.py) -[:DEFINES]-> (Function:backend/db_utils.py:get_user_email)`
    *   `(File:backend/db_utils.py) -[:DEFINES]-> (Function:backend/db_utils.py:_ensure_db_exists)`
    *   `(File:frontend/index.ts) -[:DEFINES]-> (Function:frontend/index.ts:fetchUserData)`
    *   `(File:frontend/index.ts) -[:DEFINES]-> (Function:frontend/index.ts:displayUserInfo)`
    *   `(File:database/schema.sql) -[:DEFINES]-> (DatabaseTable:users)`
    *   `(File:database/schema.sql) -[:DEFINES]-> (DatabaseColumn:users.id)`
    *   `(File:database/schema.sql) -[:DEFINES]-> (DatabaseColumn:users.email)`
    *   ... (etc. for all defined elements)
*   **Table Columns (`HAS_COLUMN`):**
    *   `(DatabaseTable:users) -[:HAS_COLUMN]-> (DatabaseColumn:users.id)`
    *   `(DatabaseTable:users) -[:HAS_COLUMN]-> (DatabaseColumn:users.username)`
    *   `(DatabaseTable:users) -[:HAS_COLUMN]-> (DatabaseColumn:users.email)`
    *   `(DatabaseTable:users) -[:HAS_COLUMN]-> (DatabaseColumn:users.created_at)`
*   **Imports (`IMPORTS`):** (Examples)
    *   `(File:backend/app.py) -[:IMPORTS {importedEntityName: "get_user_email"}]-> (Function:backend/db_utils.py:get_user_email)` (Or links to the file `db_utils.py` depending on resolver)
    *   `(File:backend/app.py) -[:IMPORTS {moduleSpecifier: "flask"}]-> (ExternalLibrary:flask)` (If external libraries are modeled)


## 6. Validation Criteria

The test passes if the Code Connectome analyzer, when run on the `test_fixtures/multi_lang_connectome_test/` directory:
1.  Generates IR containing the elements and potential relationships corresponding to the code snippets.
2.  Populates the Neo4j database with nodes and relationships that substantially match the "Expected Neo4j Graph" section above. Minor variations in Canonical IDs or relationship properties might occur based on implementation details, but the core structure and connections must be present.
3.  Specifically, the `FETCHES`, `REFERENCES_TABLE`, `REFERENCES_COLUMN`, and `CALLS` (both intra- and potentially inter-language via subprocess detection) relationships must be correctly identified between the elements defined in different language files.