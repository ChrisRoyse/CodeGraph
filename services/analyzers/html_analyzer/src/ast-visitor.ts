/**
 * AST Visitor for HTML/CSS Analyzer
 * 
 * This module provides functionality to traverse HTML and CSS ASTs
 * and extract code structure information.
 */

import * as fs from 'fs';
import * as path from 'path';
import Parser, { Tree, SyntaxNode } from 'tree-sitter';
import HTML from 'tree-sitter-html';
import CSS from 'tree-sitter-css';
import { IdServiceClient } from './id-service-client';
import { 
  AnalysisNode, 
  AnalysisRelationship, 
  HtmlEntityType, 
  CssEntityType,
  HtmlRelationshipType, 
  CssRelationshipType,
  HtmlElementProperties,
  HtmlAttributeProperties,
  CssRuleProperties,
  CssPropertyProperties
} from './models';

// Configure logging
const logger = {
  info: (message: string) => console.log(`[INFO] ${message}`),
  error: (message: string) => console.error(`[ERROR] ${message}`),
  debug: (message: string) => console.debug(`[DEBUG] ${message}`)
};

/**
 * Analyze an HTML file
 * 
 * @param filePath Path to the file to analyze
 * @param idServiceClient Client for the ID Service
 * @returns Promise resolving to a tuple of [nodes, relationships]
 */
export async function analyzeHtmlFile(
  filePath: string,
  idServiceClient: IdServiceClient
): Promise<[AnalysisNode[], AnalysisRelationship[]]> {
  try {
    const visitor = new HtmlAstVisitor(filePath, idServiceClient);
    return await visitor.analyze();
  } catch (error) {
    logger.error(`Error analyzing HTML file ${filePath}: ${error}`);
    return [[], []];
  }
}

/**
 * Analyze a CSS file
 * 
 * @param filePath Path to the file to analyze
 * @param idServiceClient Client for the ID Service
 * @returns Promise resolving to a tuple of [nodes, relationships]
 */
export async function analyzeCssFile(
  filePath: string,
  idServiceClient: IdServiceClient
): Promise<[AnalysisNode[], AnalysisRelationship[]]> {
  try {
    const visitor = new CssAstVisitor(filePath, idServiceClient);
    return await visitor.analyze();
  } catch (error) {
    logger.error(`Error analyzing CSS file ${filePath}: ${error}`);
    return [[], []];
  }
}

/**
 * AST Visitor for HTML files
 */
class HtmlAstVisitor {
  private filePath: string;
  private idServiceClient: IdServiceClient;
  private nodes: AnalysisNode[] = [];
  private relationships: AnalysisRelationship[] = [];
  private fileCanonicalId: string | null = null;
  private fileGid: string | null = null;
  private htmlParser: Parser;
  private cssParser: Parser;
  private tree: Tree | null = null;
  private content: string = '';
  
  // Map to track elements by ID for relationship creation
  private elementMap: Map<string, { canonicalId: string, gid: string }> = new Map();
  
  // Queries for finding specific HTML constructs
  private elementQuery: string;
  private attributeQuery: string;
  private styleTagQuery: string;
  private scriptTagQuery: string;
  private linkTagQuery: string;

