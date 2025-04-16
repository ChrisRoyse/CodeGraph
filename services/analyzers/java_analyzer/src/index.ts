/**
 * Java Analyzer Service
 * 
 * This service analyzes Java source code files and extracts code structure
 * information for the CodeGraph system.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import * as amqplib from 'amqplib';
import { IdServiceClient } from './id-service-client';
import { analyzeJavaFile } from './ast-visitor';
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
 * Main function to start the Java Analyzer service
 */
async function main() {
  try {
    logger.info('Starting Java Analyzer service');

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

        // Check if the file is a Java file
        if (!file_path.endsWith('.java')) {
          logger.info(`Skipping non-Java file: ${file_path}`);
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

    logger.info('Java Analyzer service is running');
  } catch (error) {
    logger.error(`Error starting Java Analyzer service: ${error}`);
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

    logger.info(`Analyzing Java file: ${filePath}`);

    // Analyze the Java file
    const analysisResult = await analyzeJavaFile(filePath, idServiceClient);

    // Persist nodes and relationships to Postgres
    await batchInsertNodes(analysisResult.nodes_upserted);
    await batchInsertRelationships(analysisResult.relationships_upserted);

    // Format the analysis results for the orchestrator
    const formattedResult = formatAnalysisResults(analysisResult);

    // Publish the results to the results queue
    await channel.sendToQueue(RABBITMQ_RESULTS_QUEUE, Buffer.from(JSON.stringify(formattedResult)), {
      persistent: true,
      contentType: 'application/json'
    });

    logger.info(`Published analysis results for ${filePath}`);
    channel.ack(msg!);
  } catch (error) {
    logger.error(`Error analyzing file ${filePath}: ${error}`);
    channel.nack(msg!, false, true);
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
      language: 'java',
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