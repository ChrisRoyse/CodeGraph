import subprocess
import logging
import os

# Configure logging for the module
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(module)s - %(message)s')

def fetch_repository(repo_url: str, target_dir: str) -> bool:
    """
    Clones a Git repository into the specified target directory.

    Args:
        repo_url: The URL of the repository to clone.
        target_dir: The local path where the repository should be cloned.

    Returns:
        True if the clone operation was successful.

    Raises:
        subprocess.CalledProcessError: If the git clone command fails.
        FileNotFoundError: If the git command is not found.
        Exception: For other potential errors during subprocess execution.
    """
    logging.info(f"Attempting to clone {repo_url} into {target_dir}...")

    # Ensure the parent directory exists if target_dir includes subdirectories
    # Although mkdtemp usually handles this, being explicit can help in some contexts.
    parent_dir = os.path.dirname(target_dir)
    if parent_dir:
        os.makedirs(parent_dir, exist_ok=True)

    clone_command = ['git', 'clone', repo_url, target_dir]

    try:
        # Execute the clone command
        # check=True raises CalledProcessError on non-zero exit codes.
        # capture_output=True captures stdout and stderr.
        # text=True decodes stdout and stderr as text.
        result = subprocess.run(
            clone_command,
            check=True,
            capture_output=True,
            text=True
        )
        logging.info(f"Clone successful for {repo_url}. Output:\n{result.stdout}")
        return True
    except subprocess.CalledProcessError as e:
        logging.error(f"Failed to clone repository {repo_url}. Error: {e.stderr}")
        # Re-raise the exception so the caller (and the test) knows about the failure.
        raise e
    except FileNotFoundError:
        logging.error("Git command not found. Ensure Git is installed and in the system's PATH.")
        # Re-raise for the caller
        raise
    except Exception as e:
        logging.error(f"An unexpected error occurred during git clone: {e}")
        # Re-raise for the caller
        raise

# Example usage (for testing purposes, not called by the service directly)
if __name__ == '__main__':
    test_url = "https://github.com/git/git.git" # A public repo
    test_dir = os.path.join(os.getcwd(), "temp_git_clone_test")
    print(f"Testing fetch_repository with URL: {test_url}")
    print(f"Cloning into: {test_dir}")
    try:
        if fetch_repository(test_url, test_dir):
            print("Clone test successful.")
        else:
            # This part might not be reached if exceptions are raised on failure
            print("Clone test indicated failure (unexpected).")
    except Exception as e:
        print(f"Clone test failed with exception: {e}")
    finally:
        # Clean up the test directory
        if os.path.exists(test_dir):
            import shutil
            print(f"Cleaning up test directory: {test_dir}")
            shutil.rmtree(test_dir)