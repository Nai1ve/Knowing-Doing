#!/usr/bin/env bash
set -Eeuo pipefail
docker build -t "${WORKSPACE_PYTHON_IMAGE:-zhixing-python-pytest-v1:local}" -f "$(dirname "$0")/python-pytest-v1.Dockerfile" "$(dirname "$0")"
docker build -t "${WORKSPACE_GO_IMAGE:-zhixing-go-test-v1:local}" -f "$(dirname "$0")/go-test-v1.Dockerfile" "$(dirname "$0")"
