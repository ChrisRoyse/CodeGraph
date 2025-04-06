import { Project, SourceFile, Node } from 'ts-morph'; // Keep SourceFile for TS resolvers
import { AstNode, RelationshipInfo, ResolverContext } from './types.js';
import { generateEntityId, generateInstanceId, resolveImportPath } from './parser-utils.js';
import { createContextLogger } from '../utils/logger.js';
 // Corrected path
// Import new resolver functions
import { resolveTsModules, resolveTsInheritance, resolveTsCrossFileInteractions, resolveTsComponentUsage } from './resolvers/ts-resolver.js';
import { resolveCIncludes } from './resolvers/c-cpp-resolver.js';
import { resolveJavaRelationships } from './resolvers/java-resolver.js'; // Import Java resolver

const logger = createContextLogger('RelationshipResolver');

/**
 * Resolves cross-file and deferred relationships (Pass 2).
 * Delegates resolution logic to language-specific handlers.
 */
export class RelationshipResolver {
    private nodeIndex: Map<string, AstNode>; // Map entityId -> AstNode
    private relationships: RelationshipInfo[];
    private pass1RelationshipIds: Set<string>; // Store entityIds of relationships found in Pass 1
    private pass1Relationships: RelationshipInfo[]; // Store Pass 1 relationships
    private context: ResolverContext | null = null; // Context for Pass 2 operations

    constructor(allNodes: AstNode[], pass1Relationships: RelationshipInfo[]) {
        this.nodeIndex = new Map(allNodes.map(node => [node.entityId, node]));
        this.relationships = [];
        this.pass1Relationships = pass1Relationships; // Store Pass 1 relationships
        this.pass1RelationshipIds = new Set(pass1Relationships.map(rel => rel.entityId));
        // Log received Pass 1 relationships for debugging
        logger.debug(`[Resolver Init] Received ${pass1Relationships.length} Pass 1 relationships:`);
        pass1Relationships.forEach((rel, index) => {
            if (index < 20 || rel.type === 'EXTENDS' || rel.type === 'IMPLEMENTS') { // Log first 20 and all EXTENDS/IMPLEMENTS
                 logger.debug(`  [${index}] Type: ${rel.type}, Lang: ${rel.language}, Source: ${rel.sourceId}, Target: ${rel.targetId}, Props: ${JSON.stringify(rel.properties)}`);
            }
        });
        logger.info(`RelationshipResolver initialized with ${this.nodeIndex.size} nodes and ${this.pass1RelationshipIds.size} Pass 1 relationship IDs.`);
    }

