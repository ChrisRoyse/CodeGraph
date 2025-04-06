/**
 * Simple utility function in Deno/TypeScript.
 * Demonstrates inter-file dependency within the Deno backend.
 * @returns {string} Current timestamp as an ISO string.
 */
export function getTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Another utility, perhaps unused.
 * @param {number} year
 * @returns {boolean}
 */
export function isLeapYear(year: number): boolean {
    return ((year % 4 === 0) && (year % 100 !== 0)) || (year % 400 === 0);
}