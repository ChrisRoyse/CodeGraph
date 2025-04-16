/**
 * AST Visitor Utilities for Java Analyzer
 * 
 * This module provides utility functions for traversing and analyzing Java ASTs.
 */

// Add Node.js require type declaration
declare function require(id: string): any;

// Define a minimal SyntaxNode interface to avoid tree-sitter dependency issues
export interface SyntaxNode {
  type: string;
  text?: string;
  startIndex: number;
  endIndex: number;
  parent?: SyntaxNode;
  children: SyntaxNode[];
  childCount: number;
  namedChildCount: number;
  firstChild?: SyntaxNode;
  lastChild?: SyntaxNode;
  startPosition: {
    row: number;
    column: number;
  };
  endPosition: {
    row: number;
    column: number;
  };
}

/**
 * Find all nodes of a specific type in the AST
 * 
 * @param rootNode The root node to start searching from
 * @param nodeType The type of node to find
 * @returns An array of matching nodes
 */
export function findNodesOfType(rootNode: SyntaxNode, nodeType: string): SyntaxNode[] {
  const nodes: SyntaxNode[] = [];
  
  function traverse(node: SyntaxNode) {
    if (node.type === nodeType) {
      nodes.push(node);
    }
    
    for (const child of node.children) {
      traverse(child);
    }
  }
  
  traverse(rootNode);
  return nodes;
}

/**
 * Check if a node has a specific modifier (public, private, static, etc.)
 * 
 * @param node The node to check
 * @param modifier The modifier to check for
 * @param sourceCode The source code
 * @returns True if the node has the modifier, false otherwise
 */
export function hasModifier(node: SyntaxNode, modifier: string, sourceCode: string): boolean {
  const modifierNodes = findNodesOfType(node, 'modifier');
  
  for (const modifierNode of modifierNodes) {
    const modifierText = sourceCode.substring(modifierNode.startIndex, modifierNode.endIndex).trim();
    if (modifierText === modifier) {
      return true;
    }
  }
  
  return false;
}

/**
 * Get all annotations for a node
 * 
 * @param node The node to get annotations for
 * @param sourceCode The source code
 * @returns An array of annotation names
 */
export function getAnnotations(node: SyntaxNode, sourceCode: string): string[] {
  const annotations: string[] = [];
  
  // Find annotation nodes
  const annotationNodes = findNodesOfType(node, 'annotation');
  
  for (const annotationNode of annotationNodes) {
    // Find the name node
    const nameNode = annotationNode.children.find((child: SyntaxNode) => 
      child.type === 'identifier' || 
      child.type === 'scoped_identifier'
    );
    
    if (nameNode) {
      const annotationName = sourceCode.substring(nameNode.startIndex, nameNode.endIndex).trim();
      annotations.push(annotationName);
    }
  }
  
  return annotations;
}

/**
 * Check if a node is a test (has @Test annotation)
 * 
 * @param node The node to check
 * @param sourceCode The source code
 * @returns True if the node is a test, false otherwise
 */
export function isTest(node: SyntaxNode, sourceCode: string): boolean {
  const annotations = getAnnotations(node, sourceCode);
  return annotations.some(annotation => 
    annotation === 'Test' || 
    annotation === 'org.junit.Test' || 
    annotation === 'org.junit.jupiter.api.Test'
  );
}

/**
 * Get the return type of a method
 * 
 * @param methodNode The method node
 * @param sourceCode The source code
 * @returns The return type of the method
 */
export function getReturnType(methodNode: SyntaxNode, sourceCode: string): string {
  // Find the return type node
  const returnTypeNode = methodNode.children.find((child: SyntaxNode) => 
    child.type === 'type_identifier' || 
    child.type === 'primitive_type' || 
    child.type === 'void_type' ||
    child.type === 'array_type' ||
    child.type === 'generic_type'
  );
  
  if (returnTypeNode) {
    return sourceCode.substring(returnTypeNode.startIndex, returnTypeNode.endIndex).trim();
  }
  
  return 'void';
}

