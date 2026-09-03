#!/usr/bin/env bash
set -euo pipefail

domain=${1:-quiz.lamtyugin.com}
repository=${2:-https://github.com/etoleha/music-quiz.git}

if [ "$(id -u)" -ne 0 ]; then
  echo "Запусти установку через sudo."
  exit 1
fi
if [[ ! "$domain" =~ ^[a-zA-Z0-9.-]+$ ]]; then
  echo "Некорректный домен."
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl git nginx apache2-utils sqlite3

node_major=0
if command -v node >/dev/null 2>&1; then
  node_major=$(node --version | sed -E 's/^v([0-9]+).*/\1/')
fi
if [ "$node_major" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/music-quiz-nodesource.sh
  bash /tmp/music-quiz-nodesource.sh
  apt-get install -y nodejs
fi

if ! id musicquiz >/dev/null 2>&1; then
  useradd --system --home /var/lib/music-quiz --shell /usr/sbin/nologin musicquiz
fi
install -d -o musicquiz -g musicquiz -m 750 /var/lib/music-quiz
install -d -m 755 /opt/music-quiz/releases

if [ ! -d /opt/music-quiz/source/.git ]; then
  git clone "$repository" /opt/music-quiz/source
else
  git -C /opt/music-quiz/source pull --ff-only origin main
fi

chmod 755 /opt/music-quiz/source/deploy/update.sh /opt/music-quiz/source/deploy/backup.sh
cp /opt/music-quiz/source/deploy/music-quiz.service /etc/systemd/system/
cp /opt/music-quiz/source/deploy/music-quiz-update.service /etc/systemd/system/
cp /opt/music-quiz/source/deploy/music-quiz-update.timer /etc/systemd/system/
cp /opt/music-quiz/source/deploy/music-quiz-backup.service /etc/systemd/system/
cp /opt/music-quiz/source/deploy/music-quiz-backup.timer /etc/systemd/system/
sed "s/__DOMAIN__/$domain/g" /opt/music-quiz/source/deploy/nginx.conf.template > /etc/nginx/sites-available/music-quiz
ln -sfn /etc/nginx/sites-available/music-quiz /etc/nginx/sites-enabled/music-quiz

echo "Задай пароль для личной части сайта:"
htpasswd -c /etc/nginx/.htpasswd-music-quiz alexey

systemctl daemon-reload
systemctl enable music-quiz.service music-quiz-update.timer music-quiz-backup.timer
/opt/music-quiz/source/deploy/update.sh
nginx -t
systemctl reload nginx
systemctl start music-quiz-update.timer music-quiz-backup.timer

echo "Сайт установлен. После настройки DNS открой: https://$domain"
