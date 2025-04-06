import React, { useState, useEffect } from 'react';
import { fetchDataFromBackend } from './api'; // Import API function

function App() {
  const [data, setData] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        setError(null);
        const result = await fetchDataFromBackend('initial');
        setData(result.message);
      } catch (err: any) {
        setError(err.message || 'Failed to fetch data');
      }
    };
    loadData();
  }, []); // Run once on mount

  return (
    <div className="App">
      <h1>Complex Web App Frontend</h1>
      {error && <p style={{ color: 'red' }}>Error: {error}</p>}
      {data ? <p>Data from backend: {data}</p> : <p>Loading...</p>}
    </div>
  );
}

export default App;