#!/usr/bin/env bash
set -euo pipefail

source_dir=/opt/music-quiz/source
releases_dir=/opt/music-quiz/releases

cd "$source_dir"
git fetch origin main
git pull --ff-only origin main
commit_sha=$(git rev-parse HEAD)
release_dir="$releases_dir/$commit_sha"

if [ -f "$release_dir/server.js" ]; then
  exit 0
fi

npm ci
npm run build

install -d -m 755 "$release_dir"
cp -a .next/standalone/. "$release_dir/"
install -d -m 755 "$release_dir/.next"
cp -a .next/static "$release_dir/.next/static"
cp -a public "$release_dir/public"
chown -R musicquiz:musicquiz "$release_dir"

ln -sfn "$release_dir" /opt/music-quiz/current
systemctl restart music-quiz.service
for attempt in {1..20}; do
  if curl --fail --silent http://127.0.0.1:3100/api/health >/dev/null; then
    exit 0
  fi
  sleep 0.5
done

echo "Новая версия запущена, но проверка сайта не прошла."
exit 1