/**
 * Get the parameter types of a method or constructor
 * 
 * @param methodNode The method or constructor node
 * @param sourceCode The source code
 * @returns An array of parameter types
 */
export function getParameterTypes(methodNode: SyntaxNode, sourceCode: string): string[] {
  const parameterTypes: string[] = [];
  
  // Find the formal parameters node
  const formalParametersNode = methodNode.children.find((child: SyntaxNode) => 
    child.type === 'formal_parameters'
  );
  
  if (!formalParametersNode) {
    return parameterTypes;
  }
  
  // Find all formal parameter nodes
  const formalParameterNodes = findNodesOfType(formalParametersNode, 'formal_parameter');
  
  for (const parameterNode of formalParameterNodes) {
    // Find the type node
    const typeNode = parameterNode.children.find((child: SyntaxNode) => 
      child.type === 'type_identifier' || 
      child.type === 'primitive_type' ||
      child.type === 'array_type' ||
      child.type === 'generic_type'
    );
    
    if (typeNode) {
      const parameterType = sourceCode.substring(typeNode.startIndex, typeNode.endIndex).trim();
      parameterTypes.push(parameterType);
    }
  }
  
  return parameterTypes;
}

/**
 * Get the parameter names of a method or constructor
 * 
 * @param methodNode The method or constructor node
 * @param sourceCode The source code
 * @returns An array of parameter names
 */
export function getParameterNames(methodNode: SyntaxNode, sourceCode: string): string[] {
  const parameterNames: string[] = [];
  
  // Find the formal parameters node
  const formalParametersNode = methodNode.children.find((child: SyntaxNode) => 
    child.type === 'formal_parameters'
  );
  
  if (!formalParametersNode) {
    return parameterNames;
  }
  
  // Find all formal parameter nodes
  const formalParameterNodes = findNodesOfType(formalParametersNode, 'formal_parameter');
  
  for (const parameterNode of formalParameterNodes) {
    // Find the variable declarator node
    const variableDeclaratorNode = parameterNode.children.find((child: SyntaxNode) => 
      child.type === 'variable_declarator'
    );
    
    if (variableDeclaratorNode) {
      // Find the identifier node
      const identifierNode = variableDeclaratorNode.children.find((child: SyntaxNode) => 
        child.type === 'identifier'
      );
      
      if (identifierNode) {
        const parameterName = sourceCode.substring(identifierNode.startIndex, identifierNode.endIndex).trim();
        parameterNames.push(parameterName);
      }
    }
  }
  
  return parameterNames;
}

/**
 * Get the extended class of a class
 * 
 * @param classNode The class node
 * @param sourceCode The source code
 * @returns The name of the extended class, or null if none
 */
export function getExtendedClass(classNode: SyntaxNode, sourceCode: string): string | null {
  // Find the superclass node
  const superclassNode = classNode.children.find((child: SyntaxNode) => 
    child.type === 'superclass'
  );
  
  if (!superclassNode) {
    return null;
  }
  
  // Find the type identifier node
  const typeIdentifierNode = superclassNode.children.find((child: SyntaxNode) => 
    child.type === 'type_identifier'
  );
  
  if (typeIdentifierNode) {
    return sourceCode.substring(typeIdentifierNode.startIndex, typeIdentifierNode.endIndex).trim();
  }
  
  return null;
}

/**
 * Get the implemented interfaces of a class or extended interfaces of an interface
 * 
 * @param node The class or interface node
 * @param sourceCode The source code
 * @returns An array of interface names
 */
export function getImplementedInterfaces(node: SyntaxNode, sourceCode: string): string[] {
  const interfaces: string[] = [];
  
  // Find the super interfaces node
  const superInterfacesNode = node.children.find((child: SyntaxNode) => 
    child.type === 'super_interfaces' || 
    child.type === 'extends_interfaces'
  );
  
  if (!superInterfacesNode) {
    return interfaces;
  }
  
  // Find all interface type nodes
  const interfaceTypeNodes = findNodesOfType(superInterfacesNode, 'type_identifier');
  
  for (const interfaceTypeNode of interfaceTypeNodes) {
    const interfaceName = sourceCode.substring(interfaceTypeNode.startIndex, interfaceTypeNode.endIndex).trim();
    interfaces.push(interfaceName);
  }
  
  return interfaces;
}

