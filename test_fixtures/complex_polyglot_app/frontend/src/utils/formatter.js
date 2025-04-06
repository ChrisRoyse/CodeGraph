/**
 * Simple utility function to format a greeting message.
 * Demonstrates a basic JavaScript module dependency.
 * @param {string} message - The message from the backend.
 * @returns {string} Formatted greeting.
 */
export function formatGreeting(message) {
  if (!message) {
    return "No message received.";
  }
  // Simple transformation
  return `Backend says: "${message}" (Formatted)`;
}

/**
 * Another utility function, perhaps unused, to add complexity.
 */
export function calculateSomething(a, b) {
    // Intentionally simple calculation
    return a + b;
}