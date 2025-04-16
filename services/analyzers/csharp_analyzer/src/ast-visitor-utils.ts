/**
 * AST Visitor Utilities for C# Analyzer
 * 
 * This module provides utility functions for traversing and analyzing C# ASTs.
 */

// @ts-ignore
import Parser from 'tree-sitter';
import { CSharpEntityType, CSharpRelationshipType, AnalysisRelationship } from './models';
// @ts-ignore
import path from 'path';

// Configure logging
const logger = {
  info: (message: string) => console.log(`[INFO] ${message}`),
  error: (message: string) => console.error(`[ERROR] ${message}`),
  debug: (message: string) => console.debug(`[DEBUG] ${message}`)
};

/**
 * Get the text of a node
 * 
 * @param node Tree-sitter node
 * @returns Text of the node
 */
export function getNodeText(node: any): string {
  try {
    if (!node) return '';
    return node.text;
  } catch (error) {
    logger.error(`Error getting node text: ${error}`);
    return '';
  }
}

/**
 * Get the line number of a node
 * 
 * @param node Tree-sitter node
 * @returns Line number
 */
export function getLineNumber(node: any): number {
  try {
    if (!node) return 0;
    return node.startPosition.row + 1;
  } catch (error) {
    logger.error(`Error getting line number: ${error}`);
    return 0;
  }
}

/**
 * Get the column number of a node
 * 
 * @param node Tree-sitter node
 * @returns Column number
 */
export function getColumnNumber(node: any): number {
  try {
    if (!node) return 0;
    return node.startPosition.column + 1;
  } catch (error) {
    logger.error(`Error getting column number: ${error}`);
    return 0;
  }
}

/**
 * Check if a node has a specific modifier
 * 
 * @param node Tree-sitter node
 * @param modifier Modifier to check for
 * @returns True if the node has the modifier
 */
export function hasModifier(node: any, modifier: string): boolean {
  try {
    if (!node) return false;
    
    const modifiersNode = node.childForFieldName('modifiers');
    if (!modifiersNode) return false;
    
    for (let i = 0; i < modifiersNode.childCount; i++) {
      const modNode = modifiersNode.child(i);
      if (modNode && modNode.text === modifier) {
        return true;
      }
    }
    
    return false;
  } catch (error) {
    logger.error(`Error checking modifier: ${error}`);
    return false;
  }
}

/**
 * Get the name of a node
 * 
 * @param node Tree-sitter node
 * @returns Name of the node
 */
export function getNodeName(node: any): string {
  try {
    if (!node) return '';
    
    const identifierNode = node.childForFieldName('name');
    if (identifierNode) {
      return identifierNode.text;
    }
    
    return '';
  } catch (error) {
    logger.error(`Error getting node name: ${error}`);
    return '';
  }
}

/**
 * Get the return type of a method
 * 
 * @param node Tree-sitter node
 * @returns Return type of the method
 */
export function getReturnType(node: any): string {
  try {
    if (!node) return '';
    
    const typeNode = node.childForFieldName('type');
    if (typeNode) {
      return typeNode.text;
    }
    
    return '';
  } catch (error) {
    logger.error(`Error getting return type: ${error}`);
    return '';
  }
}

/**
 * Get the parameters of a method
 * 
 * @param node Tree-sitter node
 * @returns Array of parameter nodes
 */
export function getParameters(node: any): any[] {
  try {
    if (!node) return [];
    
    const parameterListNode = node.childForFieldName('parameters');
    if (!parameterListNode) return [];
    
    const parameters = [];
    for (let i = 0; i < parameterListNode.childCount; i++) {
      const paramNode = parameterListNode.child(i);
      if (paramNode && paramNode.type === 'parameter') {
        parameters.push(paramNode);
      }
    }
    
    return parameters;
  } catch (error) {
    logger.error(`Error getting parameters: ${error}`);
    return [];
  }
}

/**
 * Get the method parameters with name and type
 * 
 * @param node Tree-sitter node
 * @returns Array of parameter objects with name and type
 */
