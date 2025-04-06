/**
 * @file Analyzes a list of IR entities to detect relationships and generate graph database queries.
 */

import path from 'path'; // Needed for potential import resolution
import {
    IrElement,
    ElementType,
    PotentialRelationship,
    RelationshipType, // Keep if used directly
    CanonicalId,
    ApiFetchProperties,
    DatabaseQueryProperties,
    CallsProperties, // Updated
    InheritsProperties, // Updated
    ImplementsProperties, // Updated
    InstantiatesProperties, // Updated
    ImportsProperties, // Updated
    ReadsProperties, // Updated
    WritesProperties, // Updated
    ApiRouteDefinitionProperties,
    DatabaseColumnProperties,
    FunctionProperties,
    ClassProperties,
    InterfaceProperties,
    VariableProperties,
    DatabaseTableProperties // Added missing import
} from './schema.js'; // Import types/values directly
import { createContextLogger } from '../utils/logger.js'; // Assuming logger is ESM

const logger = createContextLogger('IrAnalyzer');

/**
 * Represents the output of the IR analysis, containing Cypher queries.
 */
export interface IrAnalysisResult { // Ensure export
  /** Cypher queries to create/merge nodes. */
  nodeQueries: string[];
  /** Cypher queries to create/merge relationships. */
  relationshipQueries: string[];
}

// Cache for faster lookups
type ElementMap = Map<CanonicalId, IrElement>;
type ElementByTypeMap = Map<ElementType, IrElement[]>;
type ElementByFilePathMap = Map<string, IrElement[]>; // Map filePath to elements in that file

// --- Main Analysis Function ---

/**
 * Analyzes a list of IR entities to find relationships and generate Cypher queries.
 *
 * @param elements An array of all IrElement objects from the project.
 * @param potentialRelationships An array of all PotentialRelationship objects from the project.
 * @returns An object containing Cypher queries for nodes and resolved relationships.
 */
export function analyzeIr( // Export the main function
  elements: IrElement[],
  potentialRelationships: PotentialRelationship[],
): IrAnalysisResult {
  logger.info(`[IR Analyzer] Analyzing ${elements.length} elements and ${potentialRelationships.length} potential relationships...`);

  const nodeQueries: string[] = [];
  const relationshipQueries: string[] = [];

  // --- Pre-processing: Create lookup maps for efficiency ---
  const elementMap: ElementMap = new Map(elements.map(el => [el.id, el]));
  const elementsByType: ElementByTypeMap = new Map();
  const elementsByFilePath: ElementByFilePathMap = new Map();

  for (const el of elements) {
    // Populate elementsByType map
    if (!elementsByType.has(el.type)) {
      elementsByType.set(el.type, []);
    }
    elementsByType.get(el.type)!.push(el);

    // Populate elementsByFilePath map
    if (el.filePath) { // Ensure filePath exists
        if (!elementsByFilePath.has(el.filePath)) {
            elementsByFilePath.set(el.filePath, []);
        }
        elementsByFilePath.get(el.filePath)!.push(el);
    } else {
        logger.warn(`Element ${el.id} (${el.name}) missing filePath.`);
    }
  }
  logger.debug(`Built lookup maps: ${elementMap.size} by ID, ${elementsByType.size} types, ${elementsByFilePath.size} files.`);

  // --- Relationship Resolution ---
  logger.info(`Resolving ${potentialRelationships.length} potential relationships...`);
  let resolvedCount = 0;
  let unresolvedCount = 0;
  for (const potentialRel of potentialRelationships) {
    const sourceElement = elementMap.get(potentialRel.sourceId);
    if (!sourceElement) {
      logger.warn(`Source element ${potentialRel.sourceId} not found for potential relationship.`);
      unresolvedCount++;
      continue;
    }

    // Special handling for DatabaseQuery as it resolves internally
    if (potentialRel.type === 'DatabaseQuery') {
        resolveDatabaseQuery(potentialRel, sourceElement, elementsByType, relationshipQueries);
        // We don't increment resolvedCount here as it adds multiple relationships internally
        continue; // Move to the next potential relationship
    }

    const targetElement = resolveRelationship(
        potentialRel,
        sourceElement,
        elementMap,
        elementsByType,
        elementsByFilePath
    );

    if (targetElement) {
        // Create Cypher query for the resolved relationship
        createRelationshipQuery(potentialRel, sourceElement, targetElement, relationshipQueries);
        resolvedCount++;
    } else {
        // Log unresolved relationships (excluding DatabaseQuery and Imports)
        if (potentialRel.type !== 'Imports') {
             logger.warn(`Failed to resolve target for ${potentialRel.type} from ${potentialRel.sourceId} (type: ${sourceElement.type}, name: ${sourceElement.name}) targeting '${potentialRel.targetPattern}' at ${sourceElement.filePath}:${potentialRel.location.start.line}`);
             unresolvedCount++;
        }
    }
  }
  logger.info(`Relationship resolution complete: ${resolvedCount} resolved, ${unresolvedCount} unresolved (excluding DB queries).`);

  // --- Add Relationships Derived Directly from Element Properties ---
  logger.info(`Adding implicit relationships derived from element properties...`);
  addImplicitRelationships(elements, elementsByType, relationshipQueries);


  // --- Cypher Query Generation for Nodes ---
  logger.info(`Generating Cypher queries for ${elements.length} nodes...`);
  for (const element of elements) {
    const labels = getLabelsForElementType(element.type);
    const properties = buildPropertiesString(element);
    nodeQueries.push(
      `MERGE (n:${labels} { id: '${escapeString(element.id)}' }) SET n += ${properties}` // Use += to merge properties, escape ID
    );
  }

  logger.info(`[IR Analyzer] Generated ${nodeQueries.length} node queries and ${relationshipQueries.length} relationship queries.`);

  return {
    nodeQueries,
    relationshipQueries,
  };
}

