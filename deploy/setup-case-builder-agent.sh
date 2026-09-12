#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

repo_root="${ZHIXING_REPO_ROOT:-/home/ubuntu/knowing-doing-repo}"
repo_url="${ZHIXING_REPO_URL:-https://github.com/Nai1ve/Knowing-Doing.git}"
data_root="${ZHIXING_DATA_ROOT:-/home/ubuntu/knowing-doing-data}"
commit="${1:-}"
base_image="${CASE_BUILDER_OPENHANDS_BASE_IMAGE:-docker.openhands.dev/openhands/openhands@sha256:03b8978743d4597d99d85385b5fa258e8dba8d360b30a7416182d7fa82c1e89c}"
image_tag="${CASE_BUILDER_OPENHANDS_LOCAL_TAG:-zhixing-openhands-local:current}"
case_builder_env_file="$data_root/case-builder-agent.env"

if [ ! -e "$repo_root/.git" ] && [ -e "$repo_root/Knowing-Doing/.git" ]; then
  repo_root="$repo_root/Knowing-Doing"
fi

case "$base_image" in
  *@sha256:*) ;;
  *) echo 'CASE_BUILDER_OPENHANDS_BASE_IMAGE must be digest-pinned' >&2; exit 1 ;;
esac

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

fetch_main() {
  local attempt
  local fetch_timeout="${ZHIXING_GIT_FETCH_TIMEOUT_SECONDS:-20}"
  for attempt in 1 2 3; do
    if timeout "$fetch_timeout" git -C "$repo_root" \
      -c http.lowSpeedLimit=1 \
      -c http.lowSpeedTime=10 \
      fetch --quiet origin main; then
      return 0
    fi
    sleep "$((attempt * 2))"
  done
  echo "Unable to fetch main from $repo_url after 3 attempts" >&2
  return 1
}

fetch_commit_archive() {
  local attempt
  local fetch_timeout="${ZHIXING_CODELOAD_TIMEOUT_SECONDS:-120}"
  local codeload_base="${ZHIXING_CODELOAD_URL:-$repo_url}"
  codeload_base="${codeload_base%.git}"
  codeload_base="${codeload_base/github.com/codeload.github.com}"

  commit_archive_path="$data_root/.case-builder-$commit.tar.gz"
  rm -f -- "$commit_archive_path"
  for attempt in 1 2 3; do
    if curl --fail --location --silent --show-error \
      --connect-timeout 10 --max-time "$fetch_timeout" \
      "$codeload_base/tar.gz/$commit" -o "$commit_archive_path" \
      && tar -tzf "$commit_archive_path" >/dev/null 2>&1; then
      echo "Fetched immutable source archive for $commit from $codeload_base"
      return 0
    fi
    rm -f -- "$commit_archive_path"
    sleep "$((attempt * 2))"
  done

  echo "Unable to fetch source archive for $commit from $codeload_base" >&2
  return 1
}

source_archive_path=''
if fetch_main; then
  if [ -z "$commit" ]; then
    commit="$(git -C "$repo_root" rev-parse origin/main)"
  fi
  git -C "$repo_root" cat-file -e "${commit}^{commit}"
else
  if [ -z "$commit" ]; then
    echo 'Git fetch failed and no explicit commit was provided for archive fallback.' >&2
    exit 1
  fi
  fetch_commit_archive
  source_archive_path="$commit_archive_path"
fi

if ! sudo -n test -f "$case_builder_env_file"; then
  echo "Missing Case Builder environment file: $case_builder_env_file" >&2
  echo 'Install the runtime secrets first, then rerun this setup script.' >&2
  exit 1
fi

build_root="$data_root/.case-builder-image-$commit"
rm -rf -- "$build_root"
mkdir -p "$build_root"
if [ -n "$source_archive_path" ]; then
  tar -xzf "$source_archive_path" --strip-components=1 -C "$build_root"
else
  git -C "$repo_root" archive "$commit" case-builder-agent | tar -x -C "$build_root"
fi
if [ -n "$source_archive_path" ]; then
  rm -f -- "$source_archive_path"
fi

echo "Building the OpenHands task image on the deployment host from $commit"
# Pull the digest-pinned base explicitly before this script. Avoid --pull here so
# a one-time server bootstrap does not re-enter a slow registry request during
# the image build, and normal product deployments never contact the registry.
if ! docker image inspect "$base_image" >/dev/null 2>&1; then
  echo "Missing local OpenHands base image: $base_image" >&2
  echo 'Pull the digest-pinned base on the deployment host, then rerun this setup script.' >&2
  exit 1
fi
docker build \
  --build-arg "OPENHANDS_BASE_IMAGE=$base_image" \
  --tag "$image_tag" \
  --file "$build_root/case-builder-agent/Dockerfile.openhands" \
  "$build_root/case-builder-agent"

image_id="$(docker image inspect "$image_tag" --format '{{.Id}}')"
architecture="$(docker image inspect "$image_tag" --format '{{.Architecture}}')"
if [ "$architecture" != "amd64" ]; then
  echo "Case Builder OpenHands image architecture is $architecture; this host requires amd64" >&2
  exit 1
fi
image_ref="${image_tag}@${image_id}"
temp_env="$data_root/.case-builder-agent.env.$commit"
sudo -n awk -v image="$image_ref" '
  BEGIN { found = 0 }
  /^CASE_BUILDER_OPENHANDS_IMAGE=/ { print "CASE_BUILDER_OPENHANDS_IMAGE=" image; found = 1; next }
  { print }
  END { if (!found) print "CASE_BUILDER_OPENHANDS_IMAGE=" image }
' "$case_builder_env_file" | sudo -n install -o root -g root -m 0600 /dev/stdin "$temp_env"
sudo -n mv -f -- "$temp_env" "$case_builder_env_file"
rm -rf -- "$build_root"

echo "Case Builder OpenHands image configured: $image_ref"
