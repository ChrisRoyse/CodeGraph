import { pipeline, type Pipeline } from '@xenova/transformers';
// Import IncludeEnum
import { ChromaClient, type Collection, IncludeEnum } from 'chromadb-client';
import { createContextLogger } from '../utils/logger';
import config from '../config'; // Assuming config might have vector DB settings later

const logger = createContextLogger('VectorService');

// Define and EXPORT the type for the documents we'll index
export interface VectorDocument { // Added export
    id: string; // Unique ID (e.g., node entityId or file path + line range)
    text: string; // The code/comment text to embed
    metadata: Record<string, any>; // Store filePath, startLine, endLine, kind, name etc.
}

// Export the class itself
export class VectorService {
    private embedder: any | null = null; // Use 'any' for now to bypass complex pipeline type issues
    private client: ChromaClient | null = null;
    private collection: Collection | null = null;
    private collectionName: string = 'codebase_embeddings'; // Default collection name
    private modelName: string = 'Xenova/paraphrase-MiniLM-L3-v2'; // Default embedding model
    // private chromaPath: string = 'http://localhost:8001'; // No longer needed for in-memory

    constructor() {
        // Initialize client for in-memory operation (no path specified)
        this.client = new ChromaClient();
        logger.info(`VectorService initialized for in-memory ChromaDB.`);
    }

    private async initializeEmbedder(): Promise<void> {
        if (!this.embedder) {
            try {
                logger.info(`Initializing embedding model: ${this.modelName}...`);
                // Use feature-extraction pipeline for embeddings
                this.embedder = await pipeline('feature-extraction', this.modelName);
                logger.info('Embedding model initialized successfully.');
            } catch (error) {
                logger.error('Failed to initialize embedding model:', error);
                throw error; // Rethrow to prevent service usage without embedder
            }
        }
    }

    private async initializeCollection(): Promise<void> {
        if (!this.collection && this.client) {
            try {
                logger.info(`Getting or creating ChromaDB collection: ${this.collectionName}...`);
                // Pass collection name within an object
                this.collection = await this.client.getOrCreateCollection({ name: this.collectionName });
                logger.info(`Collection "${this.collectionName}" ready.`);
            } catch (error) {
                logger.error('Failed to get or create ChromaDB collection:', error);
                throw error; // Rethrow to prevent service usage without collection
            }
        }
    }

    // Renamed from ensureReady
    async ensureEmbedderReady(): Promise<void> {
        await this.initializeEmbedder();
        if (!this.embedder) {
            throw new Error('VectorService embedder could not be initialized.');
        }
    }

    async generateEmbedding(text: string): Promise<number[] | null> {
        if (!this.embedder) {
            logger.warn('Embedder not initialized. Call ensureEmbedderReady() first.');
            // Attempt to initialize now, although ideally it's done upfront
            try {
                await this.ensureEmbedderReady();
                if (!this.embedder) return null; // Still failed
            } catch {
                return null; // Initialization failed
            }
        }
        try {
            const output = await this.embedder(text, { pooling: 'mean', normalize: true });
            if (output && output.data) {
                 return Array.from(output.data);
            }
            logger.warn('Embedding generation produced unexpected output structure.');
            return null;
        } catch (error) {
            logger.error('Error generating embedding:', error);
            return null;
        }
    }

    // Removed indexDocuments, search, resetCollection methods related to ChromaDB
}

// Keep exporting a default instance for other parts of the app if needed
export default new VectorService();