/**
 * Process method calls within a method or constructor
 * 
 * @param methodNode The method or constructor node
 * @param sourceCode The source code
 * @param filePath The file path
 * @param className The class name
 * @param idServiceClient The ID service client
 * @param relationships The relationships array to populate
 */
export async function processMethodCalls(
  methodNode: SyntaxNode,
  sourceCode: string,
  filePath: string,
  className: string,
  idServiceClient: any,
  relationships: any[]
): Promise<void> {
  try {
    // Find all method invocation nodes
    const methodInvocationNodes = findNodesOfType(methodNode, 'method_invocation');
    
    for (const invocationNode of methodInvocationNodes) {
      // Find the name node
      const nameNode = invocationNode.children.find((child: SyntaxNode) => 
        child.type === 'identifier'
      );
      
      if (!nameNode) continue;
      
      const methodName = sourceCode.substring(nameNode.startIndex, nameNode.endIndex).trim();
      
      // Find the object node (if any)
      const objectNode = invocationNode.children.find((child: SyntaxNode) => 
        child.type === 'identifier' && 
        child !== nameNode
      );
      
      let objectName = '';
      
      if (objectNode) {
        objectName = sourceCode.substring(objectNode.startIndex, objectNode.endIndex).trim();
      }
      
      // Get the parameter types (for method signature)
      const argumentListNode = invocationNode.children.find((child: SyntaxNode) => 
        child.type === 'argument_list'
      );
      
      const parameterTypes: string[] = [];
      
      if (argumentListNode) {
        // This is a simplification - in a real implementation, we would need to
        // determine the actual types of the arguments
        const expressionNodes = findNodesOfType(argumentListNode, 'expression');
        parameterTypes.length = expressionNodes.length;
        parameterTypes.fill('Object');
      }
      
      // Generate IDs for the source method
      const [sourceCanonicalId, sourceGid] = await idServiceClient.generateId(
        filePath,
        'Method',
        methodNode.children.find((child: SyntaxNode) => 
          child.type === 'identifier'
        )?.text || '',
        '',
        [],
        'java'
      );
      
      // Generate IDs for the target method
      const [targetCanonicalId] = await idServiceClient.generateId(
        '',
        'Method',
        methodName,
        '',
        parameterTypes,
        'java'
      );
      
      // Add CALLS relationship
      relationships.push({
        source_gid: sourceGid,
        target_canonical_id: targetCanonicalId,
        type: 'CALLS',
        properties: {
          object_name: objectName
        }
      });
    }
  } catch (error: any) {
    console.error(`Error processing method calls: ${error.message || error}`);
    if (error.stack) {
      console.error(error.stack);
    }
  }
}

/**
 * Process type uses within a class, interface, enum, or annotation
 * 
 * @param typeNode The class, interface, enum, or annotation node
 * @param sourceCode The source code
 * @param filePath The file path
 * @param typeName The type name
 * @param idServiceClient The ID service client
 * @param relationships The relationships array to populate
 */
