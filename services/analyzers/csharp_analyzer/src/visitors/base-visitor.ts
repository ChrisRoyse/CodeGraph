/**
 * Base Visitor for C# Analyzer
 * 
 * This module provides the base visitor class that will be extended
 * by specialized visitors for different C# constructs.
 */

import * as fs from 'fs';
import Parser from 'tree-sitter';
// @ts-ignore
import CSharp from 'tree-sitter-c-sharp';
import { IdServiceClient } from '../id-service-client';
import { 
  AnalysisNode, 
  AnalysisRelationship, 
  CSharpEntityType
} from '../models';

// Configure logging
const logger = {
  info: (message: string) => console.log(`[INFO] ${message}`),
  error: (message: string) => console.error(`[ERROR] ${message}`),
  debug: (message: string) => console.debug(`[DEBUG] ${message}`)
};

/**
 * Base visitor class for C# AST traversal
 */
export abstract class BaseVisitor {
  protected filePath: string;
  protected idServiceClient: IdServiceClient;
  protected nodes: AnalysisNode[] = [];
  protected relationships: AnalysisRelationship[] = [];
  protected fileCanonicalId: string | null = null;
  protected fileGid: string | null = null;
  protected namespaceCanonicalId: string | null = null;
  protected namespaceGid: string | null = null;
  protected namespaceName: string = '';
  protected csharpParser: Parser;
  protected tree: Parser.Tree | null = null;
  protected content: string = '';
  
  // Map to track entities by name for relationship creation
  protected entityMap: Map<string, { canonicalId: string, gid: string }> = new Map();

  /**
   * Initialize the base visitor
   * 
   * @param filePath Path to the file to analyze
   * @param idServiceClient Client for the ID Service
   */
  constructor(filePath: string, idServiceClient: IdServiceClient) {
    this.filePath = filePath;
    this.idServiceClient = idServiceClient;

    // Initialize parser
    this.csharpParser = new Parser();
    this.csharpParser.setLanguage(CSharp);
  }

  /**
   * Parse the file content
   * 
   * @returns True if parsing was successful
   */
  protected parseFile(): boolean {
    try {
      // Read the file content
      this.content = fs.readFileSync(this.filePath, 'utf8');

      // Parse the file
      this.tree = this.csharpParser.parse(this.content);
      return true;
    } catch (error) {
      logger.error(`Error parsing file ${this.filePath}: ${error}`);
      return false;
    }
  }

  /**
   * Get the line number of a node
   * 
   * @param node Tree-sitter node
   * @returns Line number
   */
  protected getLineNumber(node: any): number {
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
  protected getColumnNumber(node: any): number {
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
  protected hasModifier(node: any, modifier: string): boolean {
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
   * Get the file canonical ID
   */
  public getFileCanonicalId(): string | null {
    return this.fileCanonicalId;
  }

  /**
   * Get the file GID
   */
  public getFileGid(): string | null {
    return this.fileGid;
  }

  /**
   * Get the namespace canonical ID
   */
  public getNamespaceCanonicalId(): string | null {
    return this.namespaceCanonicalId;
  }

  /**
   * Get the namespace GID
   */
  public getNamespaceGid(): string | null {
    return this.namespaceGid;
  }

  /**
   * Get the namespace name
   */
  public getNamespaceName(): string {
    return this.namespaceName;
  }

  /**
   * Get the entity map
   */
  public getEntityMap(): Map<string, { canonicalId: string, gid: string }> {
    return this.entityMap;
  }

  /**
   * Get the tree
   */
  public getTree(): Parser.Tree | null {
    return this.tree;
  }

  /**
   * Get the content
   */
  public getContent(): string {
    return this.content;
  }

  /**
   * Set the file canonical ID
   */
  public setFileCanonicalId(value: string | null): void {
    this.fileCanonicalId = value;
  }

  /**
   * Set the file GID
   */
  public setFileGid(value: string | null): void {
    this.fileGid = value;
  }

  /**
   * Set the namespace canonical ID
   */
  public setNamespaceCanonicalId(value: string | null): void {
    this.namespaceCanonicalId = value;
  }

  /**
   * Set the namespace GID
   */
  public setNamespaceGid(value: string | null): void {
    this.namespaceGid = value;
  }

  /**
   * Set the namespace name
   */
  public setNamespaceName(value: string): void {
    this.namespaceName = value;
  }

  /**
   * Set the entity map
   */
  public setEntityMap(value: Map<string, { canonicalId: string, gid: string }>): void {
    this.entityMap = value;
  }

  /**
   * Set the tree
   */
  public setTree(value: Parser.Tree | null): void {
    this.tree = value;
  }

  /**
   * Set the content
   */
  public setContent(value: string): void {
    this.content = value;
  }

  /**
   * Abstract method to be implemented by specialized visitors
   */
  public abstract visit(): Promise<[AnalysisNode[], AnalysisRelationship[]]>;
}