// --- Resolver Dispatch ---

function resolveRelationship(
    potentialRel: PotentialRelationship,
    sourceElement: IrElement,
    elementMap: ElementMap,
    elementsByType: ElementByTypeMap,
    elementsByFilePath: ElementByFilePathMap
): IrElement | undefined { // Return only the target element or undefined
    switch (potentialRel.type) {
        case 'ApiFetch':
            return resolveApiFetch(potentialRel, elementsByType);
        // DatabaseQuery is handled before calling this function
        case 'Calls':
            return resolveFunctionCall(potentialRel, sourceElement, elementsByType, elementsByFilePath);
        case 'Inherits':
            return resolveInheritanceImplementation(potentialRel, sourceElement, elementsByType);
        case 'Implements':
             return resolveInheritanceImplementation(potentialRel, sourceElement, elementsByType, 'Interface');
        case 'Instantiates':
            return resolveInstantiation(potentialRel, elementsByType);
        case 'Imports':
            // TODO: Implement robust import resolution.
            return undefined;
        case 'Reads':
        case 'Writes':
            return resolveVariableAccess(potentialRel, sourceElement, elementsByType, elementsByFilePath);
        // TODO: Add cases for AnnotationUsage etc.
        default:
            logger.warn(`Unknown potential relationship type encountered in resolver dispatch: ${potentialRel.type}`);
            return undefined;
    }
}

// --- Specific Resolver Implementations ---

function resolveApiFetch(potentialRel: PotentialRelationship, elementsByType: ElementByTypeMap): IrElement | undefined {
    const props = potentialRel.properties as ApiFetchProperties;
    const apiRouteDefinitions = elementsByType.get('ApiRouteDefinition') || [];

    // TODO: Improve route matching logic significantly (path-to-regexp?)
    return apiRouteDefinitions.find(route => {
        const routeProps = route.properties as ApiRouteDefinitionProperties;
        if (props.httpMethod?.toUpperCase() !== routeProps?.httpMethod?.toUpperCase()) {
            return false;
        }
        return matchRoutePath(props.urlPattern, routeProps?.pathPattern);
    });
}

