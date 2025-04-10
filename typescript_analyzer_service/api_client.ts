// typescript_analyzer_service/api_client.ts
import axios, { AxiosError } from 'axios';
import { AnalysisNode, AnalysisRelationship } from './analyzer'; // Import the interfaces defined in analyzer.ts

const API_GATEWAY_ENDPOINT = process.env.API_GATEWAY_URL || 'http://api_gateway:8000/ingest/analysis_data';

interface AnalysisPayload {
    language: 'typescript' | 'tsx'; // Specify the language
    filePath: string; // The original file path
    nodes: AnalysisNode[];
    relationships: AnalysisRelationship[];
}

/**
 * Sends the analyzed nodes and relationships to the API Gateway ingestion endpoint.
 * @param language - The language of the analyzed file ('typescript' or 'tsx').
 * @param filePath - The original path of the analyzed file.
 * @param nodes - Array of analysis nodes.
 * @param relationships - Array of analysis relationships.
 */
export async function sendAnalysisDataToApi(
    language: 'typescript' | 'tsx',
    filePath: string,
    nodes: AnalysisNode[],
    relationships: AnalysisRelationship[]
): Promise<void> {
    // Construct payload matching the API Gateway's AnalysisData schema
    const payload = {
        nodes,
        relationships,
    };

    console.log(`[TS API Client] Sending analysis data for ${filePath} to ${API_GATEWAY_ENDPOINT}`);
    try {
        const response = await axios.post(API_GATEWAY_ENDPOINT, payload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000, // 30 second timeout
        });

        if (response.status >= 200 && response.status < 300) {
            console.log(`[TS API Client] Successfully sent analysis data for ${filePath}. Status: ${response.status}`);
        } else {
            // This case might not be reached often with axios default behavior (throws on non-2xx)
            // but included for completeness.
            console.error(`[TS API Client] API Gateway returned non-success status for ${filePath}: ${response.status} ${response.statusText}`);
            throw new Error(`API Gateway returned status ${response.status}`);
        }
    } catch (error) {
        console.error(`[TS API Client] Error sending analysis data for ${filePath}:`, error);
        if (axios.isAxiosError(error)) {
            const axiosError = error as AxiosError;
            if (axiosError.response) {
                // The request was made and the server responded with a status code
                // that falls out of the range of 2xx
                console.error(`[TS API Client] API Error Response Status: ${axiosError.response.status}`);
                console.error(`[TS API Client] API Error Response Data:`, axiosError.response.data);
            } else if (axiosError.request) {
                // The request was made but no response was received
                console.error('[TS API Client] API Error: No response received from API Gateway.');
            } else {
                // Something happened in setting up the request that triggered an Error
                console.error('[TS API Client] API Error: Request setup failed.', axiosError.message);
            }
        }
        // Re-throw the error to be caught by the caller in server.ts
        throw error;
    }
}