export async function processTypeUses(
  typeNode: SyntaxNode,
  sourceCode: string,
  filePath: string,
  typeName: string,
  idServiceClient: any,
  relationships: any[]
): Promise<void> {
  try {
    // Find all type identifier nodes
    const typeIdentifierNodes = findNodesOfType(typeNode, 'type_identifier');
    
    // Keep track of processed types to avoid duplicates
    const processedTypes = new Set<string>();
    
    for (const typeIdentifierNode of typeIdentifierNodes) {
      const usedTypeName = sourceCode.substring(typeIdentifierNode.startIndex, typeIdentifierNode.endIndex).trim();
      
      // Skip if it's the type itself or already processed
      if (usedTypeName === typeName || processedTypes.has(usedTypeName)) {
        continue;
      }
      
      processedTypes.add(usedTypeName);
      
      // Generate IDs for the source type
      const [sourceCanonicalId, sourceGid] = await idServiceClient.generateId(
        filePath,
        'Class', // Assuming it's a class, but could be any type
        typeName,
        '',
        [],
        'java'
      );
      
      // Generate IDs for the target type
      const [targetCanonicalId] = await idServiceClient.generateId(
        '',
        'Class', // Assuming it's a class, but could be any type
        usedTypeName,
        '',
        [],
        'java'
      );
      
      // Add USES relationship
      relationships.push({
        source_gid: sourceGid,
        target_canonical_id: targetCanonicalId,
        type: 'USES',
        properties: {}
      });
    }
  } catch (error: any) {
    console.error(`Error processing type uses: ${error.message || error}`);
    if (error.stack) {
      console.error(error.stack);
    }
  }
}

/**
 * Process class relationships (extends, implements)
 * 
 * @param classNode The class node
 * @param sourceCode The source code
 * @param filePath The file path
 * @param className The class name
 * @param idServiceClient The ID service client
 * @param relationships The relationships array to populate
 */
export async function processClassRelationships(
  classNode: SyntaxNode,
  sourceCode: string,
  filePath: string,
  className: string,
  idServiceClient: any,
  relationships: any[]
): Promise<void> {
  try {
    // Process extends relationship
    const extendedClass = getExtendedClass(classNode, sourceCode);
    
    if (extendedClass && extendedClass !== 'Object') {
      // Generate IDs for the source class
      const [sourceCanonicalId, sourceGid] = await idServiceClient.generateId(
        filePath,
        'Class',
        className,
        '',
        [],
        'java'
      );
      
      // Generate IDs for the target class
      const [targetCanonicalId] = await idServiceClient.generateId(
        '',
        'Class',
        extendedClass,
        '',
        [],
        'java'
      );
      
      // Add EXTENDS relationship
      relationships.push({
        source_gid: sourceGid,
        target_canonical_id: targetCanonicalId,
        type: 'EXTENDS',
        properties: {}
      });
    }
    
    // Process implements relationships
    const implementedInterfaces = getImplementedInterfaces(classNode, sourceCode);
    
    for (const interfaceName of implementedInterfaces) {
      // Generate IDs for the source class
      const [sourceCanonicalId, sourceGid] = await idServiceClient.generateId(
        filePath,
        'Class',
        className,
        '',
        [],
        'java'
      );
      
      // Generate IDs for the target interface
      const [targetCanonicalId] = await idServiceClient.generateId(
        '',
        'Interface',
        interfaceName,
        '',
        [],
        'java'
      );
      
      // Add IMPLEMENTS relationship
      relationships.push({
        source_gid: sourceGid,
        target_canonical_id: targetCanonicalId,
        type: 'IMPLEMENTS',
        properties: {}
      });
    }
  } catch (error: any) {
    console.error(`Error processing class relationships: ${error.message || error}`);
    if (error.stack) {
      console.error(error.stack);
    }
  }
}

/**
 * Process annotations on a node
 * 
 * @param node The node with annotations
 * @param sourceCode The source code
 * @param filePath The file path
 * @param entityName The entity name
 * @param entityType The entity type
 * @param idServiceClient The ID service client
 * @param relationships The relationships array to populate
 */
export async function processAnnotations(
  node: SyntaxNode,
  sourceCode: string,
  filePath: string,
  entityName: string,
  entityType: string,
  idServiceClient: any,
  relationships: any[]
): Promise<void> {
  try {
    const annotations = getAnnotations(node, sourceCode);
    
    for (const annotationName of annotations) {
      // Generate IDs for the source entity
      const [sourceCanonicalId, sourceGid] = await idServiceClient.generateId(
        filePath,
        entityType,
        entityName,
        '',
        [],
        'java'
      );
      
      // Generate IDs for the target annotation
      const [targetCanonicalId] = await idServiceClient.generateId(
        '',
        'Annotation',
        annotationName,
        '',
        [],
        'java'
      );
      
      // Add ANNOTATED_WITH relationship
      relationships.push({
        source_gid: sourceGid,
        target_canonical_id: targetCanonicalId,
        type: 'ANNOTATED_WITH',
        properties: {}
      });
    }
  } catch (error: any) {
    console.error(`Error processing annotations: ${error.message || error}`);
    if (error.stack) {
      console.error(error.stack);
    }
  }
}

