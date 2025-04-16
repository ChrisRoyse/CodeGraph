/**
 * Type declarations for external modules
 */

// Node.js built-in modules
declare module 'fs' {
  export function readFileSync(path: string, options: { encoding: string; flag?: string; } | string): string;
  export function readFileSync(path: string, options?: { encoding?: null; flag?: string; } | null): Buffer;
  export function writeFileSync(path: string, data: string | Buffer, options?: { encoding?: string | null; mode?: number | string; flag?: string; } | string | null): void;
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean; mode?: number | string; } | number | string): void;
  export function readdirSync(path: string, options?: { encoding?: string | null; withFileTypes?: boolean; } | string | null): string[];
  export function statSync(path: string): {
    isFile(): boolean;
    isDirectory(): boolean;
    size: number;
    mtime: Date;
  };
}

declare module 'path' {
  export function join(...paths: string[]): string;
  export function resolve(...paths: string[]): string;
  export function basename(path: string, ext?: string): string;
  export function dirname(path: string): string;
  export function extname(path: string): string;
  export function relative(from: string, to: string): string;
  export function normalize(path: string): string;
  export function isAbsolute(path: string): boolean;
  export const sep: string;
  export const delimiter: string;
}

// Third-party modules
declare module 'dotenv' {
  export function config(options?: { path?: string; encoding?: string; debug?: boolean; override?: boolean; }): { parsed: { [key: string]: string } };
}

declare module 'amqplib' {
  export interface Connection {
    createChannel(): Promise<Channel>;
    close(): Promise<void>;
  }

  export interface Channel {
    assertQueue(queue: string, options?: any): Promise<{ queue: string; messageCount: number; consumerCount: number }>;
    sendToQueue(queue: string, content: Buffer, options?: any): boolean;
    consume(queue: string, onMessage: (msg: ConsumeMessage | null) => void, options?: any): Promise<{ consumerTag: string }>;
    ack(message: ConsumeMessage, allUpTo?: boolean): void;
    nack(message: ConsumeMessage, allUpTo?: boolean, requeue?: boolean): void;
    prefetch(count: number, global?: boolean): Promise<void>;
    publish(exchange: string, routingKey: string, content: Buffer, options?: any): boolean;
    close(): Promise<void>;
    connection: Connection;
  }

  export interface ConsumeMessage {
    content: Buffer;
    fields: any;
    properties: any;
  }

  export function connect(url: string): Promise<Connection>;
}

// Node.js global objects
declare const process: {
  env: { [key: string]: string | undefined };
  exit(code?: number): never;
  on(event: string, listener: (...args: any[]) => void): void;
  cwd(): string;
};

declare const Buffer: {
  from(data: string, encoding?: string): Buffer;
  from(data: ArrayBuffer | SharedArrayBuffer): Buffer;
  from(data: ArrayBufferView): Buffer;
  from(data: Array<number>): Buffer;
  isBuffer(obj: any): boolean;
  alloc(size: number, fill?: string | Buffer | number, encoding?: string): Buffer;
};

interface Buffer extends Uint8Array {
  toString(encoding?: string, start?: number, end?: number): string;
}

// Node.js built-in modules
declare module 'fs' {
  export function readFileSync(path: string, options: { encoding: string; flag?: string; } | string): string;
  export function readFileSync(path: string, options?: { encoding?: null; flag?: string; } | null): Buffer;
  export function writeFileSync(path: string, data: string | Buffer, options?: { encoding?: string | null; mode?: number | string; flag?: string; } | string | null): void;
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean; mode?: number | string; } | number | string): void;
  export function readdirSync(path: string, options?: { encoding?: string | null; withFileTypes?: boolean; } | string | null): string[];
  export function statSync(path: string): {
    isFile(): boolean;
    isDirectory(): boolean;
    size: number;
    mtime: Date;
  };
}

declare module 'path' {
  export function join(...paths: string[]): string;
  export function resolve(...paths: string[]): string;
  export function basename(path: string, ext?: string): string;
  export function dirname(path: string): string;
  export function extname(path: string): string;
  export function relative(from: string, to: string): string;
  export function normalize(path: string): string;
  export function isAbsolute(path: string): boolean;
  export const sep: string;
  export const delimiter: string;
}

declare module 'tree-sitter' {
  export default class Parser {
    setLanguage(language: any): void;
    parse(input: string): Tree;
    getLanguage(): Language;
  
    static SyntaxNode: SyntaxNodeConstructor;
  }
  
  export interface Tree {
    rootNode: SyntaxNode;
  }
  
  export interface Language {
    query(query: string): Query;
  }
  
  export interface Query {
    matches(node: SyntaxNode): QueryMatch[];
  }
  
  export interface QueryMatch {
    pattern: number;
    captures: QueryCapture[];
  }
  
  export interface QueryCapture {
    name: string;
    node: SyntaxNode;
  }
  
  export interface SyntaxNodeConstructor {
    new(): SyntaxNode;
  }
  
  export interface SyntaxNode {
    type: string;
    text: string;
    startPosition: { row: number; column: number };
    endPosition: { row: number; column: number };
    children: SyntaxNode[];
    childIndex: number;
    parent: SyntaxNode | null;
    namedChildCount: number;
    namedChildren: SyntaxNode[];
    firstNamedChild: SyntaxNode | null;
    lastNamedChild: SyntaxNode | null;
    nextNamedSibling: SyntaxNode | null;
    previousNamedSibling: SyntaxNode | null;
  }
  
  export interface Channel {
    close(): void;
  }
}

declare module 'tree-sitter-html' {
  const language: any;
  export default language;
}

declare module 'tree-sitter-css' {
  const language: any;
  export default language;
}