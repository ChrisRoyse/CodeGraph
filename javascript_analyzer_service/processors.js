// javascript_analyzer_service/processors.js
// Contains functions for processing different node types in JavaScript AST

const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const { getNodeText, API_CALL_IDENTIFIERS } = require('./helpers');
const idGen = require('./id_generator');

// Define Tree-sitter query strings directly in this file
const FUNCTION_DECL_QUERY = `
  [
    (function_declaration (identifier) @function.name)
    (function (identifier)? @function.name)
    (arrow_function (identifier)? @function.name)
    (variable_declarator name: (identifier) @function.name value: [(function) (arrow_function)])
  ] @function.definition
  (formal_parameters) @function.parameters
  (statement_block)? @function.body
`;

const CLASS_DECL_QUERY = `
  (class_declaration (identifier) @class.name (class_body) @class.body) @class.definition
`;

const METHOD_DEF_QUERY = `
  (method_definition property: (_) @method.name (formal_parameters) @method.parameters (statement_block)? @method.body) @method.definition
`;

const CALL_EXPRESSION_QUERY = `
  (call_expression function: (_) @call.target arguments: (arguments) @call.arguments) @call.expression
`;

const REQUIRE_CALL_QUERY = `
  (call_expression
    function: (identifier) @require.name (#eq? @require.name "require")
    arguments: (arguments (string) @require.source)
  ) @require.call
`;

const IMPORT_STATEMENT_QUERY = `
  (import_statement
    [
      (import_clause
        [
          (identifier) @import.default
          (named_imports (import_specifier (identifier) @import.name)*)?
        ]?
      )
      (namespace_import (identifier) @import.namespace)?
    ]
    source: (string) @import.source
  ) @import.statement
`;

const VARIABLE_DECL_QUERY = `
  (variable_declarator name: (identifier) @variable.name value: (_)? @variable.value) @variable.declarator
`;

/**
 * Processes function declarations and expressions
 * @param {Object} rootNode - Root node to search in
 * @param {string} sourceCode - Source code string
 * @param {Object} context - Analysis context (should include createNode, createRelationship, filePath, fileUniqueId, sourceCode)
 * @param {Array} scopeStack - Stack of scope IDs
 */
function processFunctions(rootNode, sourceCode, context, scopeStack) {
    const { createNode } = context;
    const language = JavaScript; // Assuming JavaScript language object is available
    const query = new Parser.Query(language, FUNCTION_DECL_QUERY);
    const funcMatches = query.matches(rootNode);

    for (const match of funcMatches) {
        const defNode = match.captures.find(c => c.name === 'function.definition').node;
        const nameNode = match.captures.find(c => c.name === 'function.name')?.node;
        const paramsNode = match.captures.find(c => c.name === 'function.parameters')?.node;
        const bodyNode = match.captures.find(c => c.name === 'function.body')?.node;

        const functionName = nameNode ? getNodeText(nameNode, sourceCode) : '(anonymous)';
        const parameters = paramsNode ? paramsNode.namedChildren.map(p => getNodeText(p, sourceCode)) : [];
        const isAsync = defNode.type.includes('async') || defNode.type.includes('generator');

        // Generate canonical ID
        // Generate canonical ID (func:name(#count))
        const canonicalIdentifier = idGen.createCanonicalFunction(functionName, parameters, null); // Pass null for className

        // Create the node (this also adds CONTAINS relationship from current scope)
        // Pass empty array for extraLabels (5th arg), then properties (6th arg)
        const funcGlobalId = createNode("Function", functionName, defNode, canonicalIdentifier, [], { // Correct: properties is 6th arg
            parameters: parameters,
            is_async: isAsync,
        });

        // If node creation was successful and it has a body, process its scope
        if (funcGlobalId && bodyNode) {
            scopeStack.push(funcGlobalId);
            try {
                // Nested elements will be processed by the main loop
            } finally {
                scopeStack.pop();
            }
        }
    }
}

/**
 * Processes class declarations and method definitions
 * @param {Object} rootNode - Root node to search in
 * @param {string} sourceCode - Source code string
 * @param {Object} context - Analysis context
 * @param {Array} scopeStack - Stack of scope IDs
 */