    /**
     * Resolves relationships using the ts-morph project (for TS/JS) and collected node data.
     * @param project - The ts-morph Project containing parsed TS/JS source files.
     * @returns An object containing the final list of nodes and relationships.
     */
    async resolveRelationships(project: Project): Promise<{ nodes: AstNode[], relationships: RelationshipInfo[] }> { // Update return type
        this.relationships = []; // Reset relationships array for this run
        const now = new Date().toISOString();
        let instanceCounter = { count: 0 }; // Simple counter for Pass 2 instance IDs
        const addedRelEntityIds = new Set<string>(); // Track relationships added in THIS pass

        this.context = {
            nodeIndex: this.nodeIndex,
            addRelationship: (rel) => {
                // Ensure we don't add duplicates based on entityId within this pass
                if (!addedRelEntityIds.has(rel.entityId)) {
                    this.relationships.push(rel);
                    addedRelEntityIds.add(rel.entityId);
                } else {
                    // Optional: Log if a relationship resolution attempt tries to add an existing entityId
                    // logger.debug(`[Resolver] Relationship with entityId ${rel.entityId} already added in Pass 2.`);
                }
            },
            addNode: (node) => {
                // Add or overwrite node in the index. This effectively merges nodes by entityId.
                // The StorageManager will handle the final MERGE in the database.
                this.nodeIndex.set(node.entityId, node);
                // Note: We don't track added node entityIds separately like relationships,
                // as overwriting in the map is the desired behavior for merging.
            },
            generateId: (prefix, identifier, options) => generateInstanceId(instanceCounter, prefix, identifier, options),
            generateEntityId: generateEntityId,
            logger: logger,
            resolveImportPath: resolveImportPath,
            now: now,
        };

        logger.info('Starting Pass 2 relationship resolution...');

        // --- Language Specific Resolution ---
        const fileNodes = Array.from(this.nodeIndex.values()).filter(node => node.kind === 'File' || node.kind === 'PythonModule'); // Include PythonModule

        for (const fileNode of fileNodes) {
            logger.debug(`Resolving relationships for file: ${fileNode.name} (${fileNode.language})`);
            const currentContext = this.context!;
            let sourceFile: SourceFile | undefined;

            // Resolve TS/JS specific relationships using ts-morph SourceFile
            if (fileNode.language === 'TypeScript' || fileNode.language === 'JavaScript' || fileNode.language === 'TSX') {
                sourceFile = project.getSourceFile(fileNode.filePath);
                if (sourceFile) {
                    resolveTsModules(sourceFile, fileNode, currentContext);
                    resolveTsInheritance(sourceFile, fileNode, currentContext);
                    resolveTsCrossFileInteractions(sourceFile, fileNode, currentContext);
                    if (fileNode.language === 'TSX') { // Only run JSX resolver for TSX files
                       resolveTsComponentUsage(sourceFile, fileNode, currentContext);
                    }
                } else {
                     logger.warn(`Could not find ts-morph SourceFile for: ${fileNode.filePath}. Skipping TS/JS Pass 2 resolution.`);
                }
            }

            // Resolve C/C++ Includes (placeholder resolution)
            if (fileNode.language === 'C' || fileNode.language === 'C++') {
                 const cSourceFile = project.getSourceFile(fileNode.filePath); // Attempt to get it anyway
                 if (cSourceFile) {
                    resolveCIncludes(cSourceFile, fileNode, currentContext);
                 } else {
                     logger.warn(`Could not find ts-morph SourceFile for C/C++ file: ${fileNode.filePath}. Skipping include resolution.`);
                 }
            }

            // Resolve Java relationships (Packages only for now)
            if (fileNode.language === 'Java') {
                resolveJavaRelationships(fileNode, currentContext);
            }

            // TODO: Add calls to language-specific resolvers for Python, Go, C#, SQL etc.
        }
        // --- End Language Specific Resolution ---


        // --- Resolve Placeholder Relationships from Pass 1 ---
        logger.info('Resolving placeholder relationships from Pass 1...');
        for (const p1Rel of this.pass1Relationships) {
            // Check if this relationship was already added/replaced by a Pass 2 resolver
            // Use the ORIGINAL placeholder entityId for this check
            if (addedRelEntityIds.has(p1Rel.entityId)) {
                continue;
            }

            let isPlaceholderResolved = false; // Flag to track if p1Rel was handled as a placeholder

            // --- C++ Placeholders ---
            if (p1Rel.language === 'C++') {
                if (p1Rel.type === 'EXTENDS') {
                    logger.debug(`[Resolver] Found C++ EXTENDS placeholder: ${p1Rel.entityId} from ${p1Rel.sourceId}`);
                    if (!p1Rel.properties?.targetName || !p1Rel.properties?.targetKind) {
                        logger.warn(`[Resolver] C++ EXTENDS placeholder ${p1Rel.entityId} is missing targetName or targetKind property. Keeping placeholder.`);
                        this.context!.addRelationship(p1Rel); // Keep original placeholder
                    } else {
                        const childClassNode = this.nodeIndex.get(p1Rel.sourceId);
                        const parentClassName = p1Rel.properties.targetName;
                        const parentKind = p1Rel.properties.targetKind;
                        const parentClassNode = Array.from(this.nodeIndex.values()).find(
                            node => (node.kind === parentKind || node.kind === 'Class') && node.name === parentClassName
                        );
                        logger.debug(`[Resolver] Searching for C++ parent: Name=${parentClassName}, Kind=${parentKind}. Found: ${!!parentClassNode}`);
                        if (parentClassNode && childClassNode) {
                            logger.debug(`Updating C++ EXTENDS placeholder: ${p1Rel.entityId} Target -> ${parentClassNode.entityId}`);
                            // Modify original relationship object
                            p1Rel.targetId = parentClassNode.entityId; // Update target
                            p1Rel.entityId = this.context!.generateEntityId(p1Rel.type.toLowerCase(), `${p1Rel.sourceId}:${p1Rel.targetId}`); // Regenerate entityId
                            delete p1Rel.properties?.targetName;
                            delete p1Rel.properties?.targetKind;
                            this.context!.addRelationship(p1Rel); // Add modified original
                        } else {
                            logger.warn(`Could not resolve C++ parent class '${parentClassName}' (Kind: ${parentKind}) for EXTENDS relationship from ${childClassNode?.name ?? p1Rel.sourceId}. Keeping placeholder.`);
                            this.context!.addRelationship(p1Rel); // Keep original placeholder
                        }
                    }
                    isPlaceholderResolved = true;
                }
                // Add other C++ placeholder checks here if needed
            }
            // --- C# Placeholders ---
            else if (p1Rel.language === 'C#') {
                if (p1Rel.type === 'IMPLEMENTS' || p1Rel.type === 'EXTENDS') {
                    logger.debug(`[Resolver] Found C# ${p1Rel.type} placeholder: ${p1Rel.entityId} from ${p1Rel.sourceId}`);
                    if (!p1Rel.properties?.targetName) {
                        logger.warn(`[Resolver] C# ${p1Rel.type} placeholder ${p1Rel.entityId} is missing targetName property. Keeping placeholder.`);
                        this.context!.addRelationship(p1Rel); // Keep original placeholder
                    } else {
                        const childNode = this.nodeIndex.get(p1Rel.sourceId);
                        const baseName = p1Rel.properties.targetName;
                        const baseNode = Array.from(this.nodeIndex.values()).find(
                            node => (node.kind === 'CSharpClass' || node.kind === 'CSharpInterface' || node.kind === 'Class' || node.kind === 'Interface') && node.name === baseName
                        );
                        logger.debug(`[Resolver] Searching for C# base: Name=${baseName}. Found: ${!!baseNode}`);
                        if (baseNode && childNode) {
                            const resolvedRelType = baseNode.kind === 'CSharpClass' || baseNode.kind === 'Class' ? 'EXTENDS' : 'IMPLEMENTS';
                            logger.debug(`Updating C# ${p1Rel.type} as ${resolvedRelType}: ${childNode.name} -> ${baseName}`);
                            // Modify original relationship object
                            p1Rel.type = resolvedRelType; // Update type
                            p1Rel.targetId = baseNode.entityId; // Update target
                            p1Rel.entityId = this.context!.generateEntityId(p1Rel.type.toLowerCase(), `${p1Rel.sourceId}:${p1Rel.targetId}`); // Regenerate entityId
                            delete p1Rel.properties?.targetName;
                            this.context!.addRelationship(p1Rel); // Add modified original
                        } else {
                            logger.warn(`Could not resolve base type '${baseName}' for ${p1Rel.type} relationship from ${childNode?.name ?? p1Rel.sourceId}. Keeping placeholder.`);
                            this.context!.addRelationship(p1Rel); // Keep original placeholder
                        }
                    }
                    isPlaceholderResolved = true;
                }
                 // Add other C# placeholder checks here if needed
            }
            // --- Java Placeholders ---
            else if (p1Rel.language === 'Java') {
                if (p1Rel.type === 'IMPLEMENTS' || p1Rel.type === 'EXTENDS') {
                    logger.debug(`[Resolver] Found Java ${p1Rel.type} placeholder: ${p1Rel.entityId} from ${p1Rel.sourceId}`);
                    if (!p1Rel.properties?.targetName) {
                        logger.warn(`[Resolver] Java ${p1Rel.type} placeholder ${p1Rel.entityId} is missing targetName property. Keeping placeholder.`);
                        this.context!.addRelationship(p1Rel); // Keep original placeholder
                    } else {
                        const childNode = this.nodeIndex.get(p1Rel.sourceId);
                        const baseName = p1Rel.properties.targetName;
                        const baseNode = Array.from(this.nodeIndex.values()).find(
                            node => (node.kind === 'JavaClass' || node.kind === 'JavaInterface' || node.kind === 'Class' || node.kind === 'Interface') &&
                                    (node.name === baseName || node.properties?.qualifiedName === baseName)
                        );
                        logger.debug(`[Resolver] Searching for Java base: Name=${baseName}. Found: ${!!baseNode}`);
                        if (baseNode && childNode) {
                            const resolvedRelType = (baseNode.kind === 'JavaClass' || baseNode.kind === 'Class') ? 'EXTENDS' : 'IMPLEMENTS';
                            logger.debug(`Updating Java ${p1Rel.type} as ${resolvedRelType}: ${childNode.name} -> ${baseName}`);
                            // Modify original relationship object
                            p1Rel.type = resolvedRelType; // Update type
                            p1Rel.targetId = baseNode.entityId; // Update target
                            p1Rel.entityId = this.context!.generateEntityId(p1Rel.type.toLowerCase(), `${p1Rel.sourceId}:${p1Rel.targetId}`); // Regenerate entityId
                            delete p1Rel.properties?.targetName;
                            this.context!.addRelationship(p1Rel); // Add modified original
                        } else {
                            logger.warn(`Could not resolve base type '${baseName}' for ${p1Rel.type} relationship from ${childNode?.name ?? p1Rel.sourceId}. Keeping placeholder.`);
                            this.context!.addRelationship(p1Rel); // Keep original placeholder
                        }
                    }
                    isPlaceholderResolved = true;
                }
                // Add other Java placeholder checks here if needed
            }

            // --- Add other Pass 1 relationships ---
            // Only add if it wasn't a placeholder that we attempted to resolve (successfully or unsuccessfully)
            if (!isPlaceholderResolved) {
                 // Exclude the original File->DECLARES_PACKAGE relationships for Java,
                 // as they are replaced by JavaPackage->CONTAINS->File in the Java resolver.
                 if (!(p1Rel.type === 'DECLARES_PACKAGE' && p1Rel.language === 'Java')) {
                     // Check if source and target nodes still exist for other relationships
                     if (this.nodeIndex.has(p1Rel.sourceId) && this.nodeIndex.has(p1Rel.targetId)) {
                         this.context!.addRelationship(p1Rel);
                     } else {
                         // Check if target was a placeholder that *should* have been resolved but wasn't found
                         if (p1Rel.targetId.startsWith('placeholder:')) {
                             logger.warn(`Pass 1 relationship ${p1Rel.type} (${p1Rel.entityId}) target node ${p1Rel.targetId} could not be resolved and source/target node might not exist.`);
                         } else {
                             logger.debug(`Skipping Pass 1 relationship ${p1Rel.type} (${p1Rel.entityId}) as source/target node no longer exists.`);
                         }
                     }
                 } else {
                     logger.debug(`Skipping original Java DECLARES_PACKAGE relationship: ${p1Rel.entityId}`);
                 }
            }
        }
        logger.info(`Finished resolving placeholder relationships. Total relationships now: ${this.relationships.length}`);
        // --- End Placeholder Resolution ---

        // Log final relationships before returning, focusing on IMPLEMENTS
        logger.debug(`[Resolver Final] Total relationships before return: ${this.relationships.length}`);
        this.relationships.filter(r => r.type === 'IMPLEMENTS').forEach((rel, index) => {
            logger.debug(`  [Final IMPLEMENTS ${index}] entityId: ${rel.entityId}, source: ${rel.sourceId}, target: ${rel.targetId}`);
        });

        const finalNodes = Array.from(this.nodeIndex.values()); // Get final nodes from the potentially modified index
        logger.info(`Pass 2 resolution finished. Found ${this.relationships.length} relationships. Final node count: ${finalNodes.length}`);
        this.context = null;
        return { nodes: finalNodes, relationships: this.relationships }; // Return final nodes and relationships
    }

    // --- Helper Methods --- (Only keep essential ones if needed by the class itself)

    private findNodeByFilePath(filePath: string): AstNode | undefined {
        const normalizedPath = filePath.replace(/\\/g, '/');
        const fileEntityId = generateEntityId('file', normalizedPath);
        // Also check for PythonModule kind if the path matches
        return this.nodeIndex.get(fileEntityId) ?? this.nodeIndex.get(generateEntityId('pythonmodule', normalizedPath));
    }

    // Removed resolveModules, resolveInheritance, resolveCrossFileInteractions,
    // analyzeBodyInteractions, resolveComponentUsage, resolveCIncludes
    // Removed isInsideConditionalContext (moved to ts-resolver.ts)
}