// javascript_analyzer_service/api_client.js
// Handles sending analysis data to the ingestion API gateway

const axios = require('axios');

// TODO: Make this configurable via environment variables
const API_GATEWAY_ENDPOINT = 'http://api_gateway:8000/ingest/analysis_data';

/**
 * Sends the analyzed node and relationship data to the ingestion API.
 * @param {object} analysisData - The data object containing 'nodes' and 'relationships' arrays.
 * @param {string} filePath - The path of the file analyzed (for logging purposes).
 * @returns {Promise<boolean>} - True if successful, false otherwise.
 */
async function sendAnalysisData(analysisData, filePath) {
    if (!analysisData || !analysisData.nodes || !analysisData.relationships) {
        console.error(`[API Client] Invalid analysis data provided for ${filePath}. Aborting send.`);
        return false;
    }

    console.log(`[API Client] Sending analysis data for ${filePath} to ${API_GATEWAY_ENDPOINT}...`);
    console.log(`[API Client] Data size: ${analysisData.nodes.length} nodes, ${analysisData.relationships.length} relationships.`);

    try {
        const response = await axios.post(API_GATEWAY_ENDPOINT, analysisData, {
            headers: { 'Content-Type': 'application/json' },
            // Consider adding a timeout
            // timeout: 10000, // e.g., 10 seconds
        });

        if (response.status >= 200 && response.status < 300) {
            console.log(`[API Client] Successfully sent analysis data for ${filePath}. Status: ${response.status}`);
            return true;
        } else {
            console.error(`[API Client] API Gateway returned non-success status for ${filePath}: ${response.status} ${response.statusText}`);
            console.error(`[API Client] Response data:`, response.data);
            return false;
        }
    } catch (error) {
        console.error(`[API Client] Error sending analysis data for ${filePath}:`, error.message);
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            console.error(`[API Client] Error Response Status: ${error.response.status}`);
            console.error(`[API Client] Error Response Data:`, error.response.data);
        } else if (error.request) {
            // The request was made but no response was received
            console.error('[API Client] No response received from API Gateway. Check network connectivity and endpoint availability.');
            console.error('[API Client] Error Request:', error.request);
        } else {
            // Something happened in setting up the request that triggered an Error
            console.error('[API Client] Error setting up request:', error.message);
        }
        return false;
    }
}

module.exports = { sendAnalysisData };