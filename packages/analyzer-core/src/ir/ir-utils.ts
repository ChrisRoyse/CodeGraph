/**
 * @file Utilities for Intermediate Representation (IR) processing, including ID generation.
 */

// Import types using ESM syntax
import type {
    IrElement,
    ElementType, // Import directly
    CanonicalId, // Import directly
    FunctionProperties, // Import directly
    ClassProperties, // Import directly
    InterfaceProperties, // Import directly
    VariableProperties, // Import directly
    ApiRouteDefinitionProperties, // Import directly
    DatabaseTableProperties, // Import directly
    DatabaseColumnProperties // Import directly
} from './schema.js'; // Use type import for all needed types

/**
 * Generates a Canonical ID for an IR element based on the Code Connectome specification.
 * Format: connectome://<project_id>/<entity_type>:<entity_path>[#<fragment>]
 *
 * @param element The IR element (excluding the 'id' field itself).
 * @param projectId A unique identifier for the project.
 * @returns A CanonicalId string.
 * @throws Error if the element type is unknown or required attributes for path generation are missing.
 */
function generateCanonicalId(
    element: Omit<IrElement, 'id'>,
    projectId: string // Added projectId parameter
): CanonicalId {
  const entityType = element.type.toLowerCase(); // Use lowercase type in ID path
  let entityPath = '';

  // Construct entityPath based on element type
  switch (element.type) {
    case 'Function':
    case 'Class':
    case 'Interface':
    case 'Variable':
      // Basic path: <file_path>:<element_name>
      // TODO: Handle nested elements (e.g., methods) with dot notation if needed
      entityPath = `${element.filePath}:${element.name}`;
      break;

    case 'ApiRouteDefinition': {
      const props = element.properties as ApiRouteDefinitionProperties;
      if (!props.httpMethod || !props.pathPattern) {
          throw new Error(`Missing httpMethod or pathPattern for ApiRouteDefinition ID generation: ${element.name}`);
      }
      // Path: <http_method>:<url_path_pattern>
      entityPath = `${props.httpMethod.toUpperCase()}:${props.pathPattern}`;
      break;
    }
    case 'DatabaseTable': {
       const props = element.properties as DatabaseTableProperties;
       const schemaPrefix = props.schemaName ? `${props.schemaName}.` : '';
       // Path: <schema_name>.<table_name> (using element.name as table_name)
       entityPath = `${schemaPrefix}${element.name}`;
       break;
    }
    case 'DatabaseColumn': {
       const props = element.properties as DatabaseColumnProperties;
       if (!props.parentId) {
           throw new Error(`Missing parentId (table ID) for DatabaseColumn ID generation: ${element.name}`);
       }
       // Extract table path from parent ID (assuming parent ID is canonical)
       // connectome://proj/databasetable:schema.table -> schema.table
       const parentPathMatch = props.parentId.match(/^connectome:\/\/[^/]+\/[^:]+:(.*)$/); // Match structure and capture path after last colon
       const parentTablePath = parentPathMatch ? parentPathMatch[1] : `UNKNOWN_TABLE_${props.parentId}`;
       // Path: <parent_table_path>.<column_name>
       entityPath = `${parentTablePath}.${element.name}`;
       break;
    }
    // Add cases for other ElementType values as needed
    // case 'DatabaseSchemaDefinition':
    //   entityPath = `${element.filePath}`; // Example: Use file path for schema def
    //   break;

    default:
      // Fallback or error for unhandled types
      console.warn(`Using default ID path generation for unhandled element type: ${element.type}. Path: ${element.filePath}:${element.name}`);
      entityPath = `${element.filePath}:${element.name}`; // Default fallback
      // OR: throw new Error(`Unhandled element type for Canonical ID generation: ${element.type}`);
  }

  if (!projectId) {
      console.warn(`Missing projectId for Canonical ID generation. Using 'unknown-project'. Element: ${element.name}`);
      projectId = 'unknown-project';
  }
  if (!entityPath) {
     throw new Error(`Failed to construct entity path for element: ${JSON.stringify(element)}`);
  }

  // Clean the path: replace backslashes, maybe encode special chars?
  const cleanedPath = entityPath.replace(/\\/g, '/');

  return `connectome://${projectId}/${entityType}:${cleanedPath}`;
}

/**
 * Convenience function to generate and add a Canonical ID to an element object.
 * Modifies the element object in place.
 *
 * @param element The IR element object (without an ID).
 * @param projectId The project identifier.
 * @returns The same element object with the 'id' property added.
 */
function addIdToElement<T extends Omit<IrElement, 'id'>>(
    element: T,
    projectId: string
): T & { id: CanonicalId } {
    const id = generateCanonicalId(element, projectId);
    // Type assertion is okay here as we are adding the 'id' property
    (element as unknown as IrElement).id = id; // Cast via unknown
    return element as T & { id: CanonicalId };
}

// Export using ESM syntax
export { generateCanonicalId, addIdToElement };