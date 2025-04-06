import { Application, Router } from "oak";

// Import a local utility function (demonstrates inter-file dependency within Deno)
import { getTimestamp } from "./utils/timeUtil.ts";

const app = new Application();
const router = new Router();

// Simple endpoint called by the frontend
router.get("/hello", (ctx) => {
  console.log(`Deno: Received request for /hello at ${getTimestamp()}`);
  // Call the utility function
  const timestamp = getTimestamp();
  ctx.response.body = { message: `Hello from Deno at ${timestamp}!` };
  ctx.response.type = "json";
});

// Another endpoint, perhaps unused, for complexity
router.get("/status", (ctx) => {
    console.log("Deno: Received request for /status");
    ctx.response.body = { status: "Deno backend is running" };
    ctx.response.type = "json";
});


// --- Cross-Language Interaction (Conceptual) ---
// This section demonstrates *how* Deno *might* interact with Python,
// but the actual implementation requires more setup (e.g., HTTP client in Deno,
// Python server running). For CPG analysis, the *calls* are important.

async function callPythonService(endpoint: string): Promise<any> {
    const pythonBaseUrl = Deno.env.get("PYTHON_SERVICE_URL") || "http://localhost:5001"; // Get from env or default
    const url = `${pythonBaseUrl}/${endpoint}`;
    console.log(`Deno: Attempting to call Python service at ${url}`);
    try {
        // NOTE: This fetch call represents the cross-language dependency
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Python service call failed: ${response.statusText}`);
        }
        const data = await response.json();
        console.log(`Deno: Received response from Python:`, data);
        return data;
    } catch (error) {
        console.error(`Deno: Error calling Python service (${url}):`, error);
        return { error: `Failed to call Python service: ${error instanceof Error ? error.message : String(error)}` };
    }
}

// Example endpoint that calls the Python service
router.get("/call-python-greet", async (ctx) => {
    console.log("Deno: Received request for /call-python-greet");
    const pythonResponse = await callPythonService("greet?name=Deno");
    ctx.response.body = { deno_says: "Called Python!", python_response: pythonResponse };
    ctx.response.type = "json";
});
// --- End Cross-Language Interaction ---


app.use(router.routes());
app.use(router.allowedMethods());

console.log("Deno backend listening on http://localhost:8000");
await app.listen({ port: 8000 });