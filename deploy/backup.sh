#!/usr/bin/env bash
set -euo pipefail

database=/var/lib/music-quiz/quiz.sqlite
backup_dir=/var/backups/music-quiz

install -d -m 700 "$backup_dir"
if [ ! -f "$database" ]; then
  exit 0
fi

backup_file="$backup_dir/quiz-$(date +%F-%H%M%S).sqlite"
sqlite3 "$database" ".backup '$backup_file'"
chmod 600 "$backup_file"
find "$backup_dir" -type f -name 'quiz-*.sqlite' -mtime +30 -delete