function resolveDatabaseQuery(
    potentialRel: PotentialRelationship,
    sourceElement: IrElement,
    elementsByType: ElementByTypeMap,
    relationshipQueries: string[] // Pass relationshipQueries array to add relationships directly
): void { // Changed return type to void
    const props = potentialRel.properties as DatabaseQueryProperties;
    const tables = elementsByType.get('DatabaseTable') || [];
    const columns = elementsByType.get('DatabaseColumn') || [];

    // Resolve Table References
    if (props.targetTables) {
        for (const tableName of props.targetTables) {
            // TODO: Improve table name matching (schema awareness, case sensitivity)
            const targetTable = tables.find(t => {
                const tableProps = t.properties as DatabaseTableProperties;
                const qualifiedName = tableProps.schemaName ? `${tableProps.schemaName}.${t.name}` : t.name;
                // Basic matching for now, needs refinement
                return qualifiedName === tableName || t.name === tableName;
            });

            if (targetTable) {
                relationshipQueries.push(
                    createRelationshipQueryDirect( // Use direct creation helper
                        potentialRel.sourceId,
                        targetTable.id,
                        'REFERENCES_TABLE',
                        {
                            queryType: props.queryType || 'UNKNOWN',
                            ormMethod: props.ormMethod || '',
                            locationLine: potentialRel.location.start.line
                        }
                    )
                );

                // Resolve Column References *within this resolved table*
                if (props.targetColumns) {
                    for (const columnName of props.targetColumns) {
                        const targetColumn = columns.find(c =>
                            (c.properties as DatabaseColumnProperties)?.parentId === targetTable.id &&
                            c.name === columnName
                        );
                        if (targetColumn) {
                            relationshipQueries.push(
                                createRelationshipQueryDirect(
                                    potentialRel.sourceId,
                                    targetColumn.id,
                                    'REFERENCES_COLUMN',
                                    {
                                        queryType: props.queryType || 'UNKNOWN',
                                        locationLine: potentialRel.location.start.line
                                    }
                                )
                            );
                        } else {
                            // logger.warn(`[IR Analyzer] Failed to resolve column '${columnName}' in table '${tableName}' for query from ${potentialRel.sourceId}`);
                        }
                    }
                }
            } else {
                 logger.warn(`[IR Analyzer] Failed to resolve table '${tableName}' for query from ${potentialRel.sourceId}`);
            }
        }
    } else if (props.targetColumns && props.targetColumns.length > 0) {
        logger.warn(`[IR Analyzer] Query from ${potentialRel.sourceId} mentions columns but no tables explicitly resolved: ${JSON.stringify(props.targetColumns)}`);
    }
}


function resolveFunctionCall(
    potentialRel: PotentialRelationship,
    sourceElement: IrElement,
    elementsByType: ElementByTypeMap,
    elementsByFilePath: ElementByFilePathMap
): IrElement | undefined {
    const functions = elementsByType.get('Function') || [];
    const targetName = potentialRel.targetPattern;

    // TODO: Implement robust resolution: Scope, Imports, Class context, Namespaces.

    // 1. Check within the same file (simplistic scope)
    if (sourceElement.filePath) {
        const elementsInFile = elementsByFilePath.get(sourceElement.filePath) || [];
        let target = elementsInFile.find(f => f.type === 'Function' && f.name === targetName);
        if (target) {
            // logger.debug(`Resolved FunctionCall '${targetName}' within same file ${sourceElement.filePath}`);
            return target;
        }
    }

    // 2. Global lookup (fallback - inaccurate)
    let target = functions.find(f => f.name === targetName);
    if (target) {
        logger.warn(`Function call to '${targetName}' from ${sourceElement.id} resolved via global fallback to ${target.id}. Accuracy not guaranteed.`);
        return target;
    }

    return undefined;
}

function resolveInheritanceImplementation(
    potentialRel: PotentialRelationship,
    sourceElement: IrElement,
    elementsByType: ElementByTypeMap,
    targetTypeHint?: ElementType
): IrElement | undefined {
    const targetName = potentialRel.targetPattern;
    const possibleTargetTypes: ElementType[] = targetTypeHint ? [targetTypeHint] : ['Class', 'Interface'];
    const candidates: IrElement[] = possibleTargetTypes.flatMap(type => elementsByType.get(type) || []);

    // TODO: Improve with import/namespace resolution.

    // Basic name matching (global fallback)
    const target = candidates.find(el => el.name === targetName);
     if (target) {
        if (target.id === sourceElement.id) {
            logger.warn(`Potential self-inheritance/implementation detected for ${sourceElement.id} targeting '${targetName}'. Skipping.`);
            return undefined;
        }
        return target;
    }
    return undefined;
}

