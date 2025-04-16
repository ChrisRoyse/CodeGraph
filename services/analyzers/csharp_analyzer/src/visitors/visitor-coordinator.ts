/**
 * Visitor Coordinator for C# Analyzer
 * 
 * This module provides a coordinator for all C# visitors.
 */

import { IdServiceClient } from '../id-service-client';
import { 
  AnalysisNode, 
  AnalysisRelationship
} from '../models';
import { FileVisitor } from './file-visitor';
import { UsingVisitor } from './using-visitor';
import { ClassInterfaceVisitor } from './class-interface-visitor';
import { MemberVisitor } from './member-visitor';
import { AttributeVisitor } from './attribute-visitor';
import { RelationshipVisitor } from './relationship-visitor';

// Configure logging
const logger = {
  info: (message: string) => console.log(`[INFO] ${message}`),
  error: (message: string) => console.error(`[ERROR] ${message}`),
  debug: (message: string) => console.debug(`[DEBUG] ${message}`)
};

/**
 * Coordinator for all C# visitors
 */
export class VisitorCoordinator {
  private filePath: string;
  private idServiceClient: IdServiceClient;
  
  /**
   * Initialize the visitor coordinator
   * 
   * @param filePath Path to the file to analyze
   * @param idServiceClient Client for the ID Service
   */
  constructor(filePath: string, idServiceClient: IdServiceClient) {
    this.filePath = filePath;
    this.idServiceClient = idServiceClient;
  }
  
