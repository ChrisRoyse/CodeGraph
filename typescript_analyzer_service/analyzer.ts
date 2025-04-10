// typescript_analyzer_service/analyzer.ts
import * as path from 'path';
import {
    Project, SourceFile, SyntaxKind, Node,
    FunctionDeclaration, ClassDeclaration, MethodDeclaration, VariableDeclaration,
    ImportDeclaration, CallExpression, InterfaceDeclaration, PropertyDeclaration,
    TypeAliasDeclaration, EnumDeclaration, ModuleDeclaration, PropertySignature, MethodSignature,
    FunctionExpression, ClassExpression, ObjectLiteralExpression
} from "ts-morph";
import * as idGen from './id_generator'; // Import ID generation functions

// Define interfaces for the API data structures
// Match the Pydantic Node model in api_gateway/ingestion_schemas.py
export interface AnalysisNode {
    uniqueId: string;
    name: string | null;
    filePath: string;
    startLine: number | null; // Renamed from start_line
    endLine: number | null;   // Renamed from end_line
    language: 'typescript' | 'tsx'; // Added language field
    labels: string[]; // Changed from type: string
    // Removed: start_column, end_column, properties
}

// Match the Pydantic RelationshipStub model in api_gateway/ingestion_schemas.py
export interface AnalysisRelationship {
    sourceId: string;
    targetIdentifier: string | null;
    type: string;
    properties: Record<string, any>; // Optional properties
    // Removed: start_line, start_column, end_line, end_column
}

// Heuristic for potential API calls (can be expanded)
const API_CALL_IDENTIFIERS: string[] = ['fetch', 'axios.get', 'axios.post', 'axios.put', 'axios.delete', 'http.request', 'https.request', '.createClient']; // Add more TS/Node specific ones

// --- Helper Functions ---

function getCodeLocation(node: Node): { start_line: number; start_column: number; end_line: number; end_column: number } {
    const sourceFile = node.getSourceFile();
    const startPos = sourceFile.getLineAndColumnAtPos(node.getStart());
    const endPos = sourceFile.getLineAndColumnAtPos(node.getEnd());
    return {
        start_line: startPos.line,
        start_column: startPos.column,
        end_line: endPos.line,
        end_column: endPos.column,
    };
}

// --- Main Analysis Function ---

/**
 * Analyzes the ts-morph AST and generates nodes and relationships for the database.
 * @param sourceFile - The ts-morph SourceFile object.
 * @param filePath - The path of the file being analyzed.
 * @returns - Object containing nodes and relationships ready for API ingestion.
 */