function resolveInstantiation(potentialRel: PotentialRelationship, elementsByType: ElementByTypeMap): IrElement | undefined {
    const classes = elementsByType.get('Class') || [];
    const targetName = potentialRel.targetPattern;
    // TODO: Improve with import/namespace resolution.
    // Basic name matching (global fallback)
    const target = classes.find(c => c.name === targetName);
     if (target) return target;
    return undefined;
}

function resolveVariableAccess(
    potentialRel: PotentialRelationship,
    sourceElement: IrElement,
    elementsByType: ElementByTypeMap,
    elementsByFilePath: ElementByFilePathMap
): IrElement | undefined {
    const variables = elementsByType.get('Variable') || [];
    const targetName = potentialRel.targetPattern;

    // TODO: Implement robust scope and import resolution.
    // TODO: Handle class member variables (this.variable).

    // 1. Check within the same file (simplistic scope)
    if (sourceElement.filePath) {
        const elementsInFile = elementsByFilePath.get(sourceElement.filePath) || [];
        let target = elementsInFile.find(v => v.type === 'Variable' && v.name === targetName);
        if (target) {
            return target;
        }
    }

    // 2. Global lookup (fallback - very inaccurate) - Avoid for variables

    return undefined;
}


// --- Implicit Relationship Generation ---

function addImplicitRelationships(
    elements: IrElement[],
    elementsByType: ElementByTypeMap,
    relationshipQueries: string[]
): void {
    logger.debug('Adding implicit relationships...');
    let addedCount = 0;
    // HAS_COLUMN and FOREIGN_KEY_TO from DatabaseColumn properties
    const columns = elementsByType.get('DatabaseColumn') || [];
    for (const col of columns) {
        const colProps = col.properties as DatabaseColumnProperties;
        // Link Column to its Parent Table
        if (colProps?.parentId) {
             const existingHasColumn = relationshipQueries.some(q => q.includes(`MATCH (s { id: '${colProps.parentId}' }), (t { id: '${col.id}' }) MERGE (s)-[:HAS_COLUMN`));
             if (!existingHasColumn) {
                relationshipQueries.push(createRelationshipQueryDirect(colProps.parentId, col.id, 'HAS_COLUMN'));
                addedCount++;
             }
        }
        // Link Column to the Column it references via Foreign Key
        if (colProps?.isForeignKey && colProps.referencesColumn) {
             const existingFkTo = relationshipQueries.some(q => q.includes(`MATCH (s { id: '${col.id}' }), (t { id: '${colProps.referencesColumn}' }) MERGE (s)-[:FOREIGN_KEY_TO`));
             if (!existingFkTo) {
                 relationshipQueries.push(createRelationshipQueryDirect(col.id, colProps.referencesColumn, 'FOREIGN_KEY_TO'));
                 addedCount++;
             }
        }
         // Optional: Link Column to the *Table* it references via Foreign Key
         if (colProps?.isForeignKey && colProps.referencesTable) {
             const existingFkTable = relationshipQueries.some(q => q.includes(`MATCH (s { id: '${col.id}' }), (t { id: '${colProps.referencesTable}' }) MERGE (s)-[:FOREIGN_KEY_REFERENCES_TABLE`));
             if (!existingFkTable) {
                 relationshipQueries.push(createRelationshipQueryDirect(col.id, colProps.referencesTable, 'FOREIGN_KEY_REFERENCES_TABLE'));
                 addedCount++;
             }
         }
    }

    // HANDLED_BY from ApiRouteDefinition properties
    const apiRoutes = elementsByType.get('ApiRouteDefinition') || [];
    for (const route of apiRoutes) {
        const routeProps = route.properties as ApiRouteDefinitionProperties;
        if (routeProps?.handlerId) {
            const existingHandledBy = relationshipQueries.some(q => q.includes(`MATCH (s { id: '${route.id}' }), (t { id: '${routeProps.handlerId}' }) MERGE (s)-[:HANDLED_BY`));
            if (!existingHandledBy) {
                relationshipQueries.push(createRelationshipQueryDirect(route.id, routeProps.handlerId, 'HANDLED_BY'));
                addedCount++;
            }
        }
    }
    logger.debug(`Added ${addedCount} implicit relationships.`);
}


