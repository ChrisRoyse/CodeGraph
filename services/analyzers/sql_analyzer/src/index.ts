/**
 * SQL Analyzer Service for CodeGraph
 * 
 * This service analyzes SQL files and extracts code structure information.
 * It connects to the ID Service to generate canonical IDs and GIDs for SQL entities.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import * as amqplib from 'amqplib';
import { IdServiceClient } from './id-service-client';
import { analyzeSqlFile } from './ast-visitor';
import { AnalysisNodeStub, AnalysisRelationshipStub, AnalyzerResultPayload } from './models';

// Load environment variables
dotenv.config();

// Configure logging
const logger = {
  info: (message: string) => console.log(`[INFO] ${message}`),
  error: (message: string) => console.error(`[ERROR] ${message}`),
  debug: (message: string) => console.debug(`[DEBUG] ${message}`)
};

// Configuration
const RABBITMQ_HOST = process.env.RABBITMQ_HOST || 'rabbitmq';
const RABBITMQ_PORT = parseInt(process.env.RABBITMQ_PORT || '5672');
const RABBITMQ_USER = process.env.RABBITMQ_USER || 'guest';
const RABBITMQ_PASSWORD = process.env.RABBITMQ_PASSWORD || 'guest';
const RABBITMQ_JOBS_QUEUE = process.env.RABBITMQ_JOBS_QUEUE || 'bmcp.jobs.analysis';
const RABBITMQ_RESULTS_QUEUE = process.env.RABBITMQ_RESULTS_QUEUE || 'bmcp.results.analysis';
const ID_SERVICE_HOST = process.env.ID_SERVICE_HOST || 'id_service';
const ID_SERVICE_PORT = process.env.ID_SERVICE_PORT || '50051';

/**
 * Create AnalysisNodeStub objects from node objects
 * 
 * @param nodes List of node objects
 * @returns List of AnalysisNodeStub objects
 */
export function createAnalysisNodeStubs(nodes: any[]): AnalysisNodeStub[] {
  const nodeStubs: AnalysisNodeStub[] = [];
  
  for (const node of nodes) {
    // Create properties dictionary
    const properties: Record<string, any> = {};
    
    // Add properties if present
    if (node.properties) {
      Object.assign(properties, node.properties);
    }
    
    // Create labels list
    const labels = [node.type];
    
    // Create AnalysisNodeStub
    const nodeStub: AnalysisNodeStub = {
      gid: node.gid,
      canonical_id: node.canonical_id,
      name: node.name,
      file_path: node.path,
      language: 'sql',
      labels,
      properties
    };
    
    nodeStubs.push(nodeStub);
  }
  
  return nodeStubs;
}

/**
 * Create AnalysisRelationshipStub objects from relationship objects
 * 
 * @param relationships List of relationship objects
 * @returns List of AnalysisRelationshipStub objects
 */
export function createAnalysisRelationshipStubs(relationships: any[]): AnalysisRelationshipStub[] {
  const relationshipStubs: AnalysisRelationshipStub[] = [];
  
  for (const rel of relationships) {
    // Create AnalysisRelationshipStub
    const relStub: AnalysisRelationshipStub = {
      source_gid: rel.source_gid,
      target_canonical_id: rel.target_canonical_id,
      type: rel.type,
      properties: rel.properties
    };
    
    relationshipStubs.push(relStub);
  }
  
  return relationshipStubs;
}

/**
 * Process a message from the jobs queue
 * 
 * @param channel RabbitMQ channel
 * @param msg RabbitMQ message
 */
async function processMessage(
  channel: amqplib.Channel,
  msg: amqplib.ConsumeMessage
): Promise<void> {
  try {
    // Parse the message
    const message = JSON.parse(msg.content.toString());
    const filePath = message.file_path;
    const eventType = message.event_type;
    
    logger.info(`Received message: ${JSON.stringify(message)}`);
    
    // Skip non-SQL files
    const isSql = filePath.endsWith('.sql');
    
    if (!isSql) {
      logger.info(`Skipping non-SQL file: ${filePath}`);
      channel.ack(msg);
      return;
    }
    
    // Handle file deletion
    if (eventType === 'DELETED') {
      logger.info(`File deleted: ${filePath}`);
      channel.ack(msg);
      return;
    }
    
    // Create ID Service client
    const idServiceClient = new IdServiceClient(ID_SERVICE_HOST, ID_SERVICE_PORT);
    
    try {
      // Analyze the file
      const [nodes, relationships] = await analyzeSqlFile(filePath, idServiceClient);
      
      if (nodes.length === 0) {
        logger.info(`No nodes found in ${filePath}`);
        channel.ack(msg);
        return;
      }
      
      // Create AnalysisNodeStub objects
      const nodeStubs = createAnalysisNodeStubs(nodes);
      
      // Create AnalysisRelationshipStub objects
      const relationshipStubs = createAnalysisRelationshipStubs(relationships);
      
      // Create AnalyzerResultPayload
      const payload: AnalyzerResultPayload = {
        file_path: filePath,
        language: 'sql',
        nodes_upserted: nodeStubs,
        relationships_upserted: relationshipStubs,
        nodes_deleted: [],
        relationships_deleted: []
      };
      
      // Publish the payload to the results queue
      const resultChannel = await channel.connection.createChannel();
      await resultChannel.publish(
        '',  // Default exchange
        RABBITMQ_RESULTS_QUEUE,  // Queue name as routing key
        Buffer.from(JSON.stringify(payload)),
        {
          persistent: true,  // Make message persistent
          contentType: 'application/json'
        }
      );
      await resultChannel.close();
      
      logger.info(`Published analysis results for ${filePath} with ${nodeStubs.length} nodes and ${relationshipStubs.length} relationships`);
    } finally {
      // Close the ID Service client
      idServiceClient.close();
    }
    
    // Acknowledge the message
    channel.ack(msg);
  } catch (error) {
    logger.error(`Error processing message: ${error}`);
    // Negative acknowledgment, requeue the message
    channel.nack(msg, false, true);
  }
}

/**
 * Main entry point for the SQL Analyzer service
 */
async function main(): Promise<number> {
  try {
    // Connect to RabbitMQ
    const connectionString = `amqp://${RABBITMQ_USER}:${RABBITMQ_PASSWORD}@${RABBITMQ_HOST}:${RABBITMQ_PORT}`;
    const connection = await amqplib.connect(connectionString);
    const channel = await connection.createChannel();
    
    // Declare queues
    await channel.assertQueue(RABBITMQ_JOBS_QUEUE, { durable: true });
    await channel.assertQueue(RABBITMQ_RESULTS_QUEUE, { durable: true });
    
    // Set up consumer
    await channel.prefetch(1);
    await channel.consume(
      RABBITMQ_JOBS_QUEUE,
      (msg) => {
        if (msg) {
          processMessage(channel, msg).catch(err => {
            logger.error(`Error in message processing: ${err}`);
            channel.nack(msg, false, true);
          });
        }
      },
      { noAck: false }
    );
    
    logger.info(`SQL Analyzer started, consuming from ${RABBITMQ_JOBS_QUEUE}`);
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down SQL Analyzer...');
      await channel.close();
      await connection.close();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      logger.info('Shutting down SQL Analyzer...');
      await channel.close();
      await connection.close();
      process.exit(0);
    });
    
    return 0;
  } catch (error) {
    logger.error(`Error in main: ${error}`);
    return 1;
  }
}

// Start the service
main().catch(err => {
  logger.error(`Unhandled error: ${err}`);
  process.exit(1);
});