  /**
   * Initialize the AST visitor
   * 
   * @param filePath Path to the file to analyze
   * @param idServiceClient Client for the ID Service
   */
  constructor(filePath: string, idServiceClient: IdServiceClient) {
    this.filePath = filePath;
    this.idServiceClient = idServiceClient;

    // Initialize parsers
    this.htmlParser = new Parser();
    this.htmlParser.setLanguage(HTML);
    
    this.cssParser = new Parser();
    this.cssParser.setLanguage(CSS);
    
    // Initialize queries for finding HTML constructs
    this.elementQuery = `
      (element
        (start_tag
          (tag_name) @tag_name)
        ) @element
    `;
    
    this.attributeQuery = `
      (element
        (start_tag
          (tag_name) @tag_name
          (attribute
            (attribute_name) @attr_name
            (attribute_value)? @attr_value)
          )
        ) @element
    `;
    
    this.styleTagQuery = `
      (element
        (start_tag
          (tag_name) @tag_name
          (#eq? @tag_name "style"))
        (text) @style_content
      ) @style_element
    `;
    
    this.scriptTagQuery = `
      (element
        (start_tag
          (tag_name) @tag_name
          (#eq? @tag_name "script"))
        (text)? @script_content
      ) @script_element
    `;
    
    this.linkTagQuery = `
      (element
        (start_tag
          (tag_name) @tag_name
          (#eq? @tag_name "link")
          (attribute
            (attribute_name) @attr_name
            (attribute_value) @attr_value
            (#eq? @attr_name "rel")
            (#eq? @attr_value "stylesheet"))
          (attribute
            (attribute_name) @href_name
            (attribute_value) @href_value
            (#eq? @href_name "href"))
        )
      ) @link_element
    `;
  }

  /**
   * Parse the file and analyze the HTML AST
   */
  async analyze(): Promise<[AnalysisNode[], AnalysisRelationship[]]> {
    try {
      // Read the file content
      this.content = fs.readFileSync(this.filePath, 'utf8');

      // Parse the file
      this.tree = this.htmlParser.parse(this.content);

      // Generate ID for the file
      const fileName = path.basename(this.filePath);
      const [canonicalId, gid] = await this.idServiceClient.generateId(
        this.filePath,
        HtmlEntityType.File,
        fileName
      );
      this.fileCanonicalId = canonicalId;
      this.fileGid = gid;

      // Add file node
      this.nodes.push({
        type: HtmlEntityType.File,
        name: fileName,
        path: this.filePath,
        parent_canonical_id: '',
        canonical_id: canonicalId,
        gid: gid,
        properties: {
          extension: path.extname(this.filePath).toLowerCase()
        }
      });

      // Process HTML constructs
      await this.processElements();
      await this.processAttributes();
      await this.processStyleTags();
      await this.processScriptTags();
      await this.processLinkTags();

      return [this.nodes, this.relationships];
    } catch (error) {
      logger.error(`Error analyzing file ${this.filePath}: ${error}`);
      return [[], []];
    }
  }

  /**
   * Process HTML elements
   */
  private async processElements(): Promise<void> {
    try {
      if (!this.tree || !this.fileCanonicalId || !this.fileGid) return;

      // Create a query to find all HTML elements
      const query = this.htmlParser.getLanguage().query(this.elementQuery);
      const matches = query.matches(this.tree.rootNode);

      for (const match of matches) {
        let tagName = '';
        let element = null;
        
        for (const capture of match.captures) {
          if (capture.name === 'tag_name') {
            tagName = capture.node.text;
          } else if (capture.name === 'element') {
            element = capture.node;
          }
        }
        
        if (tagName && element) {
          // Generate a unique name for the element (using position as part of the name)
          const position = element.startPosition;
          const elementName = `${tagName}_${position.row}_${position.column}`;
          
          // Generate ID for the element
          const [canonicalId, gid] = await this.idServiceClient.generateId(
            this.filePath,
            HtmlEntityType.Element,
            elementName,
            this.fileCanonicalId
          );
          
          // Extract element properties
          const elementProperties: HtmlElementProperties = {
            tag_name: tagName,
            line_number: position.row + 1,
            column_number: position.column + 1
          };
          
          // Check for id and class attributes
          const idMatch = element.text.match(/id=["']([^"']*)["']/);
          if (idMatch && idMatch[1]) {
            elementProperties.id = idMatch[1];
          }
          
          const classMatch = element.text.match(/class=["']([^"']*)["']/);
          if (classMatch && classMatch[1]) {
            elementProperties.class_list = classMatch[1].split(/\s+/).filter((c: string) => c.length > 0);
          }
          
          // Add element node
          this.nodes.push({
            type: HtmlEntityType.Element,
            name: elementName,
            path: this.filePath,
            parent_canonical_id: this.fileCanonicalId,
            canonical_id: canonicalId,
            gid: gid,
            properties: elementProperties
          });
          
          // Store element info for relationship creation
          this.elementMap.set(elementName, { canonicalId, gid });
          
          // Add relationship between file and element
          this.relationships.push({
            source_gid: this.fileGid,
            target_canonical_id: canonicalId,
            type: HtmlRelationshipType.CONTAINS,
            properties: {}
          });
          
          // Process nested elements to create parent-child relationships
          await this.processNestedElements(element, canonicalId, gid);
        }
      }
    } catch (error) {
      logger.error(`Error processing elements: ${error}`);
    }
  }

