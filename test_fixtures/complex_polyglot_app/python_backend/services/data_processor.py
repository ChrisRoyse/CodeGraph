"""
A simple service module for data processing tasks.
Demonstrates inter-directory dependency within the Python backend.
"""

def process_data(input_string: str) -> str:
    """
    Performs a simple transformation on the input string.
    Args:
        input_string: The string to process.

    Returns:
        The processed string.
    """
    if not isinstance(input_string, str):
        return "Invalid input (expected string)"

    # Example processing: reverse the string and add prefix
    processed = f"Processed_{input_string[::-1]}"
    print(f"Python/DataProcessor: Processed '{input_string}' to '{processed}'")
    return processed

def validate_user_id(user_id: int) -> bool:
    """
    Another function for complexity, perhaps unused directly by app.py.
    Checks if a user ID is valid (e.g., positive integer).
    """
    is_valid = isinstance(user_id, int) and user_id > 0
    print(f"Python/DataProcessor: Validating user ID {user_id}: {is_valid}")
    return is_valid