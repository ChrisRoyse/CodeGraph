import { h } from 'preact';

/**
 * A simple reusable Button component.
 * Demonstrates component structure and inter-directory dependency.
 * @param {object} props - Component properties.
 * @param {Function} props.onClick - Click handler function.
 * @param {string} props.label - Text label for the button.
 */
export function Button({ onClick, label }) {
  return (
    <button
      onClick={onClick}
      class="mt-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-opacity-50"
    >
      {label || 'Click Me'}
    </button>
  );
}

// Another potential component, maybe unused, for complexity
export function Card({ title, children }) {
    return (
        <div class="border p-4 rounded shadow">
            <h3 class="font-bold mb-2">{title}</h3>
            <div>{children}</div>
        </div>
    )
}