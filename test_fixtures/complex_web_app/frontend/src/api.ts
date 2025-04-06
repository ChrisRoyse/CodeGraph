// Placeholder for API calls to the backend

interface BackendResponse {
  message: string;
  // Add other expected fields from the backend
}

/**
 * Simulates fetching data from the Python backend.
 * In a real app, this would use fetch() or a library like axios.
 * @param endpoint - A dummy endpoint identifier.
 * @returns A promise resolving to the backend response.
 */
export async function fetchDataFromBackend(endpoint: string): Promise<BackendResponse> {
  console.log(`Simulating fetch to backend endpoint: /api/${endpoint}`);

  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 50));

  // Simulate a successful response
  if (endpoint === 'initial') {
    return { message: 'Data loaded from Python backend!' };
  }

  // Simulate an error for other endpoints
  throw new Error(`Backend endpoint not found: ${endpoint}`);
}