/**
 * Base Visitor for Java Analyzer
 * 
 * This module provides the base visitor class for all Java entity visitors.
 */

import { SyntaxNode } from '../ast-visitor-utils';

/**
 * Base visitor class for all Java entity visitors
 */
export abstract class BaseVisitor {
  protected filePath: string;
  protected sourceCode: string;
  protected packageName: string;
  protected idServiceClient: any;
  protected nodes: any[];
  protected relationships: any[];

  /**
   * Initialize the base visitor
   * 
   * @param filePath Path to the Java file
   * @param sourceCode Source code content
   * @param packageName Package name
   * @param idServiceClient ID Service client
   * @param nodes Nodes array to populate
   * @param relationships Relationships array to populate
   */
  constructor(
    filePath: string,
    sourceCode: string,
    packageName: string,
    idServiceClient: any,
    nodes: any[],
    relationships: any[]
  ) {
    this.filePath = filePath;
    this.sourceCode = sourceCode;
    this.packageName = packageName;
    this.idServiceClient = idServiceClient;
    this.nodes = nodes;
    this.relationships = relationships;
  }

  /**
   * Abstract method to visit a syntax node
   * 
   * @param node The syntax node to visit
   */
  public abstract visit(node: SyntaxNode): Promise<void>;

  /**
   * Add a node to the nodes array
   * 
   * @param node The node to add
   */
  protected addNode(node: any): void {
    this.nodes.push(node);
  }

  /**
   * Add a relationship to the relationships array
   * 
   * @param relationship The relationship to add
   */
  protected addRelationship(relationship: any): void {
    this.relationships.push(relationship);
  }

  /**
   * Log an error message
   * 
   * @param message The error message
   * @param error The error object
   */
  protected logError(message: string, error: any): void {
    console.error(`${message}: ${error.message || error}`);
    if (error.stack) {
      console.error(error.stack);
    }
  }
}