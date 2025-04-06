from setuptools import setup, find_packages

setup(
    name='bmcp_grpc_generated',
    version='0.1.0',
    packages=find_packages(where='src'),
    package_dir={'': 'src'},
    install_requires=[
        'grpcio',
        'protobuf',
    ],
    # Add grpcio-tools only if needed at runtime, usually it's a build dependency
)