function processClassesAndMethods(rootNode, sourceCode, context, scopeStack) {
    const { createNode } = context;
    const language = JavaScript;
    const classQuery = new Parser.Query(language, CLASS_DECL_QUERY);
    const methodQuery = new Parser.Query(language, METHOD_DEF_QUERY);
    const classMatches = classQuery.matches(rootNode);

    for (const match of classMatches) {
        const defNode = match.captures.find(c => c.name === 'class.definition').node;
        const nameNode = match.captures.find(c => c.name === 'class.name')?.node;
        const bodyNode = match.captures.find(c => c.name === 'class.body')?.node;
        const className = nameNode ? getNodeText(nameNode, sourceCode) : '(anonymous)';

        // Generate canonical ID for the class
        // Generate canonical ID (type:Name)
        const classCanonicalId = idGen.createCanonicalClass(className);

        // Create the class node (adds CONTAINS from current scope)
        const classGlobalId = createNode("Class", className, defNode, classCanonicalId, [], {}); // Correct: properties is 6th arg

        // If class node created successfully and has a body, process methods within its scope
        if (classGlobalId && bodyNode) {
            scopeStack.push(classGlobalId); // Enter class scope
            try {
                const methodMatches = methodQuery.matches(bodyNode); // Query within the class body
                for (const methodMatch of methodMatches) {
                    const methodDefNode = methodMatch.captures.find(c => c.name === 'method.definition').node;
                    const methodNameNode = methodMatch.captures.find(c => c.name === 'method.name')?.node;
                    const methodParamsNode = methodMatch.captures.find(c => c.name === 'method.parameters')?.node;
                    const methodBodyNode = methodMatch.captures.find(c => c.name === 'method.body')?.node;

                    const methodName = methodNameNode ? getNodeText(methodNameNode, sourceCode) : 'constructor';
                    const parameters = methodParamsNode ? methodParamsNode.namedChildren.map(p => getNodeText(p, sourceCode)) : [];
                    const isAsync = methodDefNode.text.startsWith('async');
                    const isStatic = methodDefNode.childForFieldName('static') !== null;

                    // Generate canonical ID for the method (including class name)
                    // Generate canonical ID (method:ClassName.methodName(#count))
                    const methodCanonicalId = idGen.createCanonicalFunction(methodName, parameters, className);

                    // Create the method node (adds CONTAINS from class scope)
                    // Pass [] for extraLabels (5th arg), then properties (6th arg)
                    const methodGlobalId = createNode("Method", methodName, methodDefNode, methodCanonicalId, [], { // Correct: properties is 6th arg
                        parameters: parameters,
                        is_async: isAsync,
                        is_static: isStatic,
                        parent_class: className,
                    });

                    // If method node created successfully and has a body, process its scope
                    if (methodGlobalId && methodBodyNode) {
                        scopeStack.push(methodGlobalId); // Enter method scope
                        try {
                            // Nested elements will be processed by the main loop
                        } finally {
                            scopeStack.pop(); // Exit method scope
                        }
                    }
                }
            } finally {
                scopeStack.pop(); // Exit class scope
            }
        }
    }
}

/**
 * Processes import statements
 * @param {Object} rootNode - Root node to search in
 * @param {string} sourceCode - Source code string
 * @param {Object} context - Analysis context (should include createNode, createRelationship, filePath, fileUniqueId, sourceCode)
 */
