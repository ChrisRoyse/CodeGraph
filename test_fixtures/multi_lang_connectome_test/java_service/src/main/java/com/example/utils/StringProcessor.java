// java_service/src/main/java/com/example/utils/StringProcessor.java
package com.example.utils;

// Basic class demonstrating a callable method
public class StringProcessor {

    /**
     * Processes the input string (e.g., reverses it).
     * @param input The string to process.
     * @return The processed string.
     */
    public String process(String input) {
        // Example processing: Reverse the input string
        // Intra-language call
        System.out.println("Java: Processing input: " + input); // Add logging
        String reversed = reverseString(input);
        System.out.println("Java: Reversed string: " + reversed); // Add logging
        return reversed;
    }

    /**
     * Utility method to reverse a string.
     * @param str The string to reverse.
     * @return The reversed string.
     */
    private String reverseString(String str) {
        if (str == null) {
            return null;
        }
        return new StringBuilder(str).reverse().toString();
    }

    /**
     * Main method to allow execution via subprocess call from Python.
     * Expects one argument: the string to process.
     * Prints the processed string to standard output.
     * @param args Command line arguments.
     */
    public static void main(String[] args) {
         System.out.println("Java: StringProcessor starting..."); // Add logging
        if (args.length > 0) {
            StringProcessor processor = new StringProcessor(); // Intra-language call (constructor)
            String result = processor.process(args[0]); // Intra-language call
            // Output ONLY the result for Python script to capture easily
            System.out.println(result); 
            System.out.println("Java: Processing complete."); // Add logging
        } else {
            System.err.println("Error: No input string provided."); // Use stderr for errors
            System.out.println("Usage: java com.example.utils.StringProcessor <input_string>");
            System.exit(1); // Indicate error
        }
         System.out.println("Java: StringProcessor finished."); // Add logging
    }
}