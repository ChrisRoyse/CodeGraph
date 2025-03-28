import os

def write_file_contents_to_txt(root_dir, output_file):
    # Specific files to capture
    specific_files = [
        'src/analyzer/parsers/function-parser.ts',
        'src/analyzer/parsers/class-parser.ts',
        'src/analyzer/parsers/interface-parser.ts',
        'src/analyzer/parsers/type-alias-parser.ts',
        'src/analyzer/parsers/variable-parser.ts',
        'src/analyzer/parsers/module-parser.ts',
        'src/cli/analyze.ts',
        'src/config/index.ts',
        'src/database/schema.ts',
        'src/database/neo4j-client.ts',
        'src/scanner/file-scanner.ts',
        'src/utils/errors.ts',
        'src/utils/logger.ts',
        'src/utils/ts-helpers.ts',
        'src/vector/vector-service.ts',
        'src/analyzer/analysis/assignment-analyzer.ts',
        'src/analyzer/analysis/call-analyzer.ts',
        'src/analyzer/analysis/control-flow-analyzer.ts',
        'src/analyzer/analysis/usage-analyzer.ts',
        'src/analyzer/analyzer-service.ts',
        'src/analyzer/domain-analyzer.ts',
        'src/analyzer/parser.ts',
        'src/analyzer/relationship-resolver.ts',
        'src/analyzer/semantic-analyzer.ts',
        'src/analyzer/storage-manager.ts',
        'src/index.ts',
        'package.json',
        'tsconfig.json'
    ]

    with open(output_file, 'w', encoding='utf-8') as outfile:
        def write_separator():
            outfile.write('\n' + '='*80 + '\n\n')

        for file_path in specific_files:
            full_path = os.path.join(root_dir, file_path)
            if os.path.exists(full_path):
                # Write file header
                outfile.write(f'File: {os.path.basename(file_path)}\n')
                outfile.write(f'Path: {file_path}\n')
                outfile.write('-'*40 + '\n\n')
                
                # Read and write file contents
                try:
                    with open(full_path, 'r', encoding='utf-8') as infile:
                        outfile.write(infile.read())
                except Exception as e:
                    outfile.write(f'Error reading file: {str(e)}\n')
                
                write_separator()
            else:
                print(f'Warning: File not found: {file_path}')

def main():
    # Get the root directory (assuming this script is in the root)
    root_dir = os.getcwd()
    
    # Output file name
    output_file = 'codebase_contents.txt'
    
    print(f"Starting to collect file contents from {root_dir}")
    write_file_contents_to_txt(root_dir, output_file)
    print(f"Finished! All contents have been written to {output_file}")

if __name__ == "__main__":
    main()