function processImports(rootNode, sourceCode, context) {
    const { createNode, createRelationship, fileUniqueId } = context; // Use fileUniqueId
    const language = JavaScript;
    const query = new Parser.Query(language, IMPORT_STATEMENT_QUERY);
    const importMatches = query.matches(rootNode);

    for (const match of importMatches) {
        const stmtNode = match.captures.find(c => c.name === 'import.statement').node;
        const sourceNode = match.captures.find(c => c.name === 'import.source')?.node;
        const sourcePath = sourceNode ? getNodeText(sourceNode, sourceCode).replace(/['"`]/g, '') : '(unknown)';

        const namedImportNodes = match.captures.filter(c => c.name === 'import.name');
        const namedImports = namedImportNodes.map(c => getNodeText(c.node, sourceCode));
        const defaultImportNode = match.captures.find(c => c.name === 'import.default')?.node;
        const namespaceImportNode = match.captures.find(c => c.name === 'import.namespace')?.node;

        let representativeName = sourcePath;
        if (defaultImportNode) representativeName = getNodeText(defaultImportNode, sourceCode);
        else if (namespaceImportNode) representativeName = getNodeText(namespaceImportNode, sourceCode);
        else if (namedImports.length > 0) representativeName = `{${namedImports.join(', ')}}`;

        const canonicalIdentifier = idGen.createCanonicalImport(representativeName, sourcePath);

        const importGlobalId = createNode("Import", representativeName, stmtNode, canonicalIdentifier, ["Import"], { // Correct: properties is 6th arg
            source: sourcePath,
            type: 'ESM',
            named_imports: namedImports,
            has_default_import: !!defaultImportNode,
            has_namespace_import: !!namespaceImportNode,
        });

        // Create the IMPORTS relationship from the file to the import source (unresolved)
        if (importGlobalId && fileUniqueId) { // Use fileUniqueId from context
            createRelationship(fileUniqueId, sourcePath, "IMPORTS", stmtNode);
        } else if (!fileUniqueId) {
             console.warn(`[JS Analyzer] Missing fileUniqueId in context for IMPORTS relationship (Import: ${representativeName})`);
        }
    }
}

/**
 * Processes require calls
 * @param {Object} rootNode - Root node to search in
 * @param {string} sourceCode - Source code string
 * @param {Object} context - Analysis context (should include createNode, createRelationship, filePath, fileUniqueId, sourceCode)
 */
function processRequires(rootNode, sourceCode, context) {
    const { createNode, createRelationship, fileUniqueId } = context; // Use fileUniqueId
    const language = JavaScript;
    const query = new Parser.Query(language, REQUIRE_CALL_QUERY);
    const requireMatches = query.matches(rootNode);

    for (const match of requireMatches) {
        const callNode = match.captures.find(c => c.name === 'require.call').node;
        const sourceNode = match.captures.find(c => c.name === 'require.source')?.node;
        const sourcePath = sourceNode ? getNodeText(sourceNode, sourceCode).replace(/['"`]/g, '') : '(unknown)';

        let assignedVarName = sourcePath;
        let assignmentNode = callNode;
        if (callNode.parent?.type === 'variable_declarator') {
            const nameNode = callNode.parent.childForFieldName('name');
            if (nameNode) {
                assignedVarName = getNodeText(nameNode, sourceCode);
                assignmentNode = callNode.parent;
            }
        }

        const canonicalIdentifier = idGen.createCanonicalImport(assignedVarName, sourcePath);

        const importGlobalId = createNode("Import", assignedVarName, assignmentNode, canonicalIdentifier, ["Import"], { // Correct: properties is 6th arg
            source: sourcePath,
            type: 'CommonJS',
        });

        // Create the IMPORTS relationship from the file to the require source (unresolved)
        if (importGlobalId && fileUniqueId) { // Use fileUniqueId from context
            createRelationship(fileUniqueId, sourcePath, "IMPORTS", callNode);
        } else if (!fileUniqueId) {
             console.warn(`[JS Analyzer] Missing fileUniqueId in context for IMPORTS relationship (Require: ${assignedVarName})`);
        }
    }
}

/**
 * Processes variable declarations
 * @param {Object} rootNode - Root node to search in
 * @param {string} sourceCode - Source code string
 * @param {Object} context - Analysis context
 * @param {Array} scopeStack - Stack of scope IDs
 */
function processVariables(rootNode, sourceCode, context, scopeStack) {
    const { createNode } = context;
    const language = JavaScript;
    const query = new Parser.Query(language, VARIABLE_DECL_QUERY);
    const varMatches = query.matches(rootNode);

    for (const match of varMatches) {
        const declNode = match.captures.find(c => c.name === 'variable.declarator').node;
        const nameNode = match.captures.find(c => c.name === 'variable.name')?.node;
        const valueNode = match.captures.find(c => c.name === 'variable.value')?.node;

        if (!nameNode) continue;

        const varName = getNodeText(nameNode, sourceCode);
        const varKind = declNode.parent?.type === 'lexical_declaration' ? declNode.parent.child(0)?.text : 'var';

        if (valueNode?.type === 'call_expression' &&
            getNodeText(valueNode.childForFieldName('function'), sourceCode) === 'require') {
            continue;
        }

        const parentScopeCanonicalId = scopeStack.length > 1 ? scopeStack[scopeStack.length - 1] : null;
        const canonicalIdentifier = idGen.createCanonicalVariable(varName, parentScopeCanonicalId);

        createNode("Variable", varName, nameNode, canonicalIdentifier, ["Declaration"], { kind: varKind }); // Correct: properties is 6th arg
    }
}

/**
 * Processes call expressions
 * @param {Object} rootNode - Root node to search in
 * @param {string} sourceCode - Source code string
 * @param {Object} context - Analysis context
 * @param {Array} scopeStack - Stack of scope IDs
 */
function processCalls(rootNode, sourceCode, context, scopeStack) {
    const { createNode, createRelationship } = context;
    const language = JavaScript;
    const query = new Parser.Query(language, CALL_EXPRESSION_QUERY);
    const callMatches = query.matches(rootNode);

    for (const match of callMatches) {
        const callExprNode = match.captures.find(c => c.name === 'call.expression').node;
        const targetNode = match.captures.find(c => c.name === 'call.target').node;
        const argsNode = match.captures.find(c => c.name === 'call.arguments')?.node;
        const targetText = getNodeText(targetNode, sourceCode);
        const argsText = argsNode ? getNodeText(argsNode, sourceCode) : '()';

        if (targetNode.type === 'identifier' && targetText === 'require') {
            continue;
        }

        const isApiCall = API_CALL_IDENTIFIERS.some(api => targetText.includes(api));
        const nodeType = isApiCall ? "ApiCall" : "Call";
        const callName = targetText;

        const callCanonicalIdentifier = `${targetText}@${callExprNode.startPosition.row + 1}`;

        const callGlobalId = createNode(nodeType, callName, callExprNode, callCanonicalIdentifier, ["Invocation"], { // Correct: properties is 6th arg
             target_string: targetText,
             arguments_string: argsText
        });

        if (callGlobalId) {
            const currentScopeGlobalId = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : null;
            if (currentScopeGlobalId) {
                createRelationship(currentScopeGlobalId, targetText, "CALLS", callExprNode);
            } else {
                console.warn(`[JS Analyzer] Could not determine scope for CALLS relationship from call: ${targetText}`);
            }
        }
    }
}

module.exports = {
    processFunctions,
    processClassesAndMethods,
    processImports,
    processRequires,
    processVariables,
    processCalls
};