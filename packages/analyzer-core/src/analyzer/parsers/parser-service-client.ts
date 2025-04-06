import { fork, ChildProcess } from 'child_process';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger.js'; // Added .js extension

// Define the structure of the request sent to the parser service
export interface ParserRequestData {
  id: string;
  language: string;
  filePath?: string;
  fileContent?: string;
  outputFormat?: 'ast' | 'ir-snippet'; // Specify desired output
}

// Define the structure of the response received from the parser service
export interface ParserResponseData {
  id: string;
  success: boolean;
  payload?: any; // Can be AST, IR snippet, etc.
  error?: string; // Error message if success is false
}

// Type for the map storing pending requests
type PendingRequests = Map<string, { resolve: (value: any) => void; reject: (reason?: any) => void }>;

/**
 * Manages communication with the parser-service child process.
 */
export class ParserServiceClient {
  private child: ChildProcess | null = null;
  private pendingRequests: PendingRequests = new Map();
  private serviceScriptPath: string;
  private isExiting = false;

  constructor() {
    // Resolve the path to the parser service script relative to the project root
    // Assumes the service has been built into the 'dist' directory
    this.serviceScriptPath = path.resolve(
      process.cwd(), // Assumes cwd is the project root 'c:/code/bmcp'
      'packages/parser-service/dist/index.js'
    );
    this.spawnChildProcess();
  }

  /**
   * Spawns the parser-service child process and sets up listeners.
   */
  private spawnChildProcess(): void {
    if (this.isExiting || this.child) {
        logger.warn('Parser service child process already running or client is exiting.');
        return;
    }

    logger.info(`Spawning parser service from: ${this.serviceScriptPath}`);
    try {
      this.child = fork(this.serviceScriptPath, [], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'], // Enable IPC
        // execArgv: ['--inspect-brk=9230'] // Uncomment for debugging the child process
      });

      this.child.on('message', (message: ParserResponseData) => {
        this.handleMessage(message);
      });

      this.child.on('error', (error: Error) => { // Added Error type
        this.handleError(error);
      });

      this.child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => { // Added types
        this.handleExit(code, signal);
      });

      // Optional: Log stdout/stderr for debugging
      this.child.stdout?.on('data', (data: Buffer | string) => { // Added type
        logger.debug(`ParserService stdout: ${data.toString().trim()}`);
      });
      this.child.stderr?.on('data', (data: Buffer | string) => { // Added type
        logger.error(`ParserService stderr: ${data.toString().trim()}`);
      });

