// frontend/index.ts
// Assuming 'fetch' is available (e.g., in a browser or Node environment with node-fetch)
// To run in Node: npm install node-fetch; then use: import fetch from 'node-fetch';

// Use environment variable or default for flexibility
const API_BASE_URL = process.env.API_URL || 'http://localhost:5000'; 

interface UserData {
    user_id: number;
    email: string;
    processed: string;
}

interface ErrorResponse {
    error: string;
}

async function fetchUserData(userId: number): Promise<void> {
  console.log(`Fetching data for user ${userId}...`);
  const url = `${API_BASE_URL}/api/users/${userId}`;
  console.log(`Requesting URL: ${url}`); // Log the URL being fetched

  try {
    // API Call (TypeScript -> Python)
    // Note: Ensure CORS is handled on the Flask backend if running from a browser
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json', // Explicitly accept JSON
        },
        // Add timeout if using node-fetch or similar library supporting it
        // signal: AbortSignal.timeout(5000), // Example for newer fetch APIs
    });

    console.log(`Response Status: ${response.status}`); // Log status

    if (!response.ok) {
      const errorText = await response.text(); // Get error body
      throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
    }

    // Type assertion after checking response.ok
    const data = await response.json() as UserData | ErrorResponse;
    console.log('Data received:', data);

    if ('error' in data) {
         console.error(`API Error: ${data.error}`);
    } else {
        // Example of using the data
        displayUserInfo(data); // Intra-language call
    }

  } catch (error) {
    console.error('Failed to fetch user data:', error);
  }
}

function displayUserInfo(userData: UserData): void {
    // Simple display logic
    console.log(`User ID: ${userData.user_id}, Email: ${userData.email}, Processed: ${userData.processed}`);
}

// Example usage: Get user ID from command line argument or default to 1
const userIdArg = process.argv[2]; // process.argv[0] is node, [1] is script path
const userIdToFetch = userIdArg ? parseInt(userIdArg, 10) : 1;

if (isNaN(userIdToFetch)) {
    console.error("Invalid User ID provided.");
} else {
    fetchUserData(userIdToFetch);
}