export function getMethodParameters(node: any): Array<{name: string, type: string}> {
  try {
    if (!node) return [];
    
    const parameters = getParameters(node);
    return parameters.map(param => {
      const nameNode = param.childForFieldName('name');
      const typeNode = param.childForFieldName('type');
      
      return {
        name: nameNode ? nameNode.text : '',
        type: typeNode ? typeNode.text : ''
      };
    });
  } catch (error) {
    logger.error(`Error getting method parameters: ${error}`);
    return [];
  }
}

/**
 * Get the base types of a class or interface
 * 
 * @param node Tree-sitter node
 * @returns Array of base type names
 */
export function getBaseTypes(node: any): string[] {
  try {
    if (!node) return [];
    
    const baseListNode = node.childForFieldName('base_list');
    if (!baseListNode) return [];
    
    const baseTypes = [];
    for (let i = 0; i < baseListNode.childCount; i++) {
      const baseTypeNode = baseListNode.child(i);
      if (baseTypeNode && baseTypeNode.type === 'base_type') {
        baseTypes.push(baseTypeNode.text);
      }
    }
    
    return baseTypes;
  } catch (error) {
    logger.error(`Error getting base types: ${error}`);
    return [];
  }
}

/**
 * Get the attributes of a node
 * 
 * @param node Tree-sitter node
 * @returns Array of attribute nodes
 */
export function getAttributes(node: any): any[] {
  try {
    if (!node) return [];
    
    const attributeListsNode = node.childForFieldName('attributes');
    if (!attributeListsNode) return [];
    
    const attributes = [];
    for (let i = 0; i < attributeListsNode.childCount; i++) {
      const attributeListNode = attributeListsNode.child(i);
      if (attributeListNode && attributeListNode.type === 'attribute_list') {
        for (let j = 0; j < attributeListNode.childCount; j++) {
          const attributeNode = attributeListNode.child(j);
          if (attributeNode && attributeNode.type === 'attribute') {
            attributes.push(attributeNode);
          }
        }
      }
    }
    
    return attributes;
  } catch (error) {
    logger.error(`Error getting attributes: ${error}`);
    return [];
  }
}

/**
 * Extract attributes with name and arguments
 * 
 * @param node Tree-sitter node
 * @returns Array of attribute objects with name and arguments
 */
export function extractAttributes(node: any): Array<{name: string, arguments: string[]}> {
  try {
    if (!node) return [];
    
    const attributes = getAttributes(node);
    return attributes.map(attr => {
      const nameNode = attr.childForFieldName('name');
      const argsNode = attr.childForFieldName('arguments');
      
      const args = [];
      if (argsNode) {
        for (let i = 0; i < argsNode.childCount; i++) {
          const argNode = argsNode.child(i);
          if (argNode) {
            args.push(argNode.text);
          }
        }
      }
      
      return {
        name: nameNode ? nameNode.text : '',
        arguments: args
      };
    });
  } catch (error) {
    logger.error(`Error extracting attributes: ${error}`);
    return [];
  }
}

/**
 * Get the namespace name from a namespace declaration
 * 
 * @param node Tree-sitter node
 * @returns Namespace name
 */
export function getNamespaceName(node: any): string {
  try {
    if (!node) return '';
    
    const nameNode = node.childForFieldName('name');
    if (nameNode) {
      return nameNode.text;
    }
    
    return '';
  } catch (error) {
    logger.error(`Error getting namespace name: ${error}`);
    return '';
  }
}

/**
 * Get the namespace from a namespace declaration node
 * 
 * @param node Tree-sitter node
 * @returns Namespace name
 */
export function getNamespace(node: any): string {
  return getNamespaceName(node);
}

/**
 * Extract namespace from file path
 * 
 * @param filePath File path
 * @param defaultNamespace Default namespace to use if extraction fails
 * @returns Extracted namespace
 */
