#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

repo_root="${ZHIXING_REPO_ROOT:-/home/ubuntu/knowing-doing-repo}"
repo_url="${ZHIXING_REPO_URL:-https://github.com/Nai1ve/Knowing-Doing.git}"
data_root="${ZHIXING_DATA_ROOT:-/home/ubuntu/knowing-doing-data}"
commit="${1:-}"
base_image="${CASE_BUILDER_OPENHANDS_BASE_IMAGE:-ghcr.io/openhands/openhands@sha256:392743af9edb3e6b407f57a64815006859d2feb9178ff1a3404c69e17c0f749f}"
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
  for attempt in 1 2 3; do
    if git -C "$repo_root" fetch --quiet origin main; then
      return 0
    fi
    sleep "$((attempt * 2))"
  done
  echo "Unable to fetch main from $repo_url after 3 attempts" >&2
  return 1
}

fetch_main
if [ -z "$commit" ]; then
  commit="$(git -C "$repo_root" rev-parse origin/main)"
fi
git -C "$repo_root" cat-file -e "${commit}^{commit}"

if ! sudo -n test -f "$case_builder_env_file"; then
  echo "Missing Case Builder environment file: $case_builder_env_file" >&2
  echo 'Install the runtime secrets first, then rerun this setup script.' >&2
  exit 1
fi

build_root="$data_root/.case-builder-image-$commit"
rm -rf -- "$build_root"
mkdir -p "$build_root"
git -C "$repo_root" archive "$commit" case-builder-agent | tar -x -C "$build_root"

echo "Building the OpenHands task image on the deployment host from $commit"
docker build --pull \
  --build-arg "OPENHANDS_BASE_IMAGE=$base_image" \
  --tag "$image_tag" \
  --file "$build_root/case-builder-agent/Dockerfile.openhands" \
  "$build_root/case-builder-agent"

image_id="$(docker image inspect "$image_tag" --format '{{.Id}}')"
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