/**
 * Get the text of a node
 * 
 * @param node The node to get text from
 * @param sourceCode The source code
 * @returns The text of the node
 */
export function getNodeText(node: SyntaxNode, sourceCode: string): string {
  return sourceCode.substring(node.startIndex, node.endIndex).trim();
}

/**
 * Get the qualified name of a type (including package)
 * 
 * @param node The type node
 * @param sourceCode The source code
 * @param packageName The current package name
 * @returns The qualified name of the type
 */
export function getQualifiedName(node: SyntaxNode, sourceCode: string, packageName: string): string {
  const simpleName = getSimpleName(node, sourceCode);
  
  if (!packageName) {
    return simpleName;
  }
  
  return `${packageName}.${simpleName}`;
}

/**
 * Get the simple name of a type (without package)
 * 
 * @param node The type node
 * @param sourceCode The source code
 * @returns The simple name of the type
 */
export function getSimpleName(node: SyntaxNode, sourceCode: string): string {
  const nameNode = node.children.find((child: SyntaxNode) => 
    child.type === 'identifier'
  );
  
  if (nameNode) {
    return sourceCode.substring(nameNode.startIndex, nameNode.endIndex).trim();
  }
  
  return '';
}

/**
 * Get the package name from a package declaration
 * 
 * @param packageNode The package declaration node
 * @param sourceCode The source code
 * @returns The package name
 */
export function getPackageName(packageNode: SyntaxNode, sourceCode: string): string {
  const nameNode = packageNode.children.find((child: SyntaxNode) => 
    child.type === 'scoped_identifier' || 
    child.type === 'identifier'
  );
  
  if (nameNode) {
    return sourceCode.substring(nameNode.startIndex, nameNode.endIndex).trim();
  }
  
  return '';
}

/**
 * Get the modifiers of a node (public, private, static, etc.)
 * 
 * @param node The node to get modifiers from
 * @param sourceCode The source code
 * @returns An array of modifiers
 */
export function getModifiers(node: SyntaxNode, sourceCode: string): string[] {
  const modifiers: string[] = [];
  
  const modifierNodes = findNodesOfType(node, 'modifier');
  
  for (const modifierNode of modifierNodes) {
    const modifierText = sourceCode.substring(modifierNode.startIndex, modifierNode.endIndex).trim();
    modifiers.push(modifierText);
  }
  
  return modifiers;
}

/**
 * Extract the package name from a Java file
 *
 * @param filePath The path to the Java file
 * @param packageDecl The package declaration if already parsed
 * @returns The package name
 */
export function extractPackageName(filePath: string, packageDecl: string | null): string {
  if (packageDecl) {
    return packageDecl;
  }
  
  // If no package declaration, infer from file path
  // This is a simplified implementation - in a real-world scenario,
  // we would need to handle more complex path structures
  const parts = filePath.split('/');
  if (parts.length > 2) {
    // Assume the last two parts are the package structure
    // e.g., src/com/example/MyClass.java -> com.example
    return parts.slice(-3, -1).join('.');
  }
  
  return '';
}

/**
 * Format the analysis results for output
 *
 * @param filePath The file path
 * @param nodes The nodes array
 * @param relationships The relationships array
 * @returns The formatted analysis results
 */
export function formatAnalysisResults(filePath: string, nodes: any[], relationships: any[]): any {
  return {
    file_path: filePath,
    language: 'java',
    nodes_upserted: nodes,
    relationships_upserted: relationships,
    nodes_deleted: [],
    relationships_deleted: []
  };
}