export function extractNamespace(filePath: string, defaultNamespace: string | null): string {
  try {
    if (!filePath) return defaultNamespace || '';
    
    // Extract directory structure and convert to namespace
    const dirPath = path.dirname(filePath);
    const parts = dirPath.split(path.sep).filter((p: string) => p && !p.includes(':'));
    
    if (parts.length === 0) {
      return defaultNamespace || path.basename(filePath, path.extname(filePath));
    }
    
    return parts.join('.');
  } catch (error) {
    logger.error(`Error extracting namespace: ${error}`);
    return defaultNamespace || '';
  }
}

/**
 * Get the using directives from a compilation unit
 * 
 * @param node Tree-sitter node
 * @returns Array of using directive nodes
 */
export function getUsingDirectives(node: any): any[] {
  try {
    if (!node) return [];
    
    const usingDirectives = [];
    for (let i = 0; i < node.childCount; i++) {
      const childNode = node.child(i);
      if (childNode && childNode.type === 'using_directive') {
        usingDirectives.push(childNode);
      }
    }
    
    return usingDirectives;
  } catch (error) {
    logger.error(`Error getting using directives: ${error}`);
    return [];
  }
}

/**
 * Get the namespace from a using directive
 * 
 * @param node Tree-sitter node
 * @returns Namespace
 */
export function getUsingNamespace(node: any): string {
  try {
    if (!node || node.type !== 'using_directive') return '';
    
    const nameNode = node.childForFieldName('name');
    if (nameNode) {
      return nameNode.text;
    }
    
    return '';
  } catch (error) {
    logger.error(`Error getting using namespace: ${error}`);
    return '';
  }
}

/**
 * Get the class declarations from a namespace or compilation unit
 * 
 * @param node Tree-sitter node
 * @returns Array of class declaration nodes
 */
export function getClassDeclarations(node: any): any[] {
  try {
    if (!node) return [];
    
    const classDeclarations = [];
    for (let i = 0; i < node.childCount; i++) {
      const childNode = node.child(i);
      if (childNode && childNode.type === 'class_declaration') {
        classDeclarations.push(childNode);
      }
    }
    
    return classDeclarations;
  } catch (error) {
    logger.error(`Error getting class declarations: ${error}`);
    return [];
  }
}

/**
 * Get the class name from a class declaration
 * 
 * @param node Tree-sitter node
 * @returns Class name
 */
export function getClassName(node: any): string {
  try {
    if (!node || node.type !== 'class_declaration') return '';
    
    const nameNode = node.childForFieldName('name');
    if (nameNode) {
      return nameNode.text;
    }
    
    return '';
  } catch (error) {
    logger.error(`Error getting class name: ${error}`);
    return '';
  }
}

/**
 * Get the base class from a class declaration
 * 
 * @param node Tree-sitter node
 * @returns Base class name or empty string if none
 */
export function getBaseClass(node: any): string {
  try {
    if (!node) return '';
    
    const baseTypes = getBaseTypes(node);
    if (baseTypes.length === 0) return '';
    
    // Assume the first base type that doesn't start with 'I' is a class
    for (const baseType of baseTypes) {
      if (!baseType.startsWith('I')) {
        return baseType;
      }
    }
    
    return '';
  } catch (error) {
    logger.error(`Error getting base class: ${error}`);
    return '';
  }
}

/**
 * Get the method name from a method declaration
 *
 * @param node Tree-sitter node
 * @returns Method name
 */
export function getMethodName(node: any): string {
  try {
    if (!node || node.type !== 'method_declaration') return '';
    
    const nameNode = node.childForFieldName('name');
    if (nameNode) {
      return nameNode.text;
    }
    
    return '';
  } catch (error) {
    logger.error(`Error getting method name: ${error}`);
    return '';
  }
}

/**
 * Get the implemented interfaces from a class declaration
 * 
 * @param node Tree-sitter node
 * @returns Array of interface names
 */
export function getImplementedInterfaces(node: any): string[] {
  try {
    if (!node) return [];
    
    const baseTypes = getBaseTypes(node);
    if (baseTypes.length === 0) return [];
    
    // Assume base types that start with 'I' are interfaces
    return baseTypes.filter(baseType => baseType.startsWith('I'));
  } catch (error) {
    logger.error(`Error getting implemented interfaces: ${error}`);
    return [];
  }
}