  /**
   * Process nested HTML elements to create parent-child relationships
   */
  private async processNestedElements(
    parentElement: SyntaxNode,
    parentCanonicalId: string,
    parentGid: string
  ): Promise<void> {
    try {
      // Find all child elements
      const childElements = parentElement.children.filter(
        (child: SyntaxNode) => child.type === 'element'
      );
      
      for (const childElement of childElements) {
        // Get the tag name from the start_tag
        const startTag = childElement.children.find((child: SyntaxNode) => child.type === 'start_tag');
        if (!startTag) continue;
        
        const tagNameNode = startTag.children.find((child: SyntaxNode) => child.type === 'tag_name');
        if (!tagNameNode) continue;
        
        const tagName = tagNameNode.text;
        const position = childElement.startPosition;
        const elementName = `${tagName}_${position.row}_${position.column}`;
        
        // Check if we already processed this element
        const elementInfo = this.elementMap.get(elementName);
        if (elementInfo) {
          // Create relationship between parent and child element
          this.relationships.push({
            source_gid: parentGid,
            target_canonical_id: elementInfo.canonicalId,
            type: HtmlRelationshipType.CONTAINS,
            properties: {
              order: childElement.childIndex
            }
          });
          
          // Recursively process nested elements
          await this.processNestedElements(childElement, elementInfo.canonicalId, elementInfo.gid);
        }
      }
    } catch (error) {
      logger.error(`Error processing nested elements: ${error}`);
    }
  }