      logger.info(`Parser service child process spawned successfully (PID: ${this.child.pid}).`);

    } catch (error: any) {
        logger.error(`Failed to spawn parser service child process: ${error.message}`, { error });
        this.child = null;
        // Reject all pending requests if spawning fails immediately
        this.rejectAllPendingRequests(new Error('Failed to spawn parser service.'));
    }
  }

  /**
   * Handles incoming messages from the child process.
   * @param message The response data from the parser service.
   */
  private handleMessage(message: ParserResponseData): void {
    const { id, success, payload, error } = message;
    const pending = this.pendingRequests.get(id);

    if (pending) {
      if (success) {
        logger.debug(`Received successful response for request ${id}`);
        pending.resolve(payload);
      } else {
        logger.error(`Received error response for request ${id}: ${error}`);
        pending.reject(new Error(error || 'Parser service returned an unspecified error.'));
      }
      this.pendingRequests.delete(id);
    } else {
      logger.warn(`Received message for unknown request ID: ${id}`);
    }
  }

  /**
   * Handles errors from the child process.
   * @param error The error object.
   */
  private handleError(error: Error): void {
    logger.error(`Parser service child process error: ${error.message}`, { error });
    this.rejectAllPendingRequests(error);
    this.child = null; // Mark child as dead
    // Optionally attempt to respawn after a delay, or require manual restart
    if (!this.isExiting) {
        logger.info('Attempting to respawn parser service after error...');
        setTimeout(() => this.spawnChildProcess(), 5000); // Respawn after 5s
    }
  }

  /**
   * Handles the exit event of the child process.
   * @param code The exit code.
   * @param signal The signal causing the exit.
   */
  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    logger.warn(`Parser service child process exited with ${reason}.`);
    this.rejectAllPendingRequests(new Error(`Parser service exited unexpectedly (${reason}).`));
    this.child = null; // Mark child as dead
    // Optionally attempt to respawn if exit was unexpected
    if (!this.isExiting && code !== 0 && signal !== 'SIGTERM') {
        logger.info('Attempting to respawn parser service after unexpected exit...');
        setTimeout(() => this.spawnChildProcess(), 5000); // Respawn after 5s
    }
  }

  /**
   * Rejects all pending promises, typically when the child process dies.
   * @param reason The error reason for rejection.
   */
  private rejectAllPendingRequests(reason: Error): void {
    logger.warn(`Rejecting all ${this.pendingRequests.size} pending parser requests due to: ${reason.message}`);
    this.pendingRequests.forEach((pending) => {
      pending.reject(reason);
    });
    this.pendingRequests.clear();
  }

  /**
   * Sends a parsing request to the parser service.
   * @param requestData Data for the parsing request, excluding the ID.
   * @returns A Promise that resolves with the parsing result or rejects on error.
   */
  public requestParsing(
    requestData: Omit<ParserRequestData, 'id'>
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.child || !this.child.connected) {
        logger.error('Parser service child process is not running or not connected.');
        return reject(new Error('Parser service is not available.'));
      }

      const id = uuidv4();
      const fullRequest: ParserRequestData = { ...requestData, id };

      this.pendingRequests.set(id, { resolve, reject });

      try {
        this.child.send(fullRequest, (error: Error | null) => { // Added Error | null type
            if (error) {
                logger.error(`Failed to send message to parser service for request ${id}: ${error.message}`, { error });
                this.pendingRequests.delete(id);
                // Check if the error indicates disconnection
                if (error.message.includes('Channel closed')) {
                    this.handleError(new Error('IPC channel closed unexpectedly.'));
                }
                reject(new Error(`Failed to send request to parser service: ${error.message}`));
            } else {
                logger.debug(`Sent request ${id} to parser service.`);
            }
        });
      } catch (error: any) {
          logger.error(`Error sending message to parser service for request ${id}: ${error.message}`, { error });
          this.pendingRequests.delete(id);
          reject(new Error(`Failed to send request: ${error.message}`));
      }

      // Optional: Add a timeout for requests
      const timeout = setTimeout(() => {
          if (this.pendingRequests.has(id)) {
              logger.warn(`Parser request ${id} timed out.`);
              this.pendingRequests.get(id)?.reject(new Error(`Parser request ${id} timed out.`));
              this.pendingRequests.delete(id);
          }
      }, 30000); // 30 second timeout

      // Ensure timeout doesn't keep process alive if promise settles
      const pending = this.pendingRequests.get(id);
      if (pending) {
          const originalResolve = pending.resolve;
          const originalReject = pending.reject;
          pending.resolve = (value) => {
              clearTimeout(timeout);
              originalResolve(value);
          };
          pending.reject = (reason) => {
              clearTimeout(timeout);
              originalReject(reason);
          };
      }
    });
  }

  /**
   * Gracefully shuts down the parser service client and child process.
   */
  public destroy(): void {
    logger.info('Destroying ParserServiceClient...');
    this.isExiting = true;
    this.rejectAllPendingRequests(new Error('Parser service client is shutting down.'));
    if (this.child) {
      if (this.child.connected) {
          logger.info(`Sending SIGTERM to parser service child process (PID: ${this.child.pid})...`);
          this.child.kill('SIGTERM'); // Graceful shutdown signal
      } else {
          logger.warn(`Parser service child process (PID: ${this.child.pid}) already disconnected.`);
      }
      // Give it a moment to exit gracefully before force killing
      setTimeout(() => {
          if (this.child && !this.child.killed) {
              logger.warn(`Parser service child process (PID: ${this.child.pid}) did not exit gracefully, sending SIGKILL.`);
              this.child.kill('SIGKILL');
          }
      }, 2000); // 2 second grace period
      this.child = null;
    } else {
        logger.info('No active parser service child process to destroy.');
    }
  }
}

// Optional: Export a singleton instance if desired
// export const parserServiceClient = new ParserServiceClient();

// Ensure graceful shutdown on process exit
// process.on('exit', () => parserServiceClient.destroy());
// process.on('SIGINT', () => process.exit()); // Handle Ctrl+C
// process.on('SIGTERM', () => process.exit()); // Handle kill commands