  /**
   * Process the file with all visitors
   * 
   * @returns Nodes and relationships extracted from the file
   */
  public async process(): Promise<[AnalysisNode[], AnalysisRelationship[]]> {
    try {
      logger.info(`Processing file: ${this.filePath}`);
      
      // Initialize result arrays
      const nodes: AnalysisNode[] = [];
      const relationships: AnalysisRelationship[] = [];
      
      // Create and run file visitor
      const fileVisitor = new FileVisitor(this.filePath, this.idServiceClient);
      const [fileNodes, fileRelationships] = await fileVisitor.visit();
      
      // Add results to the combined arrays
      nodes.push(...fileNodes);
      relationships.push(...fileRelationships);
      
      // Create and run using visitor
      const usingVisitor = new UsingVisitor(this.filePath, this.idServiceClient);
      // Copy state from file visitor
      usingVisitor.setFileCanonicalId(fileVisitor.getFileCanonicalId());
      usingVisitor.setFileGid(fileVisitor.getFileGid());
      usingVisitor.setNamespaceCanonicalId(fileVisitor.getNamespaceCanonicalId());
      usingVisitor.setNamespaceGid(fileVisitor.getNamespaceGid());
      usingVisitor.setNamespaceName(fileVisitor.getNamespaceName());
      usingVisitor.setEntityMap(fileVisitor.getEntityMap());
      usingVisitor.setTree(fileVisitor.getTree());
      usingVisitor.setContent(fileVisitor.getContent());
      
      const [usingNodes, usingRelationships] = await usingVisitor.visit();
      
      // Add results to the combined arrays
      nodes.push(...usingNodes);
      relationships.push(...usingRelationships);
      
      // Create and run class/interface visitor
      const classInterfaceVisitor = new ClassInterfaceVisitor(this.filePath, this.idServiceClient);
      // Copy state from previous visitors
      classInterfaceVisitor.setFileCanonicalId(fileVisitor.getFileCanonicalId());
      classInterfaceVisitor.setFileGid(fileVisitor.getFileGid());
      classInterfaceVisitor.setNamespaceCanonicalId(fileVisitor.getNamespaceCanonicalId());
      classInterfaceVisitor.setNamespaceGid(fileVisitor.getNamespaceGid());
      classInterfaceVisitor.setNamespaceName(fileVisitor.getNamespaceName());
      classInterfaceVisitor.setEntityMap(fileVisitor.getEntityMap());
      classInterfaceVisitor.setTree(fileVisitor.getTree());
      classInterfaceVisitor.setContent(fileVisitor.getContent());
      
      const [classNodes, classRelationships] = await classInterfaceVisitor.visit();
      
      // Add results to the combined arrays
      nodes.push(...classNodes);
      relationships.push(...classRelationships);
      
      // Create and run member visitor
      const memberVisitor = new MemberVisitor(this.filePath, this.idServiceClient);
      // Copy state from previous visitors
      memberVisitor.setFileCanonicalId(fileVisitor.getFileCanonicalId());
      memberVisitor.setFileGid(fileVisitor.getFileGid());
      memberVisitor.setNamespaceCanonicalId(fileVisitor.getNamespaceCanonicalId());
      memberVisitor.setNamespaceGid(fileVisitor.getNamespaceGid());
      memberVisitor.setNamespaceName(fileVisitor.getNamespaceName());
      memberVisitor.setEntityMap(fileVisitor.getEntityMap());
      memberVisitor.setTree(fileVisitor.getTree());
      memberVisitor.setContent(fileVisitor.getContent());
      
      const [memberNodes, memberRelationships] = await memberVisitor.visit();
      
      // Add results to the combined arrays
      nodes.push(...memberNodes);
      relationships.push(...memberRelationships);
      
      // Create and run attribute visitor
      const attributeVisitor = new AttributeVisitor(this.filePath, this.idServiceClient);
      // Copy state from previous visitors
      attributeVisitor.setFileCanonicalId(fileVisitor.getFileCanonicalId());
      attributeVisitor.setFileGid(fileVisitor.getFileGid());
      attributeVisitor.setNamespaceCanonicalId(fileVisitor.getNamespaceCanonicalId());
      attributeVisitor.setNamespaceGid(fileVisitor.getNamespaceGid());
      attributeVisitor.setNamespaceName(fileVisitor.getNamespaceName());
      attributeVisitor.setEntityMap(fileVisitor.getEntityMap());
      attributeVisitor.setTree(fileVisitor.getTree());
      attributeVisitor.setContent(fileVisitor.getContent());
      
      const [attributeNodes, attributeRelationships] = await attributeVisitor.visit();
      
      // Add results to the combined arrays
      nodes.push(...attributeNodes);
      relationships.push(...attributeRelationships);
      
      // Process attribute usage relationships
      const attributeUsageRelationships = await attributeVisitor.processAttributeUsage();
      relationships.push(...attributeUsageRelationships);
      
      // Create and run relationship visitor
      const relationshipVisitor = new RelationshipVisitor(this.filePath, this.idServiceClient);
      // Copy state from previous visitors
      relationshipVisitor.setFileCanonicalId(fileVisitor.getFileCanonicalId());
      relationshipVisitor.setFileGid(fileVisitor.getFileGid());
      relationshipVisitor.setNamespaceCanonicalId(fileVisitor.getNamespaceCanonicalId());
      relationshipVisitor.setNamespaceGid(fileVisitor.getNamespaceGid());
      relationshipVisitor.setNamespaceName(fileVisitor.getNamespaceName());
      relationshipVisitor.setEntityMap(fileVisitor.getEntityMap());
      relationshipVisitor.setTree(fileVisitor.getTree());
      relationshipVisitor.setContent(fileVisitor.getContent());
      
      const [relationshipNodes, relationshipRelationships] = await relationshipVisitor.visit();
      
      // Add results to the combined arrays
      nodes.push(...relationshipNodes);
      relationships.push(...relationshipRelationships);
      
      logger.info(`Processed file ${this.filePath}: ${nodes.length} nodes, ${relationships.length} relationships`);
      
      return [nodes, relationships];
    } catch (error: any) {
      logger.error(`Error in VisitorCoordinator for ${this.filePath}: ${error}`);
      return [[], []];
    }
  }
}