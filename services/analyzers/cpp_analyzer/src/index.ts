/**
 * C++ Analyzer Service
 * 
 * This service analyzes C++ source code files and extracts code structure
 * information for the CodeGraph system.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import * as amqplib from 'amqplib';
import { IdServiceClient } from './id-service-client';
import { analyzeCppFile } from './ast-visitor';
import { formatAnalysisResults } from './ast-visitor-utils';
import { batchInsertNodes, batchInsertRelationships } from './pg_writer';

// Load environment variables
dotenv.config();

// Configure logging
const logger = {
  info: (message: string) => console.log(`[INFO] ${message}`),
  error: (message: string) => console.error(`[ERROR] ${message}`),
  debug: (message: string) => console.debug(`[DEBUG] ${message}`)
};

// RabbitMQ configuration
const RABBITMQ_HOST = process.env.RABBITMQ_HOST || 'rabbitmq';
const RABBITMQ_PORT = process.env.RABBITMQ_PORT || '5672';
const RABBITMQ_USER = process.env.RABBITMQ_USER || 'guest';
const RABBITMQ_PASSWORD = process.env.RABBITMQ_PASSWORD || 'guest';
const RABBITMQ_JOBS_QUEUE = process.env.RABBITMQ_JOBS_QUEUE || 'bmcp.jobs.analysis';
const RABBITMQ_RESULTS_QUEUE = process.env.RABBITMQ_RESULTS_QUEUE || 'bmcp.results.analysis';

// ID Service configuration
const ID_SERVICE_HOST = process.env.ID_SERVICE_HOST || 'id_service';
const ID_SERVICE_PORT = process.env.ID_SERVICE_PORT || '50051';

// Initialize ID Service client
const idServiceClient = new IdServiceClient(ID_SERVICE_HOST, ID_SERVICE_PORT);

/**
 * Main function to start the C++ Analyzer service
 */
async function main() {
  try {
    logger.info('Starting C++ Analyzer service');

    // Connect to RabbitMQ
    const rabbitmqUrl = `amqp://${RABBITMQ_USER}:${RABBITMQ_PASSWORD}@${RABBITMQ_HOST}:${RABBITMQ_PORT}`;
    const connection = await amqplib.connect(rabbitmqUrl);
    const channel = await connection.createChannel();

    // Ensure queues exist
    await channel.assertQueue(RABBITMQ_JOBS_QUEUE, { durable: true });
    await channel.assertQueue(RABBITMQ_RESULTS_QUEUE, { durable: true });

    logger.info(`Connected to RabbitMQ at ${RABBITMQ_HOST}:${RABBITMQ_PORT}`);
    logger.info(`Consuming from queue: ${RABBITMQ_JOBS_QUEUE}`);
    logger.info(`Publishing to queue: ${RABBITMQ_RESULTS_QUEUE}`);

    // Consume messages from the jobs queue
    await channel.consume(RABBITMQ_JOBS_QUEUE, async (msg) => {
      if (!msg) return;

      try {
        // Parse the message
        const content = JSON.parse(msg.content.toString());
        const { file_path, action } = content;

        logger.info(`Received job: ${action} for file ${file_path}`);

        // Check if the file is a C++ file
        if (!file_path.match(/\.(cpp|hpp|cc|cxx|h|hh|hxx)$/)) {
          logger.info(`Skipping non-C++ file: ${file_path}`);
          channel.ack(msg);
          return;
        }

        // Handle different actions
        if (action === 'analyze') {
          await handleAnalyzeAction(channel, file_path);
        } else if (action === 'delete') {
          await handleDeleteAction(channel, file_path);
        } else {
          logger.error(`Unknown action: ${action}`);
        }

        // Acknowledge the message
        channel.ack(msg);
      } catch (error) {
        logger.error(`Error processing message: ${error}`);
        channel.nack(msg, false, false);
      }
    });

    logger.info('C++ Analyzer service is running');
  } catch (error) {
    logger.error(`Error starting C++ Analyzer service: ${error}`);
    process.exit(1);
  }
}

/**
 * Handle the 'analyze' action
 * 
 * @param channel RabbitMQ channel
 * @param filePath Path to the file to analyze
 */
async function handleAnalyzeAction(channel: amqplib.Channel, filePath: string): Promise<void> {
  try {
    // Check if the file exists
    if (!fs.existsSync(filePath)) {
      logger.error(`File not found: ${filePath}`);
      return;
    }

    logger.info(`Analyzing C++ file: ${filePath}`);

    // Analyze the file
    const [nodes, relationships] = await analyzeCppFile(filePath, idServiceClient);

    // Format the results
    const payload = formatAnalysisResults(filePath, nodes, relationships, 'cpp');

    // Publish the results
    await channel.publish(
      '',
      RABBITMQ_RESULTS_QUEUE,
      Buffer.from(JSON.stringify(payload)),
      { persistent: true }
    );

    logger.info(`Analysis completed for file: ${filePath}`);
    logger.info(`Found ${nodes.length} nodes and ${relationships.length} relationships`);
  } catch (error) {
    logger.error(`Error analyzing file ${filePath}: ${error}`);

    // Publish an error result
    const errorPayload = {
      file_path: filePath,
      language: 'cpp',
      error: `Error analyzing file: ${error}`,
      nodes_upserted: [],
      relationships_upserted: [],
      nodes_deleted: [],
      relationships_deleted: []
    };

    await channel.publish(
      '',
      RABBITMQ_RESULTS_QUEUE,
      Buffer.from(JSON.stringify(errorPayload)),
      { persistent: true }
    );
  }
}

/**
 * Handle the 'delete' action
 * 
 * @param channel RabbitMQ channel
 * @param filePath Path to the deleted file
 */
async function handleDeleteAction(channel: amqplib.Channel, filePath: string): Promise<void> {
  try {
    logger.info(`Processing deletion for file: ${filePath}`);

    // Create a deletion payload
    const payload = {
      file_path: filePath,
      language: 'cpp',
      nodes_upserted: [],
      relationships_upserted: [],
      nodes_deleted: [filePath],
      relationships_deleted: []
    };

    // Publish the deletion payload
    await channel.publish(
      '',
      RABBITMQ_RESULTS_QUEUE,
      Buffer.from(JSON.stringify(payload)),
      { persistent: true }
    );

    logger.info(`Deletion processed for file: ${filePath}`);
  } catch (error) {
    logger.error(`Error processing deletion for file ${filePath}: ${error}`);
  }
}

// Start the service
main().catch(error => {
  logger.error(`Unhandled error: ${error}`);
  process.exit(1);
});

// Handle process termination
process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down');
  process.exit(0);
});