// --- Helper Functions ---

/** Placeholder function to match a called path against a defined route pattern. */
function matchRoutePath(calledPath: string | undefined, routePattern: string | undefined): boolean {
    if (!calledPath || !routePattern) return false;
    const normalize = (p: string) => (p.length > 1 && p.endsWith('/')) ? p.slice(0, -1) : p;
    calledPath = normalize(calledPath);
    routePattern = normalize(routePattern);
    if (calledPath === routePattern) return true;
    try {
        // Basic parameter handling: replace {param} or :param with a wildcard segment match
        const patternRegex = new RegExp('^' + routePattern
            .replace(/\{[^}]+\}/g, '([^/]+)') // Replace {param} -> non-slash segment
            .replace(/:\w+/g, '([^/]+)')      // Replace :param -> non-slash segment
            + '$');
        return patternRegex.test(calledPath);
    } catch (e) {
        logger.error(`Error creating regex for route pattern "${routePattern}":`, e);
        return false;
    }
}

/** Determines the Neo4j labels based on the ElementType. */
function getLabelsForElementType(elementType: ElementType): string {
  const code = 'CodeElement';
  const net = 'NetworkElement';
  const data = 'DataSourceElement';
  const fs = 'FileSystemElement'; // Added for File type

  switch (elementType) {
    case 'Function': return `${code}:Function`;
    case 'Class': return `${code}:Class`;
    case 'Interface': return `${code}:Interface`;
    case 'Variable': return `${code}:Variable`;
    case 'ApiRouteDefinition': return `${net}:ApiRoute`;
    case 'DatabaseTable': return `${data}:DatabaseTable`;
    case 'DatabaseColumn': return `${data}:DatabaseColumn`;
    case 'DatabaseSchemaDefinition': return `${data}:DatabaseSchema`;
    case 'File': return `${fs}:File`; // Added File type label
    default:
      logger.warn(`Unhandled element type for label generation: ${elementType}. Using base label.`);
      if ((elementType as string).startsWith('Api')) return net;
      if ((elementType as string).startsWith('Database')) return data;
      return code;
  }
}

/** Builds a Cypher properties map string from an IrElement object. */
function buildPropertiesString(element: IrElement): string {
  const propsToStore: Record<string, any> = {
      name: element.name,
      type: element.type,
      filePath: element.filePath,
      startLine: element.location.start.line,
      startColumn: element.location.start.column,
      endLine: element.location.end.line,
      endColumn: element.location.end.column,
      rawSignature: element.properties.rawSignature, // Access nested property
  };

  if (element.properties) {
      const internalLinkKeys = new Set([
          'parentId', 'handlerId', 'extends', 'implements',
          'referencesTable', 'referencesColumn', 'targetTables', 'targetColumns',
          'targetId', 'parameters', // Exclude parameters array for now
      ]);
      for (const key in element.properties) {
          if (!internalLinkKeys.has(key)) {
              const value = (element.properties as Record<string, any>)[key];
              if (typeof value !== 'object' || value === null ||
                  (Array.isArray(value) && value.every(item => typeof item !== 'object' || item === null)))
              {
                  propsToStore[key] = value;
              }
          }
      }
  }
  // Remove undefined properties before stringifying
  Object.keys(propsToStore).forEach(key => propsToStore[key] === undefined && delete propsToStore[key]);
  return JSON.stringify(propsToStore);
}

