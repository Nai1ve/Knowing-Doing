#!/usr/bin/env bash
set -Eeuo pipefail
docker build \
  --build-arg "PYTHON_BASE_IMAGE=${WORKSPACE_PYTHON_BASE_IMAGE:-python:3.13-slim}" \
  -t "${WORKSPACE_PYTHON_IMAGE:-zhixing-python-pytest-v1:local}" \
  -f "$(dirname "$0")/python-pytest-v1.Dockerfile" "$(dirname "$0")"
docker build \
  --build-arg "GO_BASE_IMAGE=${WORKSPACE_GO_BASE_IMAGE:-golang:1.24-bookworm}" \
  -t "${WORKSPACE_GO_IMAGE:-zhixing-go-test-v1:local}" \
  -f "$(dirname "$0")/go-test-v1.Dockerfile" "$(dirname "$0")"
