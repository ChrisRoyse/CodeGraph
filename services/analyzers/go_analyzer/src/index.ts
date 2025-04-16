/**
 * Go Analyzer Service
 *
 * This service analyzes Go source code files and extracts code structure information.
 * It handles both analysis and deletion operations for Go files.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as amqplib from 'amqplib';
import * as dotenv from 'dotenv';
import { IdServiceClient } from './id-service-client';
import { analyzeGoFile } from './ast-visitor';
import { formatAnalysisResults } from './ast-visitor-utils';
import { AnalyzerResultPayload } from './models';

// Load environment variables
dotenv.config();

// Configure logging
const logger = {
  info: (message: string) => console.log(`[INFO] ${message}`),
  error: (message: string) => console.error(`[ERROR] ${message}`),
  debug: (message: string) => console.debug(`[DEBUG] ${message}`)
};

// Environment variables
const RABBITMQ_HOST = process.env.RABBITMQ_HOST || 'rabbitmq';
const RABBITMQ_PORT = process.env.RABBITMQ_PORT || '5672';
const RABBITMQ_USER = process.env.RABBITMQ_USER || 'guest';
const RABBITMQ_PASSWORD = process.env.RABBITMQ_PASSWORD || 'guest';
const RABBITMQ_JOBS_QUEUE = process.env.RABBITMQ_JOBS_QUEUE || 'bmcp.jobs.analysis';
const RABBITMQ_RESULTS_QUEUE = process.env.RABBITMQ_RESULTS_QUEUE || 'bmcp.results.analysis';
const ID_SERVICE_HOST = process.env.ID_SERVICE_HOST || 'id_service';
const ID_SERVICE_PORT = process.env.ID_SERVICE_PORT || '50051';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// RabbitMQ connection URL
const RABBITMQ_URL = `amqp://${RABBITMQ_USER}:${RABBITMQ_PASSWORD}@${RABBITMQ_HOST}:${RABBITMQ_PORT}`;

// ID Service client
let idServiceClient: IdServiceClient;

/**
 * Main function
 */
async function main() {
  try {
    logger.info('Starting Go Analyzer Service');

    // Initialize ID Service client
    idServiceClient = new IdServiceClient(ID_SERVICE_HOST, ID_SERVICE_PORT);
    logger.info(`Connected to ID Service at ${ID_SERVICE_HOST}:${ID_SERVICE_PORT}`);

    // Connect to RabbitMQ
    const connection = await amqplib.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();
    
    // Ensure queues exist
    await channel.assertQueue(RABBITMQ_JOBS_QUEUE, { durable: true });
    await channel.assertQueue(RABBITMQ_RESULTS_QUEUE, { durable: true });
    
    logger.info(`Connected to RabbitMQ at ${RABBITMQ_HOST}:${RABBITMQ_PORT}`);
    logger.info(`Listening for jobs on queue: ${RABBITMQ_JOBS_QUEUE}`);
    logger.info(`Publishing results to queue: ${RABBITMQ_RESULTS_QUEUE}`);

    // Set up consumer
    await channel.consume(RABBITMQ_JOBS_QUEUE, async (msg) => {
      if (!msg) return;
      
      try {
        // Parse message
        const jobPayload = JSON.parse(msg.content.toString());
        const { file_path, event_type, language } = jobPayload;
        
        logger.info(`Received job for file: ${file_path}, event: ${event_type || 'analyze'}`);
        
        // Check if this is a Go file
        if (language !== 'go' && !file_path.endsWith('.go')) {
          logger.info(`Skipping non-Go file: ${file_path}`);
          channel.ack(msg);
          return;
        }
        
        let result: AnalyzerResultPayload;
        
        // Handle different event types
        if (event_type === 'DELETED') {
          // Handle file deletion
          result = await handleDeleteFile(file_path);
        } else {
          // Handle file analysis (default)
          result = await analyzeFile(file_path);
        }
        
        // Publish result
        await channel.sendToQueue(
          RABBITMQ_RESULTS_QUEUE,
          Buffer.from(JSON.stringify(result)),
          { persistent: true }
        );
        
        logger.info(`Published results for file: ${file_path}`);
        
        // Acknowledge message
        channel.ack(msg);
      } catch (error) {
        logger.error(`Error processing message: ${error}`);
        
        // Negative acknowledge message
        channel.nack(msg, false, false);
      }
    });

    // Handle shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down Go Analyzer Service');
      
      // Close RabbitMQ connection
      await channel.close();
      await connection.close();
      
      // Close ID Service client
      idServiceClient.close();
      
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      logger.info('Shutting down Go Analyzer Service');
      
      // Close RabbitMQ connection
      await channel.close();
      await connection.close();
      
      // Close ID Service client
      idServiceClient.close();
      
      process.exit(0);
    });
  } catch (error) {
    logger.error(`Error starting Go Analyzer Service: ${error}`);
    process.exit(1);
  }
}

/**
 * Analyze a Go file
 *
 * @param filePath Path to the file to analyze
 * @returns Analysis result payload
 */
async function analyzeFile(filePath: string): Promise<AnalyzerResultPayload> {
  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      logger.error(`File not found: ${filePath}`);
      return {
        file_path: filePath,
        language: 'go',
        error: 'File not found',
        nodes_upserted: [],
        relationships_upserted: [],
        nodes_deleted: [],
        relationships_deleted: []
      };
    }
    
    logger.info(`Analyzing Go file: ${filePath}`);
    
    // Analyze the file
    const [nodes, relationships] = await analyzeGoFile(filePath, idServiceClient);
    
    // Format the results
    const result = formatAnalysisResults(filePath, nodes, relationships);
    
    logger.info(`Analysis completed for file: ${filePath}`);
    logger.info(`Found ${nodes.length} nodes and ${relationships.length} relationships`);
    
    return result;
  } catch (error) {
    logger.error(`Error analyzing file ${filePath}: ${error}`);
    
    return {
      file_path: filePath,
      language: 'go',
      error: `Error analyzing file: ${error}`,
      nodes_upserted: [],
      relationships_upserted: [],
      nodes_deleted: [],
      relationships_deleted: []
    };
  }
}

/**
 * Handle file deletion
 *
 * @param filePath Path to the deleted file
 * @returns Deletion result payload
 */
async function handleDeleteFile(filePath: string): Promise<AnalyzerResultPayload> {
  try {
    logger.info(`Processing deletion for file: ${filePath}`);
    
    // Create a deletion payload
    const payload: AnalyzerResultPayload = {
      file_path: filePath,
      language: 'go',
      nodes_upserted: [],
      relationships_upserted: [],
      nodes_deleted: [filePath],
      relationships_deleted: []
    };
    
    logger.info(`Deletion processed for file: ${filePath}`);
    
    return payload;
  } catch (error) {
    logger.error(`Error processing deletion for file ${filePath}: ${error}`);
    
    return {
      file_path: filePath,
      language: 'go',
      error: `Error processing deletion: ${error}`,
      nodes_upserted: [],
      relationships_upserted: [],
      nodes_deleted: [],
      relationships_deleted: []
    };
  }
}

// Start the service
main().catch(error => {
  logger.error(`Unhandled error: ${error}`);
  process.exit(1);
});