/** Creates a Cypher MERGE query string for a relationship based on a PotentialRelationship and resolved target. */
function createRelationshipQuery(
    potentialRel: PotentialRelationship,
    sourceElement: IrElement,
    targetElement: IrElement,
    relationshipQueries: string[] // Add to this array directly
): void {
    let relType: string;
    let properties: Record<string, any> = {
        locationLine: potentialRel.location.start.line,
        rawReference: potentialRel.properties.rawReference?.substring(0, 255) // Access nested property
    };

    // Map PotentialRelationship type to Cypher relationship type and properties
    switch (potentialRel.type) {
        case 'ApiFetch':
            relType = 'FETCHES';
            properties = { ...properties, ...(potentialRel.properties as ApiFetchProperties) };
            break;
        case 'Calls':
            relType = 'CALLS';
            properties = { ...properties, ...(potentialRel.properties as CallsProperties) };
            break;
        case 'Inherits':
            relType = determineInheritanceRelType(sourceElement.type, targetElement.type);
            properties = { ...properties, ...(potentialRel.properties as InheritsProperties) };
            break;
        case 'Implements':
            relType = 'IMPLEMENTS';
            properties = { ...properties, ...(potentialRel.properties as ImplementsProperties) };
            break;
        case 'Instantiates':
            relType = 'INSTANTIATES';
            properties = { ...properties, ...(potentialRel.properties as InstantiatesProperties) };
            break;
        case 'Reads':
            relType = 'READS';
            properties = { ...properties, ...(potentialRel.properties as ReadsProperties) };
            break;
        case 'Writes':
            relType = 'WRITES';
            properties = { ...properties, ...(potentialRel.properties as WritesProperties) };
            break;
        // case 'Imports': // Imports are handled differently
        //     relType = 'IMPORTS';
        //     properties = { ...properties, ...(potentialRel.properties as ImportsProperties) };
        //     break;
        default:
            logger.warn(`Cannot create query for unknown resolved relationship type: ${potentialRel.type}`);
            return;
    }

    relationshipQueries.push(
        createRelationshipQueryDirect(potentialRel.sourceId, targetElement.id, relType, properties)
    );

    // Handle implicit HANDLED_BY for ApiFetch -> ApiRouteDefinition
    if (potentialRel.type === 'ApiFetch' && targetElement.type === 'ApiRouteDefinition') {
        const handlerId = (targetElement.properties as ApiRouteDefinitionProperties)?.handlerId;
        if (handlerId) {
             const existingHandledBy = relationshipQueries.some(q => q.includes(`MATCH (s { id: '${targetElement!.id}' }), (t { id: '${handlerId}' }) MERGE (s)-[:HANDLED_BY`));
             if (!existingHandledBy) {
                 relationshipQueries.push(
                     createRelationshipQueryDirect(targetElement.id, handlerId, 'HANDLED_BY')
                 );
             }
        }
    }
}

/** Creates a Cypher MERGE query string directly from IDs, type, and properties. */
function createRelationshipQueryDirect(
    sourceId: CanonicalId,
    targetId: CanonicalId,
    relType: string,
    properties?: Record<string, any>
): string {
    const validProperties = properties ? Object.entries(properties)
        .filter(([, value]) => value !== undefined && value !== null)
        .reduce((acc, [key, value]) => {
            acc[key] = value;
            return acc;
        }, {} as Record<string, any>) : {};

    const propsString = Object.keys(validProperties).length > 0
        ? ` ${JSON.stringify(validProperties)}`
        : '';

    // Use SET r += props for merging properties safely
    return `MATCH (s { id: '${escapeString(sourceId)}' }), (t { id: '${escapeString(targetId)}' }) MERGE (s)-[r:${escapeString(relType)}]->(t)${propsString ? ` SET r += ${propsString}` : ''}`;
}

/** Determines the specific relationship type for inheritance/extension based on schema types. */
function determineInheritanceRelType(sourceType: ElementType, targetType: ElementType): string {
    if (sourceType === 'Class' && targetType === 'Class') return 'EXTENDS_CLASS';
    if (sourceType === 'Interface' && targetType === 'Interface') return 'EXTENDS_INTERFACE';
    logger.warn(`Ambiguous inheritance between ${sourceType} and ${targetType}. Using generic INHERITS_FROM.`);
    return 'INHERITS_FROM';
}

/** Escapes a string for safe inclusion *directly* within a Cypher query string literal. */
function escapeString(str: string | undefined | null): string {
    if (str === null || str === undefined) return '';
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// Export the main analysis function
// Note: Internal helper functions are not exported by default.
// export { analyzeIr }; // Already exported via index.ts re-export
