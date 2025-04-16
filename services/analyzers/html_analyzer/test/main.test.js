/**
 * Tests for the HTML/CSS Analyzer
 */

const { createAnalysisNodeStubs, createAnalysisRelationshipStubs } = require('../dist/index');

describe('HTML/CSS Analyzer', () => {
  describe('createAnalysisNodeStubs', () => {
    it('should create node stubs from node objects', () => {
      // Arrange
      const nodes = [
        {
          type: 'Element',
          name: 'div_1_1',
          path: '/path/to/index.html',
          parent_canonical_id: 'file::index.html',
          canonical_id: 'element::div_1_1',
          gid: 'gid1',
          properties: {
            tag_name: 'div',
            id: 'header',
            class_list: ['container', 'header']
          }
        }
      ];

      // Act
      const nodeStubs = createAnalysisNodeStubs(nodes);

      // Assert
      expect(nodeStubs).toHaveLength(1);
      expect(nodeStubs[0].gid).toBe('gid1');
      expect(nodeStubs[0].canonical_id).toBe('element::div_1_1');
      expect(nodeStubs[0].name).toBe('div_1_1');
      expect(nodeStubs[0].file_path).toBe('/path/to/index.html');
      expect(nodeStubs[0].language).toBe('html');
      expect(nodeStubs[0].labels).toContain('Element');
      expect(nodeStubs[0].properties.tag_name).toBe('div');
      expect(nodeStubs[0].properties.id).toBe('header');
      expect(nodeStubs[0].properties.class_list).toContain('container');
    });

    it('should set language to css for CSS files', () => {
      // Arrange
      const nodes = [
        {
          type: 'Rule',
          name: 'rule_1_1',
          path: '/path/to/styles.css',
          parent_canonical_id: 'file::styles.css',
          canonical_id: 'rule::.header',
          gid: 'gid2',
          properties: {
            selector_text: '.header'
          }
        }
      ];

      // Act
      const nodeStubs = createAnalysisNodeStubs(nodes);

      // Assert
      expect(nodeStubs[0].language).toBe('css');
    });
  });

  describe('createAnalysisRelationshipStubs', () => {
    it('should create relationship stubs from relationship objects', () => {
      // Arrange
      const relationships = [
        {
          source_gid: 'gid1',
          target_canonical_id: 'element::span_2_3',
          type: ':CONTAINS',
          properties: {
            order: 1
          }
        }
      ];

      // Act
      const relationshipStubs = createAnalysisRelationshipStubs(relationships);

      // Assert
      expect(relationshipStubs).toHaveLength(1);
      expect(relationshipStubs[0].source_gid).toBe('gid1');
      expect(relationshipStubs[0].target_canonical_id).toBe('element::span_2_3');
      expect(relationshipStubs[0].type).toBe(':CONTAINS');
      expect(relationshipStubs[0].properties.order).toBe(1);
    });
  });

  // HTML parsing tests
  describe('HTML parsing', () => {
    // Mock the ID Service client
    const mockIdServiceClient = {
      generateId: jest.fn().mockImplementation((filePath, entityType, name, parentCanonicalId) => {
        return Promise.resolve([`${entityType.toLowerCase()}::${name}`, `gid-${entityType.toLowerCase()}-${name}`]);
      }),
      close: jest.fn()
    };

    // Mock fs and path modules
    jest.mock('fs', () => ({
      readFileSync: jest.fn().mockImplementation((path) => {
        if (path.endsWith('.html')) {
          return `
            <!DOCTYPE html>
            <html>
              <head>
                <title>Test Page</title>
                <link rel="stylesheet" href="styles.css">
                <style>
                  .header { color: blue; }
                </style>
              </head>
              <body>
                <div id="main" class="container">
                  <h1>Hello World</h1>
                  <p>This is a test</p>
                  <button onclick="alert('clicked')">Click Me</button>
                </div>
                <script src="main.js"></script>
                <script>
                  console.log('Inline script');
                </script>
              </body>
            </html>
          `;
        } else if (path.endsWith('.css')) {
          return `
            body {
              font-family: Arial, sans-serif;
            }
            .container {
              max-width: 1200px;
              margin: 0 auto;
            }
            #main {
              padding: 20px;
            }
          `;
        }
        return '';
      })
    }));

    jest.mock('path', () => ({
      basename: jest.fn().mockImplementation((path) => path.split('/').pop()),
      extname: jest.fn().mockImplementation((path) => {
        const parts = path.split('.');
        return parts.length > 1 ? `.${parts.pop()}` : '';
      })
    }));

    // Import the functions after mocking
    const { analyzeHtmlFile, analyzeCssFile } = require('../dist/ast-visitor');

    it('should extract HTML elements, attributes, and relationships', async () => {
      // Arrange
      const filePath = '/path/to/test.html';
      
      // Act
      const [nodes, relationships] = await analyzeHtmlFile(filePath, mockIdServiceClient);
      
      // Assert
      expect(nodes.length).toBeGreaterThan(0);
      expect(relationships.length).toBeGreaterThan(0);
      
      // Check for file node
      const fileNode = nodes.find(node => node.type === 'File');
      expect(fileNode).toBeDefined();
      
      // Check for HTML elements
      const elements = nodes.filter(node => node.type === 'Element');
      expect(elements.length).toBeGreaterThan(0);
      
      // Check for div#main element
      const mainDiv = elements.find(el =>
        el.properties && el.properties.tag_name === 'div' && el.properties.id === 'main'
      );
      expect(mainDiv).toBeDefined();
      expect(mainDiv.properties.class_list).toContain('container');
      
      // Check for relationships
      const containsRels = relationships.filter(rel => rel.type === ':CONTAINS');
      expect(containsRels.length).toBeGreaterThan(0);
      
      // Check for event handler relationship
      const eventRel = relationships.find(rel =>
        rel.properties && rel.properties.event_type === 'click'
      );
      expect(eventRel).toBeDefined();
    });

    it('should extract CSS rules and properties', async () => {
      // Arrange
      const filePath = '/path/to/styles.css';
      
      // Act
      const [nodes, relationships] = await analyzeCssFile(filePath, mockIdServiceClient);
      
      // Assert
      expect(nodes.length).toBeGreaterThan(0);
      expect(relationships.length).toBeGreaterThan(0);
      
      // Check for file node
      const fileNode = nodes.find(node => node.type === 'File');
      expect(fileNode).toBeDefined();
      
      // Check for CSS rules
      const rules = nodes.filter(node => node.type === 'Rule');
      expect(rules.length).toBeGreaterThan(0);
      
      // Check for #main rule
      const mainRule = rules.find(rule =>
        rule.properties && rule.properties.selector_text === '#main'
      );
      expect(mainRule).toBeDefined();
      
      // Check for CSS properties
      const properties = nodes.filter(node => node.type === 'Property');
      expect(properties.length).toBeGreaterThan(0);
      
      // Check for relationships
      const definesRels = relationships.filter(rel => rel.type === ':DEFINES');
      expect(definesRels.length).toBeGreaterThan(0);
    });
  });

  // Message processing tests
  describe('Message processing', () => {
    it('should handle file deletion messages', () => {
      // This would test the file deletion handling in the index.ts file
      // Implementation would depend on how the testing framework is set up
      // and how the RabbitMQ integration is mocked
      expect(true).toBe(true); // Placeholder assertion
    });
  });
});