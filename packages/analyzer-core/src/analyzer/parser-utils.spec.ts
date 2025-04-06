// packages/analyzer-core/src/analyzer/parser-utils.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { generateRelationshipId, generateEntityId } from './parser-utils'; // Import both ID generators

// Mock logger used within the functions
vi.mock('../utils/logger', () => ({
    createContextLogger: vi.fn().mockReturnValue({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    }),
}));

describe('parser-utils', () => {

    describe('generateRelationshipId', () => {
        it('should generate the same ID for the same inputs', () => {
            const source = 'file:a/b/c.ts';
            const target = 'function:a/b/c.ts:myFunc:10';
            const type = 'CALLS';

            const id1 = generateRelationshipId(source, target, type);
            const id2 = generateRelationshipId(source, target, type);

            expect(id1).toBeDefined();
            expect(id1).toBe(id2);
            expect(id1).toBe('file:a/b/c.ts:CALLS:function:a/b/c.ts:myFunc:10');
        });

        it('should generate the same ID regardless of type casing', () => {
            const source = 'file:a/b/c.ts';
            const target = 'function:a/b/c.ts:myFunc:10';

            const id1 = generateRelationshipId(source, target, 'calls');
            const id2 = generateRelationshipId(source, target, 'CALLS');

            expect(id1).toBe(id2);
            expect(id1).toBe('file:a/b/c.ts:CALLS:function:a/b/c.ts:myFunc:10');
        });

        it('should generate the same fallback ID for the same missing inputs', () => {
            const source = 'file:a/b/c.ts';
            const type = 'DEFINES';

            // Test missing target
            const id1_missing_target = generateRelationshipId(source, '', type);
            const id2_missing_target = generateRelationshipId(source, '', type);
            expect(id1_missing_target).toBeDefined();
            expect(id1_missing_target).toBe(id2_missing_target);
            expect(id1_missing_target).toMatch(/^fallback:[a-f0-9]{16}$/); // Check format

            // Test missing source
            const id1_missing_source = generateRelationshipId('', 'target:id', type);
            const id2_missing_source = generateRelationshipId('', 'target:id', type);
            expect(id1_missing_source).toBeDefined();
            expect(id1_missing_source).toBe(id2_missing_source);
            expect(id1_missing_source).toMatch(/^fallback:[a-f0-9]{16}$/);

             // Test missing type
             const id1_missing_type = generateRelationshipId(source, 'target:id', '');
             const id2_missing_type = generateRelationshipId(source, 'target:id', '');
             expect(id1_missing_type).toBeDefined();
             expect(id1_missing_type).toBe(id2_missing_type);
             expect(id1_missing_type).toMatch(/^fallback:[a-f0-9]{16}$/);
        });

         it('should generate different fallback IDs for different missing inputs', () => {
             const source = 'file:a/b/c.ts';
             const target = 'target:id';
             const type = 'DEFINES';

             const id_missing_target = generateRelationshipId(source, '', type);
             const id_missing_source = generateRelationshipId('', target, type);
             const id_missing_type = generateRelationshipId(source, target, '');

             expect(id_missing_target).not.toBe(id_missing_source);
             expect(id_missing_target).not.toBe(id_missing_type);
             expect(id_missing_source).not.toBe(id_missing_type);
         });
    });

     describe('generateEntityId', () => {
         it('should generate the same ID for the same inputs', () => {
             const prefix = 'function';
             const qn = 'path/to/file.ts:myFunction:12';
             const id1 = generateEntityId(prefix, qn);
             const id2 = generateEntityId(prefix, qn);
             expect(id1).toBeDefined();
             expect(id1).toBe(id2);
             expect(id1).toBe('function:path/to/file.ts:myfunction:12'); // Note lowercase
         });

         it('should normalize path separators', () => {
             const prefix = 'file';
             const qn1 = 'path\\to\\file.ts';
             const qn2 = 'path/to/file.ts';
             const id1 = generateEntityId(prefix, qn1);
             const id2 = generateEntityId(prefix, qn2);
             expect(id1).toBe(id2);
             expect(id1).toBe('file:path/to/file.ts');
         });

         it('should handle different casing consistently', () => {
             const prefix = 'Class';
             const qn1 = 'path/to/File.ts:MyClass';
             const qn2 = 'path/to/file.ts:myclass';
             const id1 = generateEntityId(prefix, qn1);
             const id2 = generateEntityId(prefix.toLowerCase(), qn2);
             expect(id1).toBe(id2);
             expect(id1).toBe('class:path/to/file.ts:myclass');
         });

         it('should sanitize invalid characters', () => {
             const prefix = 'variable';
             const qn = 'path/to/file.ts:my variable$!@#:15'; // Reverted diagnostic change
             const id1 = generateEntityId(prefix, qn);
             expect(id1).toBe('variable:path/to/file.ts:my_variable____:15'); // Expect 4 underscores (matching runner output), colon preserved
         });

         it('should generate the same fallback ID for the same missing inputs', () => {
             const prefix = 'function';
             const id1 = generateEntityId(prefix, '');
             const id2 = generateEntityId(prefix, '');
             expect(id1).toBeDefined();
             expect(id1).toBe(id2);
             expect(id1).toMatch(/^function:[a-f0-9]{16}$/);

             const qn = 'some/name';
             const id3 = generateEntityId('', qn);
             const id4 = generateEntityId('', qn);
             expect(id3).toBeDefined();
             expect(id3).toBe(id4);
             expect(id3).toMatch(/^unknown:[a-f0-9]{16}$/);
         });
     });
});