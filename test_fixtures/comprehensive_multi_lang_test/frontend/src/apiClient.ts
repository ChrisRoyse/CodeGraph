// test_fixtures/comprehensive_multi_lang_test/frontend/src/apiClient.ts

/**
 * Fetches user data from the backend API.
 * This function demonstrates a Frontend (TS) -> Backend (Python) API call.
 */
export const fetchUsers = async (): Promise<any> => {
  try {
    // Call to backend endpoint defined in backend/app.py
    const response = await fetch('/api/users');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    console.log('Users fetched:', data);
    return data;
  } catch (error) {
    console.error('Error fetching users:', error);
    throw error;
  }
};

// Example of another exported function
export const formatUserName = (user: { name: string }): string => {
  return user.name.toUpperCase();
};