#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

repo_root="${ZHIXING_REPO_ROOT:-/home/ubuntu/knowing-doing-repo}"
repo_url="${ZHIXING_REPO_URL:-https://github.com/Nai1ve/Knowing-Doing.git}"
data_root="${ZHIXING_DATA_ROOT:-/home/ubuntu/knowing-doing-data}"
commit="${1:-}"

if [ ! -e "$repo_root/.git" ] && [ -e "$repo_root/Knowing-Doing/.git" ]; then
  repo_root="$repo_root/Knowing-Doing"
fi

if [ ! -e "$repo_root/.git" ]; then
  if [ -e "$repo_root" ]; then
    echo "Deployment repository path exists but is not a Git checkout: $repo_root" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$repo_root")"
  git clone --origin origin "$repo_url" "$repo_root"
else
  if git -C "$repo_root" remote get-url origin >/dev/null 2>&1; then
    git -C "$repo_root" remote set-url origin "$repo_url"
  else
    git -C "$repo_root" remote add origin "$repo_url"
  fi
fi

git -C "$repo_root" fetch --quiet origin main
if [ -z "$commit" ]; then
  commit="$(git -C "$repo_root" rev-parse origin/main)"
fi
git -C "$repo_root" cat-file -e "${commit}^{commit}"

build_root="$data_root/.server-docker-build-$commit"
rm -rf -- "$build_root"
mkdir -p "$build_root"
git -C "$repo_root" archive "$commit" | tar -x -C "$build_root"
trap 'rm -rf -- "$build_root"' EXIT

echo "Building server-managed Workspace Runner assets from $commit"
(
  cd "$build_root/workspace-runner"
  npm ci --ignore-scripts
  npm run build
  WORKSPACE_PYTHON_IMAGE=zhixing-python-pytest-v1:local \
    WORKSPACE_GO_IMAGE=zhixing-go-test-v1:local \
    ./build-template.sh
)

echo 'Building server-managed Workspace Runner service image'
docker build --tag zhixing-workspace-runner:server "$build_root/workspace-runner"

echo 'Building server-managed Case Builder wrapper image'
docker build --tag zhixing-case-builder-agent:server "$build_root/case-builder-agent"

for image in zhixing-python-pytest-v1:local zhixing-go-test-v1:local zhixing-workspace-runner:server zhixing-case-builder-agent:server; do
  docker image inspect "$image" --format '{{.Id}}' >/dev/null
done

echo 'Server-managed Docker environment is ready.'
echo 'Run deploy/setup-case-builder-agent.sh separately to build/configure the OpenHands task image.'
