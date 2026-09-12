#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

commit="${1:?commit SHA is required}"
repo_root="${ZHIXING_REPO_ROOT:-/home/ubuntu/knowing-doing-repo}"
repo_url="${ZHIXING_REPO_URL:-https://github.com/Nai1ve/Knowing-Doing.git}"
release_root="${ZHIXING_RELEASE_ROOT:-/home/ubuntu/knowing-doing-releases}"
current_link="${ZHIXING_APP_ROOT:-/home/ubuntu/knowing-doing-current}"
data_root="${ZHIXING_DATA_ROOT:-/home/ubuntu/knowing-doing-data}"
release_dir="$release_root/$commit"
archive_path="${ZHIXING_RELEASE_ARCHIVE:-}"
case_builder_env_file="$data_root/case-builder-agent.env"
commit_archive_path="$release_root/.incoming-$commit.tar.gz"

# A first-time manual clone may leave the repository one level below the
# configured root when that root already exists. Reuse that checkout instead
# of failing before the controlled fetch/commit verification can run.
if [ ! -e "$repo_root/.git" ] && [ -e "$repo_root/Knowing-Doing/.git" ]; then
  repo_root="$repo_root/Knowing-Doing"
fi

read_env_value() {
  local key="$1" file="$2"
  sudo -n awk -v key="$key" \
    'index($0, key "=") == 1 { print substr($0, length(key) + 2); found = 1; exit }
     END { exit found ? 0 : 1 }' "$file"
}

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

install_release_archive() {
  local archive="$1"
  local strip_components="${2:-0}"
  local staging_dir="$release_root/.incoming-$commit"

  rm -rf -- "$staging_dir"
  mkdir -p "$staging_dir"
  if [ "$strip_components" -eq 1 ]; then
    tar -xzf "$archive" --strip-components=1 -C "$staging_dir"
  else
    tar -xzf "$archive" -C "$staging_dir"
  fi
  if [ ! -f "$staging_dir/backend/package.json" ]; then
    echo "Source archive does not contain backend/package.json: $archive" >&2
    rm -rf -- "$staging_dir"
    return 1
  fi
  if [ -e "$release_dir" ] || [ -L "$release_dir" ]; then
    rm -rf -- "$release_dir"
  fi
  mv "$staging_dir" "$release_dir"
}

prepare_case_builder_image() {
  if [ ! -f "$case_builder_env_file" ]; then
    echo "Missing Case Builder environment file: $case_builder_env_file" >&2
    exit 1
  fi

  local image_ref
  image_ref="$(read_env_value CASE_BUILDER_OPENHANDS_IMAGE "$case_builder_env_file" || true)"
  case "$image_ref" in
    *@sha256:*) ;;
    *) echo 'CASE_BUILDER_OPENHANDS_IMAGE must be a digest-pinned local image reference' >&2; exit 1 ;;
  esac

  docker image inspect "$image_ref" --format '{{.Id}}' >/dev/null 2>&1 || {
    echo "Prebuilt Case Builder OpenHands image is missing on this host: $image_ref" >&2
    echo 'Run deploy/setup-case-builder-agent.sh on the deployment host before enabling the Builder.' >&2
    exit 1
  }
  if [ "$(docker image inspect "$image_ref" --format '{{.Architecture}}')" != amd64 ]; then
    echo 'Prebuilt Case Builder OpenHands image must be amd64 on this host.' >&2
    exit 1
  fi
  echo "Using prebuilt Case Builder OpenHands image: $image_ref"
}

ensure_server_docker_images() {
  local image
  local required_images=(zhixing-python-pytest-v1:local zhixing-go-test-v1:local zhixing-workspace-runner:server)
  if sudo -n grep -q '^CASE_BUILDER_ENABLED=true$' /etc/knowing-doing/backend.env; then
    required_images+=(zhixing-case-builder-agent:server)
  fi
  for image in "${required_images[@]}"; do
    docker image inspect "$image" --format '{{.Id}}' >/dev/null 2>&1 || {
      echo "Required server-managed Docker image is missing: $image" >&2
      echo 'Run deploy/setup-docker-environment.sh on the deployment host before deploying.' >&2
      exit 1
    }
  done
}

