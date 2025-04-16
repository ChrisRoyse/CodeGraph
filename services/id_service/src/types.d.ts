/**
 * Type declarations for external modules without type definitions
 */

declare module '@grpc/grpc-js' {
  export interface ServerUnaryCall<RequestType, ResponseType> {
    request: RequestType;
    metadata: any;
    getPeer(): string;
  }

  export interface GrpcError extends Error {
    code: number;
    message: string;
    details?: string;
  }

  export interface sendUnaryData<ResponseType> {
    (error: GrpcError | null, value?: ResponseType): void;
  }

  export interface ServerWritableStream<RequestType, ResponseType> {
    request: RequestType;
    metadata: any;
    getPeer(): string;
    write(message: ResponseType): boolean;
    end(): void;
  }

  export interface ServerReadableStream<RequestType, ResponseType> {
    metadata: any;
    getPeer(): string;
    read(): RequestType | null;
    on(event: string, listener: Function): void;
  }

  export interface ServerDuplexStream<RequestType, ResponseType> {
    metadata: any;
    getPeer(): string;
    write(message: ResponseType): boolean;
    end(): void;
    on(event: string, listener: Function): void;
  }

  export class Server {
    addService(service: any, implementation: any): void;
    bindAsync(port: string, credentials: any, callback: (error: Error | null, port: number) => void): void;
    start(): void;
    tryShutdown(callback: () => void): void;
  }

  export class ServerCredentials {
    static createInsecure(): any;
  }

  export function loadPackageDefinition(packageDefinition: any): any;

  export const status: {
    OK: number;
    CANCELLED: number;
    UNKNOWN: number;
    INVALID_ARGUMENT: number;
    DEADLINE_EXCEEDED: number;
    NOT_FOUND: number;
    ALREADY_EXISTS: number;
    PERMISSION_DENIED: number;
    RESOURCE_EXHAUSTED: number;
    FAILED_PRECONDITION: number;
    ABORTED: number;
    OUT_OF_RANGE: number;
    UNIMPLEMENTED: number;
    INTERNAL: number;
    UNAVAILABLE: number;
    DATA_LOSS: number;
    UNAUTHENTICATED: number;
  };
}

declare module '@grpc/proto-loader' {
  export interface Options {
    keepCase?: boolean;
    longs?: string | number | StringConstructor;
    enums?: string | number | StringConstructor;
    defaults?: boolean;
    oneofs?: boolean;
  }

  export function loadSync(filename: string, options?: Options): any;
}