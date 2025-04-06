import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

interface User {
  id: string;
  name: string;
  email: string;
}

interface Task {
  id: number;
  task_name: string;
  is_complete: boolean;
  user_id: string;
}

function App() {
  const [users, setUsers] = useState<User[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        // Fetch users
        const { data: usersData, error: usersError } = await supabase
          .from('users') // References 'users' table
          .select('id, name, email');

        if (usersError) throw usersError;
        setUsers(usersData || []);

        // Fetch tasks for a specific user (example)
        if (usersData && usersData.length > 0) {
          const userId = usersData[0].id;
          const { data: tasksData, error: tasksError } = await supabase
            .from('tasks') // References 'tasks' table
            .select('*')
            .eq('user_id', userId);

          if (tasksError) throw tasksError;
          setTasks(tasksData || []);
        }

        // Call a database function
        const { data: functionResult, error: functionError } = await supabase
            .rpc('get_active_user_count'); // Calls 'get_active_user_count' function

        if (functionError) throw functionError;
        console.log('Active user count:', functionResult);

      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []); // Empty dependency array means this runs once on mount

  async function addTask(taskName: string, userId: string) {
    try {
        const { data, error } = await supabase
            .from('tasks') // References 'tasks' table
            .insert([{ task_name: taskName, user_id: userId, is_complete: false }]);

        if (error) throw error;
        console.log('Task added:', data);
        // Potentially refresh tasks list here
    } catch (error) {
        console.error('Error adding task:', error);
    }
  }


  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <h1>Users</h1>
      <ul>
        {users.map(user => (
          <li key={user.id}>{user.name} ({user.email})</li>
        ))}
      </ul>
      <h2>Tasks (for first user)</h2>
      <ul>
        {tasks.map(task => (
          <li key={task.id}>{task.task_name} {task.is_complete ? '(Completed)' : ''}</li>
        ))}
      </ul>
      {/* Example button to add a task */}
      {users.length > 0 && (
          <button onClick={() => addTask('New Fixture Task', users[0].id)}>
              Add Task
          </button>
      )}
    </div>
  );
}

export default App;