mkdir -p "$release_root" "$data_root"

if [ ! -f "$release_dir/backend/package.json" ]; then
  if [ -n "$archive_path" ]; then
    install_release_archive "$archive_path"
  else
    if [ ! -d "$repo_root/.git" ]; then
      if [ -e "$repo_root" ]; then
        echo "Deployment repository path exists but is not a Git checkout: $repo_root" >&2
        exit 1
      fi
      echo "Cloning deployment repository from $repo_url"
      mkdir -p "$(dirname "$repo_root")"
      git clone --origin origin "$repo_url" "$repo_root"
    else
      if git -C "$repo_root" remote get-url origin >/dev/null 2>&1; then
        git -C "$repo_root" remote set-url origin "$repo_url"
      else
        git -C "$repo_root" remote add origin "$repo_url"
      fi
    fi
    if fetch_main; then
      git -C "$repo_root" cat-file -e "$commit^{commit}"
      mkdir -p "$release_dir"
      git -C "$repo_root" archive "$commit" | tar -x -C "$release_dir"
    else
      echo "Git fetch unavailable; falling back to the exact commit archive." >&2
      fetch_commit_archive
      install_release_archive "$commit_archive_path" 1
    fi
  fi
fi

if [ -n "$archive_path" ]; then
  rm -f -- "$archive_path"
fi
rm -f -- "$commit_archive_path"

cd "$release_dir/backend"
npm ci --ignore-scripts
npm run build
cd "$release_dir/frontend"
npm ci --ignore-scripts
npm run build
if [ ! -f "$data_root/zhixing-product.db" ]; then
  echo "Missing product database: $data_root/zhixing-product.db" >&2
  exit 1
fi

cd "$release_dir/backend"
NODE_ENV=production ZHIXING_PRODUCT_DB_PATH="$data_root/zhixing-product.db" npm run db:migrate

if sudo -n grep -q '^CASE_BUILDER_ENABLED=true$' /etc/knowing-doing/backend.env; then
  prepare_case_builder_image
fi
ensure_server_docker_images

cd "$release_dir/deploy"
if sudo -n docker compose version >/dev/null 2>&1; then
  compose=(docker compose -f docker-compose.production.yml)
elif command -v docker-compose >/dev/null 2>&1; then
  compose=(docker-compose -f docker-compose.production.yml)
else
  echo "Docker Compose is not installed" >&2
  exit 1
fi
if sudo -n grep -q '^CASE_BUILDER_ENABLED=true$' /etc/knowing-doing/backend.env; then
  sudo -n "${compose[@]}" up -d workspace-runner case-builder-agent
else
  sudo -n "${compose[@]}" stop case-builder-agent >/dev/null 2>&1 || true
  sudo -n "${compose[@]}" up -d workspace-runner
fi

ln -sfn "$release_dir" "$current_link"

sudo -n install -d -m 0755 /etc/knowing-doing
sudo -n install -m 0644 "$release_dir/deploy/knowing-doing.service" /etc/systemd/system/knowing-doing.service
sudo -n install -m 0644 "$release_dir/deploy/nginx-knowing-doing.conf" /etc/nginx/sites-enabled/default
sudo -n systemctl daemon-reload
sudo -n nginx -t
sudo -n systemctl enable knowing-doing.service >/dev/null
sudo -n systemctl restart knowing-doing.service
sudo -n systemctl reload nginx

for attempt in $(seq 1 30); do
  if curl --fail --silent --show-error http://127.0.0.1:3001/api/product/runtime-status >/dev/null; then
    exit 0
  fi
  sleep 2
done

echo "API did not become ready" >&2
sudo -n journalctl -u knowing-doing.service -n 80 --no-pager >&2 || true
exit 1
