#!/usr/bin/env bash
set -euo pipefail

source_dir=/opt/music-quiz/source
releases_dir=/opt/music-quiz/releases

cd "$source_dir"
git fetch origin main
git pull --ff-only origin main
commit_sha=$(git rev-parse HEAD)
release_dir="$releases_dir/$commit_sha"

# Video is staged separately from Git. Verify it before publishing the matching UI.
if [ -f deploy/video-media.sha256 ]; then
  install -d -m 755 /opt/music-quiz/media
  while read -r expected_hash media_name; do
    [[ "$expected_hash" =~ ^[a-f0-9]{64}$ && "$media_name" =~ ^[a-zA-Z0-9_-]+\.mp4$ ]] || exit 1
    destination="/opt/music-quiz/media/$media_name"
    if ! printf '%s  %s\n' "$expected_hash" "$destination" | sha256sum --check --status 2>/dev/null; then
      staged="/var/tmp/music-quiz-upload/$media_name"
      printf '%s  %s\n' "$expected_hash" "$staged" | sha256sum --check --status
      install -m 644 "$staged" "$destination.pending"
      printf '%s  %s\n' "$expected_hash" "$destination.pending" | sha256sum --check --status
      mv -f "$destination.pending" "$destination"
    fi
  done < deploy/video-media.sha256
fi

if [ -f "$release_dir/server.js" ]; then
  exit 0
fi

npm ci
npm run build
node scripts/check-data-artifacts.mjs .next/standalone .

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
