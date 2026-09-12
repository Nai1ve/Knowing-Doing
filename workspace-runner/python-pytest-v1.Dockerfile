ARG PYTHON_BASE_IMAGE=python:3.13-slim
FROM ${PYTHON_BASE_IMAGE}
RUN pip install --no-cache-dir pytest==8.4.1
WORKDIR /workspace
