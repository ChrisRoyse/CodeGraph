import pytest
import os

@pytest.fixture(scope="session")
def docker_compose_file(pytestconfig): # Changed from plural to singular
    """
    Override the default fixture to point to the docker-compose.yml
    file in the project root directory.
    """
    # pytestconfig.rootdir gives the root directory where pytest was invoked (c:/code/bmcp)
    compose_file = os.path.join(str(pytestconfig.rootdir), "docker-compose.yml")
    return [compose_file]