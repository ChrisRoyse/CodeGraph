import { Point } from 'web-tree-sitter'; // Assuming Point is needed for location

/**
 * Represents the location of a symbol within a file.
 */
export interface SymbolLocation {
    filePath: string;
    start: Point;
    end: Point;
}

/**
 * Defines the types of symbols that can be stored.
 * Expand this enum as more symbol types are identified.
 */
export enum SymbolType {
    Function = 'FUNCTION',
    Variable = 'VARIABLE',
    Class = 'CLASS',
    Interface = 'INTERFACE',
    TypeAlias = 'TYPE_ALIAS',
    Import = 'IMPORT',
    Parameter = 'PARAMETER',
    Method = 'METHOD',
    Property = 'PROPERTY',
    Enum = 'ENUM',
    EnumMember = 'ENUM_MEMBER',
    Namespace = 'NAMESPACE',
    Module = 'MODULE',
    Unknown = 'UNKNOWN',
    // Add other relevant types: Constant, Struct, Trait, etc.
}

/**
 * Represents a single symbol entry in the table.
 */
export interface SymbolEntry {
    name: string;
    type: SymbolType;
    location: SymbolLocation;
    scopeId: string; // Identifier for the scope (e.g., file path, function name, class name)
    // Optional properties based on symbol type
    dataType?: string; // For variables, parameters, function returns
    signature?: string; // For functions, methods
    parentScopeId?: string; // Link to the parent scope
    // Add more metadata as needed (e.g., access modifiers, decorators)
}

/**
 * Basic implementation of a Symbol Table for storing identified symbols.
 * Currently uses a simple map for storage. Scope management is basic.
 */
export class SymbolTable {
    // Using a Map where the key is a unique identifier for the symbol (e.g., scopeId + name)
    // or potentially just storing an array and relying on lookup logic.
    // Let's use a Map keyed by a generated unique ID or the symbol name within its scope for simplicity.
    // A Map keyed by symbol name might be simpler for direct lookups, but needs scope handling.
    // Let's try Map<scopeId, Map<symbolName, SymbolEntry>> for basic scoping.
    private scopes: Map<string, Map<string, SymbolEntry>>;
    private globalScopeId = '::global::'; // Special identifier for the global scope

    constructor() {
        this.scopes = new Map();
        // Initialize global scope
        this.scopes.set(this.globalScopeId, new Map());
    }

    /**
     * Generates a unique identifier for a scope.
     * Can be enhanced for nested scopes.
     * @param parts - Parts to combine for the scope ID (e.g., file path, class name).
     * @returns A unique scope identifier string.
     */
    public static createScopeId(...parts: string[]): string {
        // Simple join, consider more robust hashing or structure for complex scopes
        return parts.join('::');
    }

    /**
     * Adds a symbol to the table within a specific scope.
     * If the scope doesn't exist, it's created.
     *
     * @param symbol The SymbolEntry object to add.
     * @throws Error if the symbol name already exists within the given scope.
     */
    public addSymbol(symbol: SymbolEntry): void {
        const { scopeId, name } = symbol;

        if (!this.scopes.has(scopeId)) {
            this.scopes.set(scopeId, new Map());
            // console.log(`Created new scope: ${scopeId}`);
        }

        const scope = this.scopes.get(scopeId)!;

        if (scope.has(name)) {
            // Handle symbol redefinition? Overwrite, log warning, or throw error?
            // For now, let's log a warning and potentially overwrite or ignore.
            // Throwing might be too strict initially.
            console.warn(`Symbol "${name}" already exists in scope "${scopeId}". Overwriting.`);
            // Overwrite existing symbol
             scope.set(name, symbol);
            // Alternatively, throw an error:
            // throw new Error(`Symbol "${name}" already exists in scope "${scopeId}"`);
        } else {
             scope.set(name, symbol);
        }
         // console.log(`Added symbol "${name}" to scope "${scopeId}"`);
    }

    /**
     * Looks up a symbol by name within a specific scope.
     * TODO: Implement hierarchical scope lookup (check current scope, then parent scopes).
     *
     * @param name The name of the symbol to find.
     * @param scopeId The identifier of the scope to search within.
     * @returns The SymbolEntry if found, otherwise undefined.
     */
    public lookupSymbol(name: string, scopeId: string): SymbolEntry | undefined {
        const scope = this.scopes.get(scopeId);
        if (scope && scope.has(name)) {
            return scope.get(name);
        }

        // Basic parent scope lookup example (if parentScopeId is stored on symbols or scopes)
        // This requires a way to get the parent scope ID from the current scopeId
        // For simplicity, this is omitted for now but is crucial for real-world use.
        // const parentScopeId = this.findParentScopeId(scopeId);
        // if (parentScopeId) {
        //     return this.lookupSymbol(name, parentScopeId);
        // }


        // Fallback to global scope if not found in current and not already global
        if (scopeId !== this.globalScopeId) {
             const globalScope = this.scopes.get(this.globalScopeId);
             if (globalScope && globalScope.has(name)) {
                 return globalScope.get(name);
             }
        }


        return undefined;
    }

     /**
     * Retrieves all symbols within a specific scope.
     *
     * @param scopeId The identifier of the scope.
     * @returns An array of SymbolEntry objects in the scope, or an empty array if the scope doesn't exist.
     */
    public getSymbolsInScope(scopeId: string): SymbolEntry[] {
        const scope = this.scopes.get(scopeId);
        return scope ? Array.from(scope.values()) : [];
    }

    /**
     * Clears all symbols and scopes from the table.
     */
    public clear(): void {
        this.scopes.clear();
        // Re-initialize global scope
        this.scopes.set(this.globalScopeId, new Map());
    }

    // --- Potential helper methods for advanced scope management ---

    // private findParentScopeId(scopeId: string): string | undefined {
    //     // Example: If scopeId is 'file.ts::MyClass::myMethod'
    //     const parts = scopeId.split('::');
    //     if (parts.length > 1) {
    //         return parts.slice(0, -1).join('::');
    //     }
    //     // If only one part (e.g., file path), parent might be global
    //     if (parts.length === 1 && scopeId !== this.globalScopeId) {
    //         return this.globalScopeId;
    //     }
    //     return undefined; // No parent (already global or invalid)
    // }
}