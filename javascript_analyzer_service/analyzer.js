// javascript_analyzer_service/analyzer.js
// Main orchestration file for JavaScript analysis

const path = require('path');
const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const idGen = require('./id_generator');
const helpers = require('./helpers');
const processors = require('./processors');

/**
 * Analyzes the Tree-sitter AST using queries and generates nodes and relationships.
 * @param {Parser.SyntaxNode} rootNode - The root node of the AST.
 * @param {string} filePath - The path of the file being analyzed.
 * @param {string} sourceCode - The full source code string.
 * @returns {{nodes: Array<object>, relationships: Array<object>}} - Data formatted for the ingestion API
 */
function analyze(rootNode, filePath, sourceCode) {
    const nodes = []; // Renamed from nodes_data
    const relationships = []; // Renamed from relationships_data
    const defined_node_ids_in_run = new Set(); // Track added Global IDs for this run
    const scopeStack = []; // Stack to hold the Global ID of the current scope

    // Helper to create and add a node object formatted for the database
    // Helper to create and add a node object formatted for the API
    const createNode = (nodeType, name, syntaxNode, canonicalIdentifier, extraLabels = [], properties = {}) => {
        const location = helpers.getCodeLocation(syntaxNode, filePath);
        const globalId = idGen.generateGlobalId('javascript', filePath, canonicalIdentifier);
        const rawName = helpers.getNodeText(syntaxNode, sourceCode);

        // Prevent adding nodes with duplicate Global IDs within the same file analysis run
        if (defined_node_ids_in_run.has(globalId)) {
            console.debug(`[JS Analyzer] Skipping duplicate node addition for ID: ${globalId} (Type: ${nodeType}, Name: ${name})`);
            return globalId; // Return existing ID but don't add again
        }
        defined_node_ids_in_run.add(globalId);

        const nodeData = {
            uniqueId: globalId, // Renamed from node_id
            name: name,
            filePath: filePath, // Added filePath
            startLine: location.start_line, // Renamed from start_line
            startColumn: location.start_column, // Added startColumn
            endLine: location.end_line, // Renamed from end_line
            endColumn: location.end_column, // Added endColumn
            language: 'javascript', // Added language
            labels: [nodeType, ...extraLabels], // Added labels array
            rawName: rawName, // Added rawName
            // Keep additional properties if needed, matching API schema if possible
            // For now, we assume the above are the primary required fields based on the plan
            // properties: properties // Example: if API supports nested properties
        };
        nodes.push(nodeData); // Use renamed array

        // Add CONTAINS relationship from current scope to this new node
        if (scopeStack.length > 0) {
            const parentScopeId = scopeStack[scopeStack.length - 1];
            createRelationship(parentScopeId, canonicalIdentifier, 'CONTAINS', syntaxNode);
        } else {
            console.warn(`[JS Analyzer] Scope stack empty when adding node: ${nodeType} - ${name}`);
        }

        return globalId;
    };

    // Helper to create a relationship object formatted for the API
    const createRelationship = (sourceNodeId, targetIdentifier, relationshipType, locationSyntaxNode, properties = {}) => {
        if (!sourceNodeId || !targetIdentifier || !relationshipType) {
            console.warn(`[JS Analyzer] Skipping relationship due to missing required fields: ${relationshipType} (Source: ${sourceNodeId}, TargetId: ${targetIdentifier})`);
            return;
        }
        const location = helpers.getCodeLocation(locationSyntaxNode, filePath);
        relationships.push({ // Use renamed array
            sourceId: sourceNodeId, // Renamed from source_node_id
            targetIdentifier: targetIdentifier, // Matches target_identifier
            type: relationshipType, // Renamed from relationship_type
            properties: {
                startLine: location.start_line, // Added startLine
                startColumn: location.start_column, // Added startColumn
                endLine: location.end_line, // Added endLine
                endColumn: location.end_column, // Added endColumn
                ...properties // Include any additional properties
            },
        });
    };

    // Initialize Tree-sitter queries
    const language = JavaScript;
    console.log(`[JS Analyzer] Type of language object before query creation: ${typeof language}`);
    try {
        console.log(`[JS Analyzer] Language object version (test): ${language.version}`);
    } catch (langError) {
        console.error('[JS Analyzer] Error accessing language object property:', langError);
    }

    // Tree-sitter queries are now expected to be handled within processors or passed differently
    // Removing the direct query initialization here as queryStrings is removed.
    // Processors will need adjustment.

    // 1. Create File Node (assuming program node is the root for location)
    const programNode = rootNode; // Use root node for file location info
    const normalizedFilePath = idGen.normalizePath(filePath);
    const fileCanonicalId = idGen.createCanonicalFile(normalizedFilePath);
    const fileNodeId = createNode("File", path.basename(filePath), programNode, fileCanonicalId, ["Root"]); // Add "Root" label?

    if (!fileNodeId) {
        console.error("[JS Analyzer] Failed to create the root File node. Aborting analysis.");
        return { nodes: [], relationships: [] };
    }
    scopeStack.push(fileNodeId); // Initialize scope stack with file ID

    // Define context for helper functions
    const analysisContext = {
        createNode,
        createRelationship,
        getNodeText: helpers.getNodeText,
        filePath,
        fileUniqueId: fileNodeId, // Pass the file's unique ID to processors
        sourceCode
    };

    // Process different node types using helper functions
    try {
        // Processors no longer receive 'queries' object directly
        processors.processFunctions(rootNode, sourceCode, analysisContext, scopeStack);
        processors.processClassesAndMethods(rootNode, sourceCode, analysisContext, scopeStack);
        processors.processImports(rootNode, sourceCode, analysisContext);
        processors.processRequires(rootNode, sourceCode, analysisContext);
        processors.processVariables(rootNode, sourceCode, analysisContext, scopeStack);
        processors.processCalls(rootNode, sourceCode, analysisContext, scopeStack);
    } finally {
        // Ensure scope stack is properly cleaned up
        if (scopeStack.length > 1) {
            console.warn(`[JS Analyzer] Scope stack not empty at end of analysis for ${filePath}. Remaining: ${scopeStack.length}`);
            // Force clear for safety, though this indicates a bug in enter/exit logic
            while (scopeStack.length > 1) scopeStack.pop();
        }
        if (scopeStack.length === 1) scopeStack.pop(); // Pop the file scope
    }

    console.log(`[JS Analyzer] Analysis complete for ${filePath}. Found ${nodes.length} nodes, ${relationships.length} relationships.`);
    return { nodes, relationships }; // Return data formatted for API ingestion
}

module.exports = { analyze };