/**
 * Get the interface declarations from a namespace or compilation unit
 * 
 * @param node Tree-sitter node
 * @returns Array of interface declaration nodes
 */
export function getInterfaceDeclarations(node: any): any[] {
  try {
    if (!node) return [];
    
    const interfaceDeclarations = [];
    for (let i = 0; i < node.childCount; i++) {
      const childNode = node.child(i);
      if (childNode && childNode.type === 'interface_declaration') {
        interfaceDeclarations.push(childNode);
      }
    }
    
    return interfaceDeclarations;
  } catch (error) {
    logger.error(`Error getting interface declarations: ${error}`);
    return [];
  }
}

/**
 * Get the interface name from an interface declaration
 * 
 * @param node Tree-sitter node
 * @returns Interface name
 */
export function getInterfaceName(node: any): string {
  try {
    if (!node || node.type !== 'interface_declaration') return '';
    
    const nameNode = node.childForFieldName('name');
    if (nameNode) {
      return nameNode.text;
    }
    
    return '';
  } catch (error) {
    logger.error(`Error getting interface name: ${error}`);
    return '';
  }
}

/**
 * Get the method declarations from a class or interface
 * 
 * @param node Tree-sitter node
 * @returns Array of method declaration nodes
 */
export function getMethodDeclarations(node: any): any[] {
  try {
    if (!node) return [];
    
    const methodDeclarations = [];
    const bodyNode = node.childForFieldName('body');
    if (!bodyNode) return [];
    
    for (let i = 0; i < bodyNode.childCount; i++) {
      const childNode = bodyNode.child(i);
      if (childNode && childNode.type === 'method_declaration') {
        methodDeclarations.push(childNode);
      }
    }
    
    return methodDeclarations;
  } catch (error) {
    logger.error(`Error getting method declarations: ${error}`);
    return [];
  }
}

/**
* Process attributes to extract relationships
* @param attributeNodes Array of attribute nodes
* @param entityMap Entity map
* @returns Array of relationships
*/
export function processAttributes(attributeNodes: any[], entityMap: Map<string, any>): AnalysisRelationship[] {
const relationships: AnalysisRelationship[] = [];

for (const attributeNode of attributeNodes) {
  if (!attributeNode.gid) continue;

  const targetCanonicalId = attributeNode.attribute_name;
  if (!targetCanonicalId) continue;

  relationships.push({
    source_gid: attributeNode.gid,
    target_canonical_id: targetCanonicalId,
    type: CSharpRelationshipType.ANNOTATED_WITH,
    properties: {}
  });
}

return relationships;
}


/**
 * Get the constructor declarations from a class
 * 
 * @param node Tree-sitter node
 * @returns Array of constructor declaration nodes
 */
export function getConstructorDeclarations(node: any): any[] {
  try {
    if (!node) return [];
    
    const constructorDeclarations = [];
    const bodyNode = node.childForFieldName('body');
    if (!bodyNode) return [];
    
    for (let i = 0; i < bodyNode.childCount; i++) {
      const childNode = bodyNode.child(i);
      if (childNode && childNode.type === 'constructor_declaration') {
        constructorDeclarations.push(childNode);
      }
    }
    
    return constructorDeclarations;
  } catch (error) {
    logger.error(`Error getting constructor declarations: ${error}`);
    return [];
  }
}

/**
 * Get the property declarations from a class or interface
 * 
 * @param node Tree-sitter node
 * @returns Array of property declaration nodes
 */
export function getPropertyDeclarations(node: any): any[] {
  try {
    if (!node) return [];
    
    const propertyDeclarations = [];
    const bodyNode = node.childForFieldName('body');
    if (!bodyNode) return [];
    
    for (let i = 0; i < bodyNode.childCount; i++) {
      const childNode = bodyNode.child(i);
      if (childNode && childNode.type === 'property_declaration') {
        propertyDeclarations.push(childNode);
      }
    }
    
    return propertyDeclarations;
  } catch (error) {
    logger.error(`Error getting property declarations: ${error}`);
    return [];
  }
}

