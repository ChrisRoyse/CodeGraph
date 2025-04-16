/**
 * Hint Visitor for Java Analyzer
 * 
 * This module provides the visitor for extracting manual relationship hints from code comments.
 */

import { BaseVisitor } from './base-visitor';
import { SyntaxNode } from '../ast-visitor-utils';
import { JavaEntityType, JavaRelationshipType, HintType, HintComment } from '../models';

/**
 * Visitor for extracting manual relationship hints from code comments
 */
export class HintVisitor extends BaseVisitor {
  /**
   * Visit the root node of a Java file to extract hint comments
   * 
   * @param rootNode The root node of the Java file
   */
  public async visit(rootNode: SyntaxNode): Promise<void> {
    try {
      // Process the entire source code for hint comments
      await this.processHintComments();
    } catch (error) {
      this.logError('Error in HintVisitor', error);
    }
  }

  /**
   * Process hint comments in the source code
   */
  private async processHintComments(): Promise<void> {
    try {
      // Regular expression to match bmcp hint comments
      // Format: // bmcp:<hint-type> <target-id>
      const hintRegex = /\/\/\s*bmcp:(call-target|imports|uses-type)\s+([^\n]+)/g;
      
      let match;
      while ((match = hintRegex.exec(this.sourceCode)) !== null) {
        const hintType = match[1] as HintType;
        const targetId = match[2].trim();
        
        // Create hint comment object
        const hint: HintComment = {
          type: hintType,
          target: targetId
        };
        
        // Process the hint to generate a relationship
        await this.processHint(hint, match.index);
      }
    } catch (error) {
      this.logError('Error processing hint comments', error);
    }
  }

  /**
   * Process a single hint to generate a relationship
   * 
   * @param hint The hint to process
   * @param position The position of the hint in the source code
   */
  private async processHint(hint: HintComment, position: number): Promise<void> {
    try {
      // Find the entity that contains this hint
      const sourceInfo = this.findSourceEntityForHint(position);
      if (!sourceInfo) {
        this.logError('Could not determine source entity for hint', 
          new Error(`Hint at position ${position} has no identifiable source entity`));
        return;
      }
      
      const { entityType, entityName } = sourceInfo;
      
      // Generate the source entity ID
      const [sourceCanonicalId, sourceGid] = await this.idServiceClient.generateId(
        this.filePath,
        entityType,
        entityName,
        '',
        [],
        'java'
      );
      
      // Generate the target entity ID based on the hint target
      let targetEntityType: JavaEntityType;
      let relationshipType: JavaRelationshipType;
      
      // Set appropriate entity and relationship types based on hint type
      switch (hint.type) {
        case HintType.CALL_TARGET:
          targetEntityType = JavaEntityType.Method;
          relationshipType = JavaRelationshipType.CALLS;
          break;
        case HintType.IMPORTS:
          targetEntityType = JavaEntityType.Class; // Could also be Interface, Enum, etc.
          relationshipType = JavaRelationshipType.IMPORTS;
          break;
        case HintType.USES_TYPE:
          targetEntityType = JavaEntityType.Class; // Could also be Interface, Enum, etc.
          relationshipType = JavaRelationshipType.USES_TYPE;
          break;
        default:
          this.logError('Unknown hint type', new Error(`Hint type ${hint.type} not supported`));
          return;
      }
      
      const [targetCanonicalId] = await this.idServiceClient.generateId(
        '',
        targetEntityType,
        hint.target,
        '',
        [],
        'java'
      );
      
      // Add the relationship based on the hint
      this.addRelationship({
        source_gid: sourceGid,
        target_canonical_id: targetCanonicalId,
        type: relationshipType,
        properties: {
          // Add any additional properties here
          manual_hint: true,
          hint_type: hint.type
        }
      });
    } catch (error) {
      this.logError(`Error processing hint: ${hint.type} -> ${hint.target}`, error);
    }
  }

  /**
   * Find the source entity for a hint based on its position in the code
   * 
   * @param position The position of the hint in the source code
   * @returns The entity type and name of the source entity
   */
  private findSourceEntityForHint(position: number): { entityType: JavaEntityType, entityName: string } | null {
    // Find the line number for the position
    const lines = this.sourceCode.substring(0, position).split('\n');
    const lineNumber = lines.length;
    
    // Simple heuristic: check the next non-comment, non-empty line
    // to determine what entity the hint applies to
    const remainingLines = this.sourceCode.substring(position).split('\n');
    
    // Skip empty lines and comment lines
    let lineOffset = 1;  // Start from the next line
    while (lineOffset < remainingLines.length) {
      const line = remainingLines[lineOffset].trim();
      if (line && !line.startsWith('//') && !line.startsWith('/*') && !line.startsWith('*')) {
        break;
      }
      lineOffset++;
    }
    
    if (lineOffset >= remainingLines.length) {
      return null;
    }
    
    const entityLine = remainingLines[lineOffset].trim();
    
    // Check for class, interface, enum, or method declaration
    if (entityLine.includes('class ')) {
      const match = entityLine.match(/\bclass\s+(\w+)/);
      if (match) {
        return { entityType: JavaEntityType.Class, entityName: match[1] };
      }
    } else if (entityLine.includes('interface ')) {
      const match = entityLine.match(/\binterface\s+(\w+)/);
      if (match) {
        return { entityType: JavaEntityType.Interface, entityName: match[1] };
      }
    } else if (entityLine.includes('enum ')) {
      const match = entityLine.match(/\benum\s+(\w+)/);
      if (match) {
        return { entityType: JavaEntityType.Enum, entityName: match[1] };
      }
    } else if (entityLine.includes('(') && entityLine.includes(')')) {
      // This is likely a method or constructor
      // Extract method name with a basic regex
      const match = entityLine.match(/\b(\w+)\s*\(/);
      if (match) {
        // Check if it's a constructor (matches class name) or a method
        // For simplicity, we'll just classify it as a Method for now
        return { entityType: JavaEntityType.Method, entityName: match[1] };
      }
    } else if (entityLine.includes('import ')) {
      const match = entityLine.match(/\bimport\s+([^;]+)/);
      if (match) {
        return { entityType: JavaEntityType.Import, entityName: match[1] };
      }
    } else {
      // It could be a field declaration
      const match = entityLine.match(/\b(\w+)\s*(?:=|;)/);
      if (match) {
        return { entityType: JavaEntityType.Field, entityName: match[1] };
      }
    }
    
    // If we can't determine the entity, default to file level
    return { entityType: JavaEntityType.File, entityName: this.filePath.split('/').pop() || '' };
  }
}