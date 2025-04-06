// test_fixtures/comprehensive_multi_lang_test/frontend/src/App.tsx
import React, { useEffect, useState } from 'react';
import { fetchUsers, formatUserName } from './apiClient'; // Import from apiClient

const App: React.FC = () => {
  const [users, setUsers] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadUsers = async () => {
      try {
        setError(null);
        // Call the imported function which calls the backend
        const fetchedUsers = await fetchUsers();
        setUsers(fetchedUsers || []); // Handle potential null/undefined response
      } catch (err) {
        setError('Failed to fetch users.');
        console.error(err);
      }
    };

    loadUsers();
  }, []); // Empty dependency array means this runs once on mount

  return (
    <div className="App">
      <h1>User List</h1>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {users.length > 0 ? (
        <ul>
          {users.map((user, index) => (
            // Example using the other imported function
            <li key={index}>{formatUserName(user)}</li>
          ))}
        </ul>
      ) : (
        <p>Loading users or no users found...</p>
      )}
    </div>
  );
};

export default App;