/**
 * Get the property name from a property declaration
 * 
 * @param node Tree-sitter node
 * @returns Property name
 */
export function getPropertyName(node: any): string {
  try {
    if (!node || node.type !== 'property_declaration') return '';
    
    const nameNode = node.childForFieldName('name');
    if (nameNode) {
      return nameNode.text;
    }
    
    return '';
  } catch (error) {
    logger.error(`Error getting property name: ${error}`);
    return '';
  }
}

/**
 * Get the property type from a property declaration
 * 
 * @param node Tree-sitter node
 * @returns Property type
 */
export function getPropertyType(node: any): string {
  try {
    if (!node || node.type !== 'property_declaration') return '';
    
    const typeNode = node.childForFieldName('type');
    if (typeNode) {
      return typeNode.text;
    }
    
    return '';
  } catch (error) {
    logger.error(`Error getting property type: ${error}`);
    return '';
  }
}

/**
 * Get the field declarations from a class
 * 
 * @param node Tree-sitter node
 * @returns Array of field declaration nodes
 */
export function getFieldDeclarations(node: any): any[] {
  try {
    if (!node) return [];
    
    const fieldDeclarations = [];
    const bodyNode = node.childForFieldName('body');
    if (!bodyNode) return [];
    
    for (let i = 0; i < bodyNode.childCount; i++) {
      const childNode = bodyNode.child(i);
      if (childNode && childNode.type === 'field_declaration') {
        fieldDeclarations.push(childNode);
      }
    }
    
    return fieldDeclarations;
  } catch (error) {
    logger.error(`Error getting field declarations: ${error}`);
    return [];
  }
}

/**
 * Get the event declarations from a class
 * 
 * @param node Tree-sitter node
 * @returns Array of event declaration nodes
 */
export function getEventDeclarations(node: any): any[] {
  try {
    if (!node) return [];
    
    const eventDeclarations = [];
    const bodyNode = node.childForFieldName('body');
    if (!bodyNode) return [];
    
    for (let i = 0; i < bodyNode.childCount; i++) {
      const childNode = bodyNode.child(i);
      if (childNode && childNode.type === 'event_declaration') {
        eventDeclarations.push(childNode);
      }
    }
    
    return eventDeclarations;
  } catch (error) {
    logger.error(`Error getting event declarations: ${error}`);
    return [];
  }
}

/**
 * Get all members of a class or interface
 * 
 * @param node Tree-sitter node
 * @returns Array of member nodes
 */
export function getAllMembers(node: any): any[] {
  try {
    if (!node) return [];
    
    const members = [];
    
    // Get constructors
    const constructors = getConstructorDeclarations(node);
    members.push(...constructors.map(c => ({ node: c, type: CSharpEntityType.Constructor })));
    
    // Get methods
    const methods = getMethodDeclarations(node);
    members.push(...methods.map(m => ({ node: m, type: CSharpEntityType.Method })));
    
    // Get properties
    const properties = getPropertyDeclarations(node);
    members.push(...properties.map(p => ({ node: p, type: CSharpEntityType.Property })));
    
    // Get fields
    const fields = getFieldDeclarations(node);
    members.push(...fields.map(f => ({ node: f, type: CSharpEntityType.Field })));
    
    // Get events
    const events = getEventDeclarations(node);
    members.push(...events.map(e => ({ node: e, type: CSharpEntityType.Event })));
    
    return members;
  } catch (error) {
    logger.error(`Error getting all members: ${error}`);
    return [];
  }
}

/**
 * Get all method calls from a method body
 * 
 * @param node Tree-sitter node
 * @returns Array of method call nodes
 */
