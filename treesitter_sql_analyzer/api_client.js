'use strict';

const axios = require('axios');

// Define the API Gateway endpoint URL
// TODO: Consider moving this to an environment variable for flexibility
const API_GATEWAY_URL = process.env.API_GATEWAY_URL || 'http://api_gateway:8000';
const INGEST_ENDPOINT = `${API_GATEWAY_URL}/ingest/analysis_data`;

/**
 * Sends analysis data (nodes and relationships) to the API Gateway ingestion endpoint.
 * @param {object} analysisData - The data object containing nodes and relationships arrays.
 * @param {Array} analysisData.nodes - Array of node objects.
 * @param {Array} analysisData.relationships - Array of relationship objects.
 * @returns {Promise<void>}
 */
async function sendAnalysisData(analysisData) {
  if (!analysisData || !analysisData.nodes || !analysisData.relationships) {
    console.error('[API Client] Invalid analysis data provided.');
    throw new Error('Invalid analysis data structure for API submission.');
  }

  console.log(`[API Client] Sending ${analysisData.nodes.length} nodes and ${analysisData.relationships.length} relationships to ${INGEST_ENDPOINT}`);

  try {
    const response = await axios.post(INGEST_ENDPOINT, analysisData, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000 // 30 second timeout
    });

    if (response.status >= 200 && response.status < 300) {
      console.log(`[API Client] Successfully sent analysis data. Status: ${response.status}`);
    } else {
      console.error(`[API Client] API Gateway returned non-success status: ${response.status}`, response.data);
      throw new Error(`API Gateway request failed with status ${response.status}`);
    }
  } catch (error) {
    console.error('[API Client] Error sending analysis data:', error.message);
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error('[API Client] Response Data:', error.response.data);
      console.error('[API Client] Response Status:', error.response.status);
      console.error('[API Client] Response Headers:', error.response.headers);
    } else if (error.request) {
      // The request was made but no response was received
      console.error('[API Client] No response received:', error.request);
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error('[API Client] Error details:', error.message);
    }
    // Re-throw the error to be handled by the caller (e.g., in server.js)
    throw error;
  }
}

module.exports = { sendAnalysisData };