export async function analyze(sourceFile: SourceFile, filePath: string): Promise<{ nodes: AnalysisNode[], relationships: AnalysisRelationship[] }> {
    const nodes: AnalysisNode[] = [];
    const relationships: AnalysisRelationship[] = [];
    const defined_node_ids_in_run = new Set<string>(); // Track added Global IDs for this run
    const scopeStack: string[] = []; // Stack to hold the Global ID of the current scope
    const normalizedFilePath = idGen.normalizePath(filePath); // Normalize path once

    // --- Helper: Create Node Data ---
    const createNode = (
        nodeType: string,
        name: string | null,
        syntaxNode: Node,
        canonicalIdentifier: string,
        properties: Record<string, any> = {},
        useNormalizedPath?: string // Optional override for file path, used for the File node itself
    ): string | null => {
        const location = getCodeLocation(syntaxNode);
        const language = filePath.endsWith('.tsx') ? 'tsx' : 'typescript'; // Determine language
        // Use the pre-normalized path for ID generation
        const globalId = idGen.generateGlobalId(language, normalizedFilePath, canonicalIdentifier);
        // Removed debug log

        if (defined_node_ids_in_run.has(globalId)) {
            console.debug(`[TS Analyzer] Skipping duplicate node addition for ID: ${globalId} (Type: ${nodeType}, Name: ${name})`);
            return globalId; // Return existing ID but don't add again
        }
        defined_node_ids_in_run.add(globalId);

        // Construct nodeData matching the updated AnalysisNode interface (and API schema)
        const nodeData: AnalysisNode = {
            uniqueId: globalId,
            name: name,
            filePath: useNormalizedPath ?? normalizedFilePath, // Use normalized path
            startLine: location.start_line, // Renamed field
            endLine: location.end_line,     // Renamed field
            language: language,             // Added field
            labels: [nodeType],             // Changed field (wrap type in array)
            // Removed properties, start_column, end_column
        };
        nodes.push(nodeData);

        // Add CONTAINS relationship from current scope
        if (scopeStack.length > 0) {
            const parentScopeId = scopeStack[scopeStack.length - 1];
            // Ensure canonicalIdentifier is valid before creating relationship
            if (parentScopeId && typeof canonicalIdentifier === 'string') {
                createRelationship(parentScopeId, canonicalIdentifier, 'CONTAINS', syntaxNode);
            }
        } // No warning needed if stack is empty (e.g., for File node)

        return globalId;
    }; // <-- Corrected closing brace location

    // --- Helper: Create Relationship Data ---
     const createRelationship = (
        sourceNodeId: string,
        targetIdentifier: string | null, // Can be null if not applicable (e.g., CONTAINS)
        relationshipType: string,
        locationSyntaxNode: Node,
        properties: Record<string, any> = {}
    ): void => {
        if (!sourceNodeId || !relationshipType) { // targetIdentifier can be null for CONTAINS
            console.warn(`[TS Analyzer] Skipping relationship due to missing required fields: ${relationshipType} (Source: ${sourceNodeId}, TargetId: ${targetIdentifier})`);
            return;
        }
        const location = getCodeLocation(locationSyntaxNode);
        // Construct relationship matching the updated AnalysisRelationship interface (and API schema)
        relationships.push({
            sourceId: sourceNodeId,
            targetIdentifier: targetIdentifier,
            type: relationshipType,
            properties: properties, // Keep optional properties
            // Removed start_line, start_column, end_line, end_column
        });
    };

    // --- Start Analysis ---

    // 1. Create File Node
    const fileCanonicalId = idGen.createCanonicalFile(normalizedFilePath);
    // Pass the normalized path explicitly for the 'filePath' property of the File node itself
    const fileNodeId = createNode("File", path.basename(filePath), sourceFile, fileCanonicalId, { full_path: normalizedFilePath }, normalizedFilePath);

    if (!fileNodeId) {
        console.error("[TS Analyzer] Failed to create the root File node. Aborting analysis.");
        return { nodes: [], relationships: [] };
    }
    scopeStack.push(fileNodeId); // Initialize scope stack

    // 2. Process Imports
    sourceFile.getImportDeclarations().forEach(importDecl => {
        const sourcePath = importDecl.getModuleSpecifierValue();
        const defaultImport = importDecl.getDefaultImport()?.getText();
        const namespaceImport = importDecl.getNamespaceImport()?.getText();
        const namedImports = importDecl.getNamedImports().map(ni => ni.getName());

        let representativeName = sourcePath;
        if (defaultImport) representativeName = defaultImport;
        else if (namespaceImport) representativeName = namespaceImport;
        else if (namedImports.length > 0) representativeName = `{${namedImports.join(', ')}}`;

        const canonicalIdentifier = idGen.createCanonicalImport(representativeName, sourcePath);
        const importGlobalId = createNode("Import", representativeName, importDecl, canonicalIdentifier, {
            source: sourcePath,
            type: 'ESM', // Assuming ESM for TS
            named_imports: namedImports,
            has_default_import: !!defaultImport,
            has_namespace_import: !!namespaceImport,
        });

        if (importGlobalId) {
            // Use fileNodeId (guaranteed to be string here) as source
            createRelationship(fileNodeId, sourcePath, "IMPORTS", importDecl);
        }
    });

    // 3. Process Top-Level Declarations (Functions, Classes, Interfaces, etc.)
    // Use a recursive function or iterate through descendants
    const processNode = (node: Node, currentScopeId: string) => {
        scopeStack.push(currentScopeId);
        try {
            // Get the body of the function/method/class if it exists, otherwise traverse direct children
            const body = (node as any).getBody?.(); // Use optional chaining and any for simplicity
            if (body && typeof body.forEachChild === 'function') {
                 // console.log(`[DEBUG] Traversing body of ${node.getKindName()}`);
                 body.forEachChild((child: Node) => traverse(child));
            } else {
                 // Fallback for nodes without a distinct body or if getBody fails
                 // console.log(`[DEBUG] Traversing direct children of ${node.getKindName()}`);
                 node.forEachChild(child => traverse(child));
            }
        } finally {
            scopeStack.pop(); // Ensure scope is popped even if traversal fails
        }
    };

    const traverse = (node: Node) => {
        let newNodeId: string | null = null;
        let canonicalIdentifier: string | undefined;
        let nodeName: string | null = null;
        let nodeType: string | null = null;
        let properties: Record<string, any> = {};
        let processChildren = true; // Whether to descend into this node's children

        // --- Identify Node Type and Extract Info ---
        if (Node.isFunctionDeclaration(node) || Node.isFunctionExpression(node)) {
            nodeType = "Function";
            nodeName = node.getName() ?? '(anonymous)';
            const parameters = node.getParameters().map(p => p.getName());
            canonicalIdentifier = idGen.createCanonicalFunction(nodeName, parameters);
            properties = { parameters, is_async: node.isAsync(), is_generator: node.isGenerator() };
            newNodeId = createNode(nodeType, nodeName, node, canonicalIdentifier, properties);
        } else if (Node.isClassDeclaration(node) || Node.isClassExpression(node)) {
            nodeType = "Class";
            nodeName = node.getName() ?? '(anonymous)';
            canonicalIdentifier = idGen.createCanonicalClassOrInterface(nodeName);
            const heritageClauses = node.getHeritageClauses().map(h => h.getText()); // Simple text for now
            properties = { heritage: heritageClauses };
            newNodeId = createNode(nodeType, nodeName, node, canonicalIdentifier, properties);
        } else if (Node.isInterfaceDeclaration(node)) {
            nodeType = "Interface";
            nodeName = node.getName();
            canonicalIdentifier = idGen.createCanonicalClassOrInterface(nodeName);
             const heritageClauses = node.getHeritageClauses().map(h => h.getText());
            properties = { heritage: heritageClauses };
            newNodeId = createNode(nodeType, nodeName, node, canonicalIdentifier, properties);
        } else if (Node.isConstructorDeclaration(node)) { // Add handler for Constructor
            nodeType = "Method"; // Treat constructor as a method
            nodeName = "constructor";
            const parentClassNode = node.getParentIfKind(SyntaxKind.ClassDeclaration)
                                 ?? node.getParentIfKind(SyntaxKind.ClassExpression);
            const parentClassName = parentClassNode && Node.hasName(parentClassNode) ? parentClassNode.getName() : null;
            const parameters = node.getParameters().map(p => p.getName());
            canonicalIdentifier = idGen.createCanonicalFunction(nodeName, parameters, parentClassName);
            properties = {
                parameters,
                parent_name: parentClassName,
             };
            newNodeId = createNode(nodeType, nodeName, node, canonicalIdentifier, properties);
            // Traverse into constructor body
            if (newNodeId) { // Ensure newNodeId is not null before processing
                processNode(node, newNodeId); // Use processNode to handle scope and body traversal
            }
            processChildren = false; // Already handled by processNode call

        } else if (Node.isMethodDeclaration(node) || Node.isMethodSignature(node)) {
            nodeType = "Method";
            nodeName = node.getName();
            const parentClassNode = node.getParentIfKind(SyntaxKind.ClassDeclaration)
                                 ?? node.getParentIfKind(SyntaxKind.ClassExpression)
                                 ?? node.getParentIfKind(SyntaxKind.InterfaceDeclaration) // Methods can be in interfaces
                                 ?? node.getParentIfKind(SyntaxKind.ObjectLiteralExpression); // Methods in objects
            const parentClassName = parentClassNode && Node.hasName(parentClassNode) ? parentClassNode.getName() : null;
            const parameters = node.getParameters().map(p => p.getName());
            canonicalIdentifier = idGen.createCanonicalFunction(nodeName, parameters, parentClassName);
            properties = {
                parameters,
                is_async: Node.isMethodDeclaration(node) ? node.isAsync() : false, // Only MethodDeclarations can be async
                is_static: Node.isMethodDeclaration(node) ? node.isStatic() : false, // Only MethodDeclarations can be static
                is_abstract: Node.isMethodDeclaration(node) ? node.isAbstract() : false, // Only MethodDeclarations can be abstract
                parent_name: parentClassName,
                return_type: node.getReturnType().getText(),
             };
            newNodeId = createNode(nodeType, nodeName, node, canonicalIdentifier, properties);
        } else if (Node.isVariableDeclaration(node)) {
            nodeType = "Variable";
            nodeName = node.getName();
            // Get parent scope canonical ID (might be function, method, or null for module)
            const parentScopeId = scopeStack.length > 1 ? scopeStack[scopeStack.length - 1] : null; // Use the actual scope ID
            canonicalIdentifier = idGen.createCanonicalVariable(nodeName, parentScopeId); // Pass scope ID
            // Get kind from parent VariableStatement or VariableDeclarationList
            const varStatement = node.getFirstAncestorByKind(SyntaxKind.VariableStatement);
            const kind = varStatement?.getDeclarationKind().toString() ?? 'var';
            properties = { kind, type: node.getType().getText() };
            newNodeId = createNode(nodeType, nodeName, node, canonicalIdentifier, properties);
            // Allow traversal into initializer by default (processChildren remains true)
        } else if (Node.isPropertyDeclaration(node) || Node.isPropertySignature(node)) {
             nodeType = "Property";
             nodeName = node.getName();
             const parentNode = node.getParentIfKind(SyntaxKind.ClassDeclaration)
                               ?? node.getParentIfKind(SyntaxKind.ClassExpression)
                               ?? node.getParentIfKind(SyntaxKind.InterfaceDeclaration);
             const parentName = parentNode && Node.hasName(parentNode) ? parentNode.getName() : null;
             // Get the canonical ID of the parent class/interface
             const parentCanonicalId = parentNode ? idGen.createCanonicalClassOrInterface(parentNode.getName() ?? '') : null;
             canonicalIdentifier = idGen.createCanonicalVariable(nodeName, parentCanonicalId); // Use parent canonical ID as scope
             properties = {
                 is_static: Node.isPropertyDeclaration(node) ? node.isStatic() : false, // Only PropertyDeclarations can be static
                 is_readonly: node.isReadonly(),
                 parent_name: parentName,
                 type: node.getType().getText(),
             };
             newNodeId = createNode(nodeType, nodeName, node, canonicalIdentifier, properties);
             processChildren = false;
        } else if (Node.isCallExpression(node)) {
            nodeType = "Call";
            const expression = node.getExpression();
            const targetText = expression.getText();

            // Heuristic for API calls
            const isApiCall = API_CALL_IDENTIFIERS.some((api: string) => targetText.includes(api)); // API_CALL_IDENTIFIERS defined above
            nodeType = isApiCall ? "ApiCall" : "Call";
            nodeName = targetText; // Use expression text as name

            // Simple canonical ID for calls within the file context
            const callCanonicalIdentifier = `call::${targetText}@${node.getStartLineNumber()}:${node.getStartLinePos()}`;
            const argsText = node.getArguments().map(a => a.getText()).join(', ');
            properties = { target_string: targetText, arguments_string: argsText };

            newNodeId = createNode(nodeType, nodeName, node, callCanonicalIdentifier, properties);

            // Create unresolved CALLS relationship from the *containing scope*
            if (newNodeId && scopeStack.length > 0) {
                const sourceScopeId = scopeStack[scopeStack.length - 1];
                if (typeof sourceScopeId === 'string') { // Ensure sourceScopeId is a string
                    createRelationship(sourceScopeId, targetText, "CALLS", node);
                } else {
                     console.warn(`[TS Analyzer] Could not determine scope string for CALLS relationship from call: ${targetText}`);
                }
            }
            // Don't process children of the call expression itself usually
            processChildren = false;
        }
        // Add more handlers for Interface, Enum, TypeAlias, Module etc.

        // --- Recurse ---
        if (processChildren) {
            if (newNodeId && ['Function', 'Method', 'Class', 'Interface', 'ModuleDeclaration'].includes(nodeType ?? '')) { // Added ModuleDeclaration
                // If we created a new scope node, process its children within that scope
                processNode(node, newNodeId);
            } else {
                // Otherwise, continue traversal in the current scope
                node.forEachChild(child => traverse(child));
            }
        }
    };

    // Start traversal from the source file node
    sourceFile.forEachChild(child => traverse(child));

    // Pop the initial file scope
    if (scopeStack.length === 1 && scopeStack[0] === fileNodeId) {
        scopeStack.pop();
    } else if (scopeStack.length > 0) {
         console.warn(`[TS Analyzer] Scope stack not empty at end of analysis for ${filePath}. Remaining: ${scopeStack.length}`);
         // Clear stack defensively
         while(scopeStack.length > 0) scopeStack.pop();
    }

    console.log(`[TS Analyzer] Analysis complete for ${filePath}. Found ${nodes.length} nodes, ${relationships.length} relationships.`);
    return { nodes, relationships };
}