export function getMethodCalls(node: any): any[] {
  try {
    if (!node) return [];
    
    const methodCalls: any[] = [];
    const bodyNode = node.childForFieldName('body');
    if (!bodyNode) return [];
    
    // Function to recursively find method calls
    function findMethodCalls(currentNode: any) {
      if (!currentNode) return;
      
      if (currentNode.type === 'invocation_expression') {
        methodCalls.push(currentNode);
      }
      
      for (let i = 0; i < currentNode.childCount; i++) {
        findMethodCalls(currentNode.child(i));
      }
    }
    
    findMethodCalls(bodyNode);
    
    return methodCalls;
  } catch (error) {
    logger.error(`Error getting method calls: ${error}`);
    return [];
  }
}

/**
 * Get the method name from a method call
 * 
 * @param node Tree-sitter node
 * @returns Method name
 */
export function getMethodCallName(node: any): string {
  try {
    if (!node) return '';
    
    const nameNode = node.childForFieldName('function');
    if (nameNode) {
      // Handle simple method calls
      if (nameNode.type === 'identifier') {
        return nameNode.text;
      }
      
      // Handle method calls on objects (e.g., obj.Method())
      if (nameNode.type === 'member_access_expression') {
        const memberNameNode = nameNode.childForFieldName('name');
        if (memberNameNode) {
          return memberNameNode.text;
        }
      }
    }
    
    return '';
  } catch (error) {
    logger.error(`Error getting method call name: ${error}`);
    return '';
  }
}

/**
 * Get the type usage from a node
 * 
 * @param node Tree-sitter node
 * @returns Array of type names
 */
export function getTypeUsage(node: any): string[] {
  try {
    if (!node) return [];
    
    const typeNames = new Set<string>();
    
    // Function to recursively find type names
    function findTypeNames(currentNode: any) {
      if (!currentNode) return;
      
      // Check for type names in variable declarations
      if (currentNode.type === 'variable_declaration') {
        const typeNode = currentNode.childForFieldName('type');
        if (typeNode) {
          typeNames.add(typeNode.text);
        }
      }
      
      // Check for type names in parameter declarations
      if (currentNode.type === 'parameter') {
        const typeNode = currentNode.childForFieldName('type');
        if (typeNode) {
          typeNames.add(typeNode.text);
        }
      }
      
      // Check for type names in object creation expressions
      if (currentNode.type === 'object_creation_expression') {
        const typeNode = currentNode.childForFieldName('type');
        if (typeNode) {
          typeNames.add(typeNode.text);
        }
      }
      
      // Check for type names in cast expressions
      if (currentNode.type === 'cast_expression') {
        const typeNode = currentNode.childForFieldName('type');
        if (typeNode) {
          typeNames.add(typeNode.text);
        }
      }
      
      // Recursively check child nodes
      for (let i = 0; i < currentNode.childCount; i++) {
        findTypeNames(currentNode.child(i));
      }
    }
    
    findTypeNames(node);
    
    return Array.from(typeNames);
  } catch (error) {
    logger.error(`Error getting type usage: ${error}`);
    return [];
  }
}

/**
 * Format analysis results for output
 * 
 * @param nodes Array of analysis nodes
 * @param relationships Array of analysis relationships
 * @param source Source of the analysis
 * @returns Formatted analysis result payload
 */
export function formatAnalysisResults(nodes: any[], relationships: any[], source: string): any {
  return {
    nodes,
    relationships,
    source,
    timestamp: Date.now()
  };
}

/**
 * Process method calls to extract relationships
 * 
 * @param methodNodes Array of method nodes
 * @param entityMap Entity map
 * @returns Array of relationships
 */
export function processMethodCalls(methodNodes: any[], entityMap: Map<string, any>): AnalysisRelationship[] {
  try {
    const relationships = [];
    
    for (const methodNode of methodNodes) {
      const methodCalls = getMethodCalls(methodNode.node);
      const callerGid = methodNode.gid;
      
      for (const methodCall of methodCalls) {
        const calledMethodName = getMethodCallName(methodCall);
        
        // Find the target method in the entity map
        for (const [key, value] of entityMap.entries()) {
          if (key.endsWith(`::${calledMethodName}`)) {
            relationships.push({
              source_gid: callerGid,
              target_canonical_id: value.canonicalId,
              type: CSharpRelationshipType.CALLS,
              properties: {}
            });
            break;
          }
        }
      }
    }
    
    return relationships;
  } catch (error) {
    logger.error(`Error processing method calls: ${error}`);
    return [];
  }
}

