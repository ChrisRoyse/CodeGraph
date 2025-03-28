import neo4j, { Driver, Session, Record as Neo4jRecord, Neo4jError, ManagedTransaction } from 'neo4j-driver'; // Import ManagedTransaction
import config from '../config';
import { createContextLogger } from '../utils/logger';
import { DatabaseError } from '../utils/errors'; // This import should work now

const logger = createContextLogger('Neo4jClient');

class Neo4jClient {
  private driver: Driver | null = null;

  constructor() {
    this.initializeDriver();
  }

  private initializeDriver(): void {
    try {
      logger.info('Creating Neo4j driver instance (Analyzer)');
      this.driver = neo4j.driver(
        config.neo4j.uri,
        neo4j.auth.basic(config.neo4j.username, config.neo4j.password),
        {
          // maxConnectionPoolSize: config.neo4j.connectionPoolSize, // Temporarily disable pooling for testing
          connectionAcquisitionTimeout: 60000, // 1 minute
          logging: { // Add driver logging
              level: 'debug', // Or 'info'
              logger: (level, message) => logger.debug(`[Neo4jDriver-${level}] ${message}`)
          }
        }
      );

      this.driver.verifyConnectivity({ database: config.neo4j.database })
        .then(() => {
          logger.info(`(Analyzer) Successfully connected to Neo4j database: ${config.neo4j.database || 'default'}`);
        })
        .catch((error: Neo4jError) => {
          logger.error('(Analyzer) Failed to verify Neo4j connectivity', {
            error: error.message,
            code: error.code,
            uri: config.neo4j.uri
          });
          // Consider exiting or implementing retry logic if connection is critical at startup
        });

    } catch (error) {
      logger.error('(Analyzer) Failed to create Neo4j driver', { error });
      throw new DatabaseError('Failed to create Neo4j driver', { originalError: error instanceof Error ? error.message : String(error) });
    }
  }

  private getDriver(): Driver {
    if (!this.driver) {
      logger.warn('(Analyzer) Neo4j driver not initialized. Attempting re-initialization.');
      this.initializeDriver();
      if (!this.driver) {
        throw new DatabaseError('Neo4j driver is not available after re-initialization attempt.');
      }
    }
    return this.driver;
  }

  // Expose config for schema manager access
  public get config() {
      return config;
  }

  public getSession(accessMode: 'READ' | 'WRITE'): Session { // Make public for schema manager
    const driver = this.getDriver();
    return driver.session({
      database: config.neo4j.database,
      defaultAccessMode: accessMode === 'READ' ? neo4j.session.READ : neo4j.session.WRITE,
    });
  }

  async close(): Promise<void> {
    if (this.driver) {
      logger.info('(Analyzer) Closing Neo4j driver');
      await this.driver.close();
      this.driver = null;
      logger.info('(Analyzer) Neo4j driver closed');
    }
  }

  async runTransaction<T>(
    accessMode: 'READ' | 'WRITE',
    work: (tx: ManagedTransaction) => Promise<T> // Correct parameter type for the work function
  ): Promise<T> {
    let session: Session | null = null;
    try {
      session = this.getSession(accessMode);
      const transactionFunction = accessMode === 'READ' ? session.executeRead.bind(session) : session.executeWrite.bind(session);

      // Define the type for the transaction work function expected by the driver
      type ManagedTransactionWork<T> = (tx: ManagedTransaction) => Promise<T> | T;

      // Correctly type the transaction function and execute
      const result = await transactionFunction<T>(
        async (tx: ManagedTransaction) => { // Use ManagedTransaction here
          try {
            return await work(tx);
          } catch (error) {
            logger.error(`(Analyzer) Error during Neo4j transaction work function`, { error });
            // Ensure the original error is thrown to trigger rollback
            throw error;
          }
        }
      );
      return result;
    } catch (error) {
      const neo4jError = error as Neo4jError;
      logger.error(`(Analyzer) Neo4j transaction failed`, {
          error: neo4jError.message,
          code: neo4jError.code,
          query: (neo4jError as any).query, // Include query if available
          parameters: (neo4jError as any).parameters // Include parameters if available
      });
      throw new DatabaseError(`Neo4j transaction failed: ${neo4jError.message}`, {
          originalError: neo4jError.message,
          code: neo4jError.code
      });
    } finally {
      if (session) {
        await session.close();
      }
    }
  }

  async read<T = Neo4jRecord>(cypher: string, params?: Record<string, any>): Promise<T[]> {
    return this.runTransaction('READ', async (tx) => {
      const result = await tx.run(cypher, params);
      return result.records as unknown as T[]; // Cast needed as Record type is specific
    });
  }

  async write<T = Neo4jRecord>(cypher: string, params?: Record<string, any>): Promise<T[]> {
    return this.runTransaction('WRITE', async (tx) => {
      const result = await tx.run(cypher, params);
      return result.records as unknown as T[]; // Cast needed
    });
  }
}

// Export singleton instance
const neo4jClient = new Neo4jClient();
export default neo4jClient;