  /**
   * Process HTML attributes
   */
  private async processAttributes(): Promise<void> {
    try {
      if (!this.tree || !this.fileCanonicalId || !this.fileGid) return;
      
      // Create a query to find all HTML attributes
      const query = this.htmlParser.getLanguage().query(this.attributeQuery);
      const matches = query.matches(this.tree.rootNode);
      
      for (const match of matches) {
        let tagName = '';
        let attrName = '';
        let attrValue = '';
        let element = null;
        
        for (const capture of match.captures) {
          if (capture.name === 'tag_name') {
            tagName = capture.node.text;
          } else if (capture.name === 'attr_name') {
            attrName = capture.node.text;
          } else if (capture.name === 'attr_value') {
            // Remove quotes from attribute value
            attrValue = capture.node.text.replace(/^["']|["']$/g, '');
          } else if (capture.name === 'element') {
            element = capture.node;
          }
        }
        
        if (tagName && attrName && element) {
          // Skip id and class attributes as they are already processed with the element
          if (attrName === 'id' || attrName === 'class') continue;
          
          // Generate a unique name for the element (using position as part of the name)
          const position = element.startPosition;
          const elementName = `${tagName}_${position.row}_${position.column}`;
          
          // Get the element info
          const elementInfo = this.elementMap.get(elementName);
          if (!elementInfo) continue;
          
          // Generate a unique name for the attribute
          const attributeName = `${elementName}_${attrName}`;
          
          // Generate ID for the attribute
          const [canonicalId, gid] = await this.idServiceClient.generateId(
            this.filePath,
            HtmlEntityType.Attribute,
            attributeName,
            elementInfo.canonicalId
          );
          
          // Create attribute properties
          const attributeProperties: HtmlAttributeProperties = {
            name: attrName,
            value: attrValue
          };
          
          // Add attribute node
          this.nodes.push({
            type: HtmlEntityType.Attribute,
            name: attributeName,
            path: this.filePath,
            parent_canonical_id: elementInfo.canonicalId,
            canonical_id: canonicalId,
            gid: gid,
            properties: attributeProperties
          });
          
          // Add relationship between element and attribute
          this.relationships.push({
            source_gid: elementInfo.gid,
            target_canonical_id: canonicalId,
            type: HtmlRelationshipType.HAS_ATTRIBUTE,
            properties: {}
          });
          
          // Special handling for event handlers (onclick, onload, etc.)
          if (attrName.startsWith('on') && attrValue) {
            // Add relationship for event handler
            this.relationships.push({
              source_gid: elementInfo.gid,
              target_canonical_id: canonicalId,
              type: HtmlRelationshipType.REFERENCES,
              properties: {
                event_type: attrName.substring(2), // Remove 'on' prefix
                handler: attrValue
              }
            });
          }
        }
      }
    } catch (error) {
      logger.error(`Error processing attributes: ${error}`);
    }
  }

  /**
   * Process style tags and their CSS content
   */
  private async processStyleTags(): Promise<void> {
    try {
      if (!this.tree || !this.fileCanonicalId || !this.fileGid) return;
      
      // Create a query to find all style tags
      const query = this.htmlParser.getLanguage().query(this.styleTagQuery);
      const matches = query.matches(this.tree.rootNode);
      
      for (const match of matches) {
        let styleContent = '';
        let styleElement = null;
        
        for (const capture of match.captures) {
          if (capture.name === 'style_content') {
            styleContent = capture.node.text;
          } else if (capture.name === 'style_element') {
            styleElement = capture.node;
          }
        }
        
        if (styleContent && styleElement) {
          // Generate a unique name for the style element
          const position = styleElement.startPosition;
          const styleName = `style_${position.row}_${position.column}`;
          
          // Generate ID for the style element
          const [canonicalId, gid] = await this.idServiceClient.generateId(
            this.filePath,
            HtmlEntityType.Style,
            styleName,
            this.fileCanonicalId
          );
          
          // Add style node
          this.nodes.push({
            type: HtmlEntityType.Style,
            name: styleName,
            path: this.filePath,
            parent_canonical_id: this.fileCanonicalId,
            canonical_id: canonicalId,
            gid: gid,
            properties: {
              line_number: position.row + 1,
              column_number: position.column + 1
            }
          });
          
          // Add relationship between file and style
          this.relationships.push({
            source_gid: this.fileGid,
            target_canonical_id: canonicalId,
            type: HtmlRelationshipType.CONTAINS,
            properties: {}
          });
          
          // Process the CSS content
          await this.processCssContent(styleContent, canonicalId, gid);
        }
      }
    } catch (error) {
      logger.error(`Error processing style tags: ${error}`);
    }
  }

  /**
   * Process script tags
   */
  private async processScriptTags(): Promise<void> {
    try {
      if (!this.tree || !this.fileCanonicalId || !this.fileGid) return;
      
      // Create a query to find all script tags
      const query = this.htmlParser.getLanguage().query(this.scriptTagQuery);
      const matches = query.matches(this.tree.rootNode);
      
      for (const match of matches) {
        let scriptContent = '';
        let scriptElement = null;
        
        for (const capture of match.captures) {
          if (capture.name === 'script_content') {
            scriptContent = capture.node.text;
          } else if (capture.name === 'script_element') {
            scriptElement = capture.node;
          }
        }
        
        if (scriptElement) {
          // Generate a unique name for the script element
          const position = scriptElement.startPosition;
          const scriptName = `script_${position.row}_${position.column}`;
          
          // Check for src attribute
          const srcMatch = scriptElement.text.match(/src=["']([^"']*)["']/);
          const srcValue = srcMatch ? srcMatch[1] : null;
          
          // Generate ID for the script element
          const [canonicalId, gid] = await this.idServiceClient.generateId(
            this.filePath,
            HtmlEntityType.Script,
            scriptName,
            this.fileCanonicalId
          );
          
          // Add script node
          this.nodes.push({
            type: HtmlEntityType.Script,
            name: scriptName,
            path: this.filePath,
            parent_canonical_id: this.fileCanonicalId,
            canonical_id: canonicalId,
            gid: gid,
            properties: {
              line_number: position.row + 1,
              column_number: position.column + 1,
              src: srcValue,
              has_content: scriptContent.trim().length > 0
            }
          });
          
          // Add relationship between file and script
          this.relationships.push({
            source_gid: this.fileGid,
            target_canonical_id: canonicalId,
            type: HtmlRelationshipType.CONTAINS,
            properties: {}
          });
          
          // If the script has a src attribute, add a reference relationship
          if (srcValue) {
            this.relationships.push({
              source_gid: gid,
              target_canonical_id: canonicalId,
              type: HtmlRelationshipType.REFERENCES,
              properties: {
                reference_type: 'external',
                path: srcValue
              }
            });
          }
        }
      }
    } catch (error) {
      logger.error(`Error processing script tags: ${error}`);
    }
  }

  /**
   * Process link tags for CSS stylesheets
   */
  private async processLinkTags(): Promise<void> {
    try {
      if (!this.tree || !this.fileCanonicalId || !this.fileGid) return;
      
      // Create a query to find all link tags for stylesheets
      const query = this.htmlParser.getLanguage().query(this.linkTagQuery);
      const matches = query.matches(this.tree.rootNode);
      
      for (const match of matches) {
        let hrefValue = '';
        let linkElement = null;
        
        for (const capture of match.captures) {
          if (capture.name === 'href_value') {
            // Remove quotes from href value
            hrefValue = capture.node.text.replace(/^["']|["']$/g, '');
          } else if (capture.name === 'link_element') {
            linkElement = capture.node;
          }
        }
        
        if (hrefValue && linkElement) {
          // Generate a unique name for the link element
          const position = linkElement.startPosition;
          const linkName = `link_${position.row}_${position.column}`;
          
          // Generate ID for the link element
          const [canonicalId, gid] = await this.idServiceClient.generateId(
            this.filePath,
            HtmlEntityType.Element,
            linkName,
            this.fileCanonicalId
          );
          
          // Add link node
          this.nodes.push({
            type: HtmlEntityType.Element,
            name: linkName,
            path: this.filePath,
            parent_canonical_id: this.fileCanonicalId,
            canonical_id: canonicalId,
            gid: gid,
            properties: {
              tag_name: 'link',
              line_number: position.row + 1,
              column_number: position.column + 1,
              rel: 'stylesheet',
              href: hrefValue
            }
          });
          
          // Add relationship between file and link
          this.relationships.push({
            source_gid: this.fileGid,
            target_canonical_id: canonicalId,
            type: HtmlRelationshipType.CONTAINS,
            properties: {}
          });
          
          // Add relationship for external stylesheet reference
          this.relationships.push({
            source_gid: gid,
            target_canonical_id: canonicalId,
            type: HtmlRelationshipType.INCLUDES,
            properties: {
              reference_type: 'stylesheet',
              path: hrefValue
            }
          });
        }
      }
    } catch (error) {
      logger.error(`Error processing link tags: ${error}`);
    }
  }

  /**
   * Process CSS content from style tags
   */
  private async processCssContent(
    cssContent: string,
    parentCanonicalId: string,
    parentGid: string
  ): Promise<void> {
    try {
      // Parse the CSS content
      const cssTree = this.cssParser.parse(cssContent);
      
      // Process CSS rules
      const ruleNodes = cssTree.rootNode.children.filter(
        (child: SyntaxNode) => child.type === 'rule_set'
      );
      
      for (const ruleNode of ruleNodes) {
        // Extract selector
        const selectorNode = ruleNode.children.find((child: SyntaxNode) => child.type === 'selectors');
        if (!selectorNode) continue;
        
        const selectorText = selectorNode.text.trim();
        const position = ruleNode.startPosition;
        const ruleName = `rule_${position.row}_${position.column}`;
        
        // Generate ID for the rule
        const [ruleCanonicalId, ruleGid] = await this.idServiceClient.generateId(
          this.filePath,
          CssEntityType.Rule,
          ruleName,
          parentCanonicalId
        );
        
        // Create rule properties
        const ruleProperties: CssRuleProperties = {
          selector_text: selectorText,
          line_number: position.row + 1,
          column_number: position.column + 1
        };
        
        // Add rule node
        this.nodes.push({
          type: CssEntityType.Rule,
          name: ruleName,
          path: this.filePath,
          parent_canonical_id: parentCanonicalId,
          canonical_id: ruleCanonicalId,
          gid: ruleGid,
          properties: ruleProperties
        });
        
        // Add relationship between parent and rule
        this.relationships.push({
          source_gid: parentGid,
          target_canonical_id: ruleCanonicalId,
          type: CssRelationshipType.CONTAINS,
          properties: {}
        });
        
        // Process CSS properties
        const blockNode = ruleNode.children.find((child: SyntaxNode) => child.type === 'block');
        if (!blockNode) continue;
        
        const declarationNodes = blockNode.children.filter(
          (child: SyntaxNode) => child.type === 'declaration'
        );
        
        for (const declarationNode of declarationNodes) {
          // Extract property name and value
          const propertyNode = declarationNode.children.find((child: SyntaxNode) => child.type === 'property_name');
          const valueNode = declarationNode.children.find((child: SyntaxNode) => child.type === 'property_value');
          
          if (!propertyNode || !valueNode) continue;
          
          const propertyName = propertyNode.text.trim();
          const propertyValue = valueNode.text.trim();
          const propPosition = declarationNode.startPosition;
          const propName = `${ruleName}_${propertyName}`;
          
          // Check for !important
          const isImportant = propertyValue.includes('!important');
          
          // Generate ID for the property
          const [propCanonicalId, propGid] = await this.idServiceClient.generateId(
            this.filePath,
            CssEntityType.Property,
            propName,
            ruleCanonicalId
          );
          
          // Create property properties
          const propProperties: CssPropertyProperties = {
            name: propertyName,
            value: propertyValue.replace(/\s*!important\s*/, '').trim(),
            important: isImportant
          };
          
          // Add property node
          this.nodes.push({
            type: CssEntityType.Property,
            name: propName,
            path: this.filePath,
            parent_canonical_id: ruleCanonicalId,
            canonical_id: propCanonicalId,
            gid: propGid,
            properties: propProperties
          });
          
          // Add relationship between rule and property
          this.relationships.push({
            source_gid: ruleGid,
            target_canonical_id: propCanonicalId,
            type: CssRelationshipType.DEFINES,
            properties: {}
          });
        }
        
        // Add relationships between CSS rules and HTML elements
        // This is a simplistic approach - in a real implementation, we would need to
        // resolve the selectors against the actual HTML elements
        if (selectorText.startsWith('#')) {
          // ID selector
          const idValue = selectorText.substring(1);
          
          // Find elements with this ID
          for (const [elementName, elementInfo] of this.elementMap.entries()) {
            const node = this.nodes.find(n => n.gid === elementInfo.gid);
            if (node && node.properties && node.properties.id === idValue) {
              this.relationships.push({
                source_gid: ruleGid,
                target_canonical_id: elementInfo.canonicalId,
                type: CssRelationshipType.STYLES,
                properties: {
                  selector_type: 'id',
                  selector_value: idValue
                }
              });
            }
          }
        } else if (selectorText.startsWith('.')) {
          // Class selector
          const className = selectorText.substring(1);
          
          // Find elements with this class
          for (const [elementName, elementInfo] of this.elementMap.entries()) {
            const node = this.nodes.find(n => n.gid === elementInfo.gid);
            if (node && node.properties && node.properties.class_list &&
                node.properties.class_list.includes(className)) {
              this.relationships.push({
                source_gid: ruleGid,
                target_canonical_id: elementInfo.canonicalId,
                type: CssRelationshipType.STYLES,
                properties: {
                  selector_type: 'class',
                  selector_value: className
                }
              });
            }
          }
        } else if (selectorText.match(/^[a-zA-Z0-9_-]+$/)) {
          // Element selector
          const tagName = selectorText;
          
          // Find elements with this tag name
          for (const [elementName, elementInfo] of this.elementMap.entries()) {
            const node = this.nodes.find(n => n.gid === elementInfo.gid);
            if (node && node.properties && node.properties.tag_name === tagName) {
              this.relationships.push({
                source_gid: ruleGid,
                target_canonical_id: elementInfo.canonicalId,
                type: CssRelationshipType.STYLES,
                properties: {
                  selector_type: 'element',
                  selector_value: tagName
                }
              });
            }
          }
        }
      }
    } catch (error) {
      logger.error(`Error processing CSS content: ${error}`);
    }
  }
}

/**
 * AST Visitor for CSS files
 */
class CssAstVisitor {
  private filePath: string;
  private idServiceClient: IdServiceClient;
  private nodes: AnalysisNode[] = [];
  private relationships: AnalysisRelationship[] = [];
  private fileCanonicalId: string | null = null;
  private fileGid: string | null = null;
  private cssParser: Parser;
  private tree: Tree | null = null;
  private content: string = '';

  /**
   * Initialize the AST visitor
   * 
   * @param filePath Path to the file to analyze
   * @param idServiceClient Client for the ID Service
   */
  constructor(filePath: string, idServiceClient: IdServiceClient) {
    this.filePath = filePath;
    this.idServiceClient = idServiceClient;

    // Initialize parser
    this.cssParser = new Parser();
    this.cssParser.setLanguage(CSS);
  }

  /**
   * Parse the file and analyze the CSS AST
   */
  async analyze(): Promise<[AnalysisNode[], AnalysisRelationship[]]> {
    try {
      // Read the file content
      this.content = fs.readFileSync(this.filePath, 'utf8');

      // Parse the file
      this.tree = this.cssParser.parse(this.content);

      // Generate ID for the file
      const fileName = path.basename(this.filePath);
      const [canonicalId, gid] = await this.idServiceClient.generateId(
        this.filePath,
        CssEntityType.File,
        fileName
      );
      this.fileCanonicalId = canonicalId;
      this.fileGid = gid;

      // Add file node
      this.nodes.push({
        type: CssEntityType.File,
        name: fileName,
        path: this.filePath,
        parent_canonical_id: '',
        canonical_id: canonicalId,
        gid: gid,
        properties: {
          extension: path.extname(this.filePath).toLowerCase()
        }
      });

      // Process CSS rules
      await this.processCssRules();

      return [this.nodes, this.relationships];
    } catch (error) {
      logger.error(`Error analyzing file ${this.filePath}: ${error}`);
      return [[], []];
    }
  }

  /**
   * Process CSS rules
   */
  private async processCssRules(): Promise<void> {
    try {
      if (!this.tree || !this.fileCanonicalId || !this.fileGid) return;
      
      // Process CSS rules
      const ruleNodes = this.tree.rootNode.children.filter(
        (child: SyntaxNode) => child.type === 'rule_set'
      );
      
      for (const ruleNode of ruleNodes) {
        // Extract selector
        const selectorNode = ruleNode.children.find((child: SyntaxNode) => child.type === 'selectors');
        if (!selectorNode) continue;
        
        const selectorText = selectorNode.text.trim();
        const position = ruleNode.startPosition;
        const ruleName = `rule_${position.row}_${position.column}`;
        
        // Generate ID for the rule
        const [ruleCanonicalId, ruleGid] = await this.idServiceClient.generateId(
          this.filePath,
          CssEntityType.Rule,
          ruleName,
          this.fileCanonicalId
        );
        
        // Create rule properties
        const ruleProperties: CssRuleProperties = {
          selector_text: selectorText,
          line_number: position.row + 1,
          column_number: position.column + 1
        };
        
        // Add rule node
        this.nodes.push({
          type: CssEntityType.Rule,
          name: ruleName,
          path: this.filePath,
          parent_canonical_id: this.fileCanonicalId,
          canonical_id: ruleCanonicalId,
          gid: ruleGid,
          properties: ruleProperties
        });
        
        // Add relationship between file and rule
        this.relationships.push({
          source_gid: this.fileGid,
          target_canonical_id: ruleCanonicalId,
          type: CssRelationshipType.CONTAINS,
          properties: {}
        });
        
        // Process CSS properties
        const blockNode = ruleNode.children.find((child: SyntaxNode) => child.type === 'block');
        if (!blockNode) continue;
        
        const declarationNodes = blockNode.children.filter(
          (child: SyntaxNode) => child.type === 'declaration'
        );
        
        for (const declarationNode of declarationNodes) {
          // Extract property name and value
          const propertyNode = declarationNode.children.find((child: SyntaxNode) => child.type === 'property_name');
          const valueNode = declarationNode.children.find((child: SyntaxNode) => child.type === 'property_value');
          
          if (!propertyNode || !valueNode) continue;
          
          const propertyName = propertyNode.text.trim();
          const propertyValue = valueNode.text.trim();
          const propPosition = declarationNode.startPosition;
          const propName = `${ruleName}_${propertyName}`;
          
          // Check for !important
          const isImportant = propertyValue.includes('!important');
          
          // Generate ID for the property
          const [propCanonicalId, propGid] = await this.idServiceClient.generateId(
            this.filePath,
            CssEntityType.Property,
            propName,
            ruleCanonicalId
          );
          
          // Create property properties
          const propProperties: CssPropertyProperties = {
            name: propertyName,
            value: propertyValue.replace(/\s*!important\s*/, '').trim(),
            important: isImportant
          };
          
          // Add property node
          this.nodes.push({
            type: CssEntityType.Property,
            name: propName,
            path: this.filePath,
            parent_canonical_id: ruleCanonicalId,
            canonical_id: propCanonicalId,
            gid: propGid,
            properties: propProperties
          });
          
          // Add relationship between rule and property
          this.relationships.push({
            source_gid: ruleGid,
            target_canonical_id: propCanonicalId,
            type: CssRelationshipType.DEFINES,
            properties: {}
          });
        }
        
        // Add selector node
        const selectorName = `selector_${position.row}_${position.column}`;
        
        // Generate ID for the selector
        const [selectorCanonicalId, selectorGid] = await this.idServiceClient.generateId(
          this.filePath,
          CssEntityType.Selector,
          selectorName,
          ruleCanonicalId
        );
        
        // Add selector node
        this.nodes.push({
          type: CssEntityType.Selector,
          name: selectorName,
          path: this.filePath,
          parent_canonical_id: ruleCanonicalId,
          canonical_id: selectorCanonicalId,
          gid: selectorGid,
          properties: {
            text: selectorText
          }
        });
        
        // Add relationship between rule and selector
        this.relationships.push({
          source_gid: ruleGid,
          target_canonical_id: selectorCanonicalId,
          type: CssRelationshipType.CONTAINS,
          properties: {}
        });
      }
    } catch (error) {
      logger.error(`Error processing CSS rules: ${error}`);
    }
  }
}
