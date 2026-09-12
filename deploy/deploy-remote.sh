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
default_case_builder_base_image='ghcr.io/openhands/openhands@sha256:392743af9edb3e6b407f57a64815006859d2feb9178ff1a3404c69e17c0f749f'
case_builder_env_file="$data_root/case-builder-agent.env"

# A first-time manual clone may leave the repository one level below the
# configured root when that root already exists. Reuse that checkout instead
# of failing before the controlled fetch/commit verification can run.
if [ ! -e "$repo_root/.git" ] && [ -e "$repo_root/Knowing-Doing/.git" ]; then
  repo_root="$repo_root/Knowing-Doing"
fi

read_env_value() {
  local key="$1" file="$2" line
  while IFS= read -r line; do
    case "$line" in
      "$key="*) printf '%s' "${line#*=}"; return 0 ;;
    esac
  done < "$file"
  return 1
}

build_case_builder_image() {
  if [ ! -f "$release_dir/case-builder-agent/Dockerfile.openhands" ]; then
    echo "Missing OpenHands build recipe in $release_dir" >&2
    exit 1
  fi
  if [ ! -f "$case_builder_env_file" ]; then
    echo "Missing Case Builder environment file: $case_builder_env_file" >&2
    exit 1
  fi

  local base_image image_tag image_id image_ref temp_env
  base_image="$(read_env_value CASE_BUILDER_OPENHANDS_BASE_IMAGE "$case_builder_env_file" || true)"
  base_image="${base_image:-$default_case_builder_base_image}"
  case "$base_image" in
    *@sha256:*) ;;
    *) echo 'CASE_BUILDER_OPENHANDS_BASE_IMAGE must be digest-pinned' >&2; exit 1 ;;
  esac

  image_tag='zhixing-openhands-local:current'
  echo "Building Case Builder image from digest-pinned OpenHands base on the deployment host"
  docker build --pull \
    --build-arg "OPENHANDS_BASE_IMAGE=$base_image" \
    --tag "$image_tag" \
    --file "$release_dir/case-builder-agent/Dockerfile.openhands" \
    "$release_dir/case-builder-agent"
  image_id="$(docker image inspect "$image_tag" --format '{{.Id}}')"
  image_ref="${image_tag}@${image_id}"
  temp_env="${case_builder_env_file}.tmp.${commit}"
  awk -v image="$image_ref" '
    BEGIN { found = 0 }
    /^CASE_BUILDER_OPENHANDS_IMAGE=/ { print "CASE_BUILDER_OPENHANDS_IMAGE=" image; found = 1; next }
    { print }
    END { if (!found) print "CASE_BUILDER_OPENHANDS_IMAGE=" image }
  ' "$case_builder_env_file" > "$temp_env"
  chmod 0600 "$temp_env"
  mv -f -- "$temp_env" "$case_builder_env_file"
  docker image prune --force --filter 'label=zhixing.component=case-builder-agent' >/dev/null || true
  echo "Case Builder image ready: $image_ref"
}

mkdir -p "$release_root" "$data_root"

if [ ! -f "$release_dir/backend/package.json" ]; then
  if [ -n "$archive_path" ]; then
    staging_dir="$release_root/.incoming-$commit"
    rm -rf -- "$staging_dir"
    mkdir -p "$staging_dir"
    tar -xzf "$archive_path" -C "$staging_dir"
    if [ -e "$release_dir" ] || [ -L "$release_dir" ]; then
      rm -rf -- "$release_dir"
    fi
    mv "$staging_dir" "$release_dir"
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
    git -C "$repo_root" fetch --quiet origin main
    git -C "$repo_root" cat-file -e "$commit^{commit}"
    mkdir -p "$release_dir"
    git -C "$repo_root" archive "$commit" | tar -x -C "$release_dir"
  fi
fi

if [ -n "$archive_path" ]; then
  rm -f -- "$archive_path"
fi

cd "$release_dir/backend"
npm ci --ignore-scripts
npm run build
cd "$release_dir/frontend"
npm ci --ignore-scripts
npm run build
cd "$release_dir/workspace-runner"
npm ci --ignore-scripts
npm run build
WORKSPACE_PYTHON_IMAGE=zhixing-python-pytest-v1:local ./build-template.sh

if [ ! -f "$data_root/zhixing-product.db" ]; then
  echo "Missing product database: $data_root/zhixing-product.db" >&2
  exit 1
fi

cd "$release_dir/backend"
NODE_ENV=production ZHIXING_PRODUCT_DB_PATH="$data_root/zhixing-product.db" npm run db:migrate

if grep -q '^CASE_BUILDER_ENABLED=true$' /etc/knowing-doing/backend.env; then
  build_case_builder_image
fi

cd "$release_dir/deploy"
if docker compose version >/dev/null 2>&1; then
  compose=(docker compose -f docker-compose.production.yml)
elif command -v docker-compose >/dev/null 2>&1; then
  compose=(docker-compose -f docker-compose.production.yml)
else
  echo "Docker Compose is not installed" >&2
  exit 1
fi
if grep -q '^CASE_BUILDER_ENABLED=true$' /etc/knowing-doing/backend.env; then
  "${compose[@]}" up -d --build workspace-runner case-builder-agent
else
  "${compose[@]}" stop case-builder-agent >/dev/null 2>&1 || true
  "${compose[@]}" up -d --build workspace-runner
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
