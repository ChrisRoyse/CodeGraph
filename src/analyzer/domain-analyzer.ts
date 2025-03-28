import { AstNode } from './parser';
import path from 'path';
import { createContextLogger } from '../utils/logger';

const logger = createContextLogger('DomainAnalyzer');

// Define domain keywords and their corresponding domain names
// This can be expanded significantly based on project conventions
const DOMAIN_KEYWORDS: Record<string, string> = {
    'service': 'Service Layer',
    'services': 'Service Layer',
    'controller': 'Controller Layer',
    'controllers': 'Controller Layer',
    'route': 'Routing',
    'routes': 'Routing',
    'router': 'Routing',
    'middleware': 'Middleware',
    'model': 'Data Model',
    'models': 'Data Model',
    'schema': 'Data Schema',
    'entity': 'Data Entity',
    'entities': 'Data Entity',
    'repository': 'Data Access Layer',
    'repositories': 'Data Access Layer',
    'dao': 'Data Access Layer',
    'db': 'Database',
    'database': 'Database',
    'migration': 'Database Migration',
    'migrations': 'Database Migration',
    'view': 'UI Layer',
    'views': 'UI Layer',
    'component': 'UI Component',
    'components': 'UI Component',
    'ui': 'UI Layer',
    'presentation': 'UI Layer',
    'util': 'Utilities',
    'utils': 'Utilities',
    'helper': 'Utilities',
    'helpers': 'Utilities',
    'shared': 'Shared Utilities',
    'common': 'Shared Utilities',
    'core': 'Core Logic',
    'config': 'Configuration',
    'configuration': 'Configuration',
    'test': 'Testing',
    'tests': 'Testing',
    'spec': 'Testing',
    'mock': 'Testing',
    'e2e': 'Testing',
    'integration': 'Testing',
    'api': 'API Layer',
    'graphql': 'API Layer',
    'resolver': 'API Layer', // Common in GraphQL
    'type': 'Type Definition', // Lower priority than others
    'types': 'Type Definition',
    'interface': 'Type Definition',
    'interfaces': 'Type Definition',
};

export class DomainAnalyzer {

    /**
     * Infers the domain of an AST node, primarily based on its file path.
     * @param node - The AstNode to analyze.
     * @returns The inferred domain string or "Unknown" if no domain could be determined.
     */
    static inferDomain(node: AstNode): string | undefined {
        if (!node.filePath) {
            return "Unknown"; // Return default instead of undefined
        }

        // Normalize path and split into parts
        const normalizedPath = node.filePath.replace(/\\/g, '/').toLowerCase();
        const pathParts = normalizedPath.split('/').filter(part => part !== ''); // Remove empty parts

        // Iterate backwards through path parts to find keywords
        for (let i = pathParts.length - 1; i >= 0; i--) {
            const part = pathParts[i];
            if (!part) continue; // Skip if part is undefined or empty

            // Check directory names first
            if (DOMAIN_KEYWORDS[part]) {
                return DOMAIN_KEYWORDS[part];
            }
            // Check parts of filenames (e.g., user.service.ts)
            const fileParts = part.split('.');
            if (!fileParts || fileParts.length < 1) continue; // Skip if split fails or no parts

            // Check second-to-last part (e.g., 'service' in user.service.ts)
            const secondLastPart = fileParts[fileParts.length - 2];
            if (fileParts.length > 1 && secondLastPart && DOMAIN_KEYWORDS[secondLastPart]) {
                 return DOMAIN_KEYWORDS[secondLastPart];
            }
             // Check first part (e.g., 'test' in test-user.ts)
             const firstPart = fileParts[0];
             if (firstPart && DOMAIN_KEYWORDS[firstPart]) {
                 return DOMAIN_KEYWORDS[firstPart];
             }
        }

        // Fallback based on top-level directory if specific keywords aren't found
        const firstPathPart = pathParts[0];
        if (firstPathPart && DOMAIN_KEYWORDS[firstPathPart]) {
 // Add closing bracket
             return DOMAIN_KEYWORDS[firstPathPart]; // Add closing bracket
        }


        // Could add more heuristics based on node.kind or node.name if needed
        // logger.debug(`Could not infer domain for node: ${node.name} in ${node.filePath}`);
        return "Unknown"; // Return default instead of undefined
    }

     /**
      * Analyzes a list of nodes and adds the 'domain' property.
      */
     static analyzeNodes(nodes: AstNode[]): AstNode[] {
         logger.info(`Running domain analysis on ${nodes.length} nodes...`);
         return nodes.map(node => ({
             ...node,
             domain: this.inferDomain(node),
         }));
     }
}

export default DomainAnalyzer;