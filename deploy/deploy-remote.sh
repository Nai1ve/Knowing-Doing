#!/usr/bin/env bash
set -Eeuo pipefail

commit="${1:?commit SHA is required}"
repo_root="${ZHIXING_REPO_ROOT:-/home/ubuntu/Knowing-Doing}"
release_root="${ZHIXING_RELEASE_ROOT:-/home/ubuntu/knowing-doing-releases}"
current_link="${ZHIXING_APP_ROOT:-/home/ubuntu/knowing-doing-current}"
data_root="${ZHIXING_DATA_ROOT:-/home/ubuntu/knowing-doing-data}"
release_dir="$release_root/$commit"

mkdir -p "$release_root" "$data_root"
git -C "$repo_root" fetch --quiet origin "$commit"

if [ ! -d "$release_dir" ]; then
  mkdir -p "$release_dir"
  git -C "$repo_root" archive "$commit" | tar -x -C "$release_dir"
fi

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