/**
 * Process type uses to extract relationships
 * 
 * @param methodNodes Array of method nodes
 * @param entityMap Entity map
 * @returns Array of relationships
 */
export function processTypeUses(methodNodes: any[], entityMap: Map<string, any>): AnalysisRelationship[] {
  try {
    const relationships = [];
    
    for (const methodNode of methodNodes) {
      const typeUsages = getTypeUsage(methodNode.node);
      const sourceGid = methodNode.gid;
      
      for (const typeName of typeUsages) {
        // Find the target type in the entity map
        for (const [key, value] of entityMap.entries()) {
          if (key.endsWith(`::${typeName}`)) {
            relationships.push({
              source_gid: sourceGid,
              target_canonical_id: value.canonicalId,
              type: CSharpRelationshipType.USES_TYPE,
              properties: {}
            });
            break;
          }
        }
      }
    }
    
    return relationships;
  } catch (error) {
    logger.error(`Error processing type uses: ${error}`);
    return [];
  }
}

/**
 * Process class relationships (inheritance and implementation)
 * 
 * @param classNodes Array of class nodes
 * @param entityMap Entity map
 * @returns Array of relationships
 */
export function processClassRelationships(classNodes: any[], entityMap: Map<string, any>): AnalysisRelationship[] {
  try {
    const relationships = [];
    
    for (const classNode of classNodes) {
      const sourceGid = classNode.gid;
      const node = classNode.node;
      
      // Process base class (inheritance)
      const baseClass = getBaseClass(node);
      if (baseClass) {
        // Find the target class in the entity map
        for (const [key, value] of entityMap.entries()) {
          if (key.endsWith(`::${baseClass}`)) {
            relationships.push({
              source_gid: sourceGid,
              target_canonical_id: value.canonicalId,
              type: CSharpRelationshipType.EXTENDS,
              properties: {}
            });
            break;
          }
        }
      }
      
      // Process implemented interfaces
      const interfaces = getImplementedInterfaces(node);
      for (const interfaceName of interfaces) {
        // Find the target interface in the entity map
        for (const [key, value] of entityMap.entries()) {
          if (key.endsWith(`::${interfaceName}`)) {
            relationships.push({
              source_gid: sourceGid,
              target_canonical_id: value.canonicalId,
              type: CSharpRelationshipType.IMPLEMENTS,
              properties: {}
            });
            break;
          }
        }
      }
    }
    
    return relationships;
  } catch (error) {
    logger.error(`Error processing class relationships: ${error}`);
    return [];
  }
}

/**
 * Process attributes to extract relationships
 *
 * @param nodesWithAttributes Array of nodes with attributes
 * @param entityMap Entity map
 * @returns Array of relationships
 */
export function processAttributesRelationships(nodesWithAttributes: any[], entityMap: Map<string, any>): AnalysisRelationship[] {
  try {
    const relationships: AnalysisRelationship[] = [];
    
    for (const node of nodesWithAttributes) {
      const sourceGid = node.gid;
      if (!sourceGid) continue;
      
      const attributes = extractAttributes(node.node);
      
      for (const attribute of attributes) {
        const attributeName = attribute.name;
        if (!attributeName) continue;
        
        // Create a canonical ID for the attribute
        const attributeCanonicalId = `Attribute::${attributeName}`;
        
        relationships.push({
          source_gid: sourceGid,
          target_canonical_id: attributeCanonicalId,
          type: CSharpRelationshipType.ANNOTATED_WITH,
          properties: {
            arguments: attribute.arguments
          }
        });
      }
    }
    
    return relationships;
  } catch (error) {
    logger.error(`Error processing attribute relationships: ${error}`);
    return [];
  }
}
