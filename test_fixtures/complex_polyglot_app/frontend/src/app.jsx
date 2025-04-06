import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';

// Import a utility function (demonstrates inter-file dependency)
import { formatGreeting } from './utils/formatter';

// Import a component (demonstrates inter-directory dependency)
import { Button } from './components/Button';

export function App() {
  const [denoMessage, setDenoMessage] = useState('Loading Deno data...');
  const [pythonMessage, setPythonMessage] = useState('Loading Python data...');
  const [dbStatus, setDbStatus] = useState('Checking DB status...');

  // Fetch data from Deno backend
  const fetchDenoData = async () => {
    try {
      const response = await fetch('/api/deno/hello');
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      // Use the imported utility function
      setDenoMessage(formatGreeting(data.message));
    } catch (error) {
      console.error("Failed to fetch Deno data:", error);
      setDenoMessage('Error fetching Deno data.');
    }
  };

  // Fetch data from Python backend
  const fetchPythonData = async () => {
    try {
      const response = await fetch('/api/python/greet?name=Frontend');
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      setPythonMessage(data.greeting);
    } catch (error) {
      console.error("Failed to fetch Python data:", error);
      setPythonMessage('Error fetching Python data.');
    }
  };

  // Fetch DB status from Python backend (demonstrates calling another endpoint)
  const checkDbStatus = async () => {
    setDbStatus('Checking...');
    try {
      const response = await fetch('/api/python/db-status');
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      setDbStatus(`DB Status: ${data.status} (via Python)`);
    } catch (error) {
      console.error("Failed to fetch DB status:", error);
      setDbStatus('Error fetching DB status.');
    }
  };


  // Fetch data on component mount
  useEffect(() => {
    fetchDenoData();
    fetchPythonData();
  }, []); // Empty dependency array means run once on mount

  return (
    <div class="container mx-auto p-8 bg-white shadow-md rounded-lg mt-10">
      <h1 class="text-3xl font-bold mb-6 text-center text-blue-600">Polyglot Test Application</h1>

      <div class="mb-4 p-4 border rounded bg-gray-50">
        <h2 class="text-xl font-semibold mb-2 text-purple-700">Deno Backend:</h2>
        <p class="text-gray-700">{denoMessage}</p>
        {/* Use the imported Button component */}
        <Button onClick={fetchDenoData} label="Refresh Deno Data" />
      </div>

      <div class="mb-4 p-4 border rounded bg-gray-50">
        <h2 class="text-xl font-semibold mb-2 text-green-700">Python Backend:</h2>
        <p class="text-gray-700">{pythonMessage}</p>
        <Button onClick={fetchPythonData} label="Refresh Python Data" />
      </div>

       <div class="p-4 border rounded bg-gray-50">
        <h2 class="text-xl font-semibold mb-2 text-orange-700">Database Interaction (via Python):</h2>
        <p class="text-gray-700">{dbStatus}</p>
        <Button onClick={checkDbStatus} label="Check DB Status" />
      </div>
    </div>
  );
}