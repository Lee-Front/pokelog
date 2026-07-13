#!/usr/bin/env bash
# pokelog blue-green 무중단 배포 (사내 서버 172.16.250.142, root 컨텍스트).
#
# 토폴로지: nginx `upstream pokelog_up`(conf.d/pokelog-bg.conf)이 활성 색(blue=3000 / green=3010)을
# 가리킨다. 외부 `/engine/`(nginx.conf)와 포털 app-config(`http://127.0.0.1:3300/api/v1`)가 그 upstream을
# 향하므로 색 전환이 투명하다. 두 색은 같은 pokelog-data를 공유하지만 크로스프로세스 파일락(withLock →
# xproc-lock)이 동시 RMW를 직렬화해 겹쳐도 안전하다.
#
# 절차: idle 색을 새 빌드로 (재)기동 → 헬스체크 → pokelog_up 포트 전환 + nginx reload(무중단) → 이전 색 정지.
# 색깔 프로세스 env(JWT_SECRET/ADMIN_KEY/RATE_LIMIT)는 서버의 /home/withflow/pokelog/.env.bg 에서 온다
# (비밀은 서버에만; git 미포함). PORT env로 색깔별 포트를 준다(index.ts가 PORT 우선).
set -e
source ~/.nvm/nvm.sh 2>/dev/null || true
cd /home/withflow/pokelog
NODEBIN="$(command -v node)"
CONF=/etc/nginx/conf.d/pokelog-bg.conf

ACTIVE_PORT=$(grep -oE '127\.0\.0\.1:(3000|3010)' "$CONF" | grep -oE '3000|3010' | head -1)
if [ "$ACTIVE_PORT" = "3000" ]; then NEW=green; NEW_PORT=3010; OLD=blue;  OLD_PORT=3000
else                                 NEW=blue;  NEW_PORT=3000; OLD=green; OLD_PORT=3010; fi
echo "== active=$ACTIVE_PORT($OLD) -> deploy $NEW($NEW_PORT) =="

echo "== git pull =="; git pull --ff-only origin refactor/codebase-cleanup
echo "== npm install =="; npm install
echo "== build =="; npm run build -w packages/server

echo "== (re)start idle color $NEW($NEW_PORT) with new build =="
set -a; . /home/withflow/pokelog/.env.bg; set +a
if pm2 describe pokelog-$NEW >/dev/null 2>&1; then
  PORT=$NEW_PORT pm2 restart pokelog-$NEW --update-env
else
  PORT=$NEW_PORT pm2 start /home/withflow/pokelog/packages/server/dist/packages/server/src/index.js \
    --name pokelog-$NEW --interpreter "$NODEBIN" --cwd /home/withflow/pokelog
fi
pm2 save

echo "== healthcheck $NEW_PORT (max 60s) =="
ok=0
for i in $(seq 1 60); do
  code=$(curl -s -m3 -o /dev/null -w '%{http_code}' http://127.0.0.1:$NEW_PORT/api/v1/meta || true)
  [ "$code" = "200" ] && { ok=1; echo "$NEW healthy ($code) @${i}s"; break; }
  sleep 1
done
if [ "$ok" != 1 ]; then echo "HEALTHCHECK FAILED (last=$code) — abort; $OLD still active"; exit 1; fi

echo "== switch pokelog_up -> $NEW_PORT + reload (무중단) =="
cp "$CONF" "/tmp/pokelog-bg.conf.bak" 2>/dev/null || true
sed -i "s/127\.0\.0\.1:$OLD_PORT/127.0.0.1:$NEW_PORT/" "$CONF"
nginx -t
nginx -s reload

echo "== drain then stop $OLD =="
sleep 5
pm2 stop pokelog-$OLD 2>/dev/null || true
pm2 save
echo "== HEAD =="; git -C /home/withflow/pokelog log -1 --oneline
echo "POKELOG_BG_DEPLOY_DONE ($NEW active on $NEW_PORT)"
