#!/usr/bin/env bash
# dist/ 를 gh-pages 브랜치로 게시하고 GitHub Pages 를 활성화합니다.
#   사용법: ./scripts/deploy-gh-pages.sh [owner/repo] [브랜치]
#   전제: 해당 저장소에 push 권한이 있는 GitHub 연결(Pickle GitHub 앱 또는 로그인된 gh)
set -euo pipefail

REPO="${1:-hw3238/bitget-signal-scanner}"
BRANCH="${2:-gh-pages}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="$HOME/.local/node/node-v22.14.0-linux-x64/bin:$PATH"

echo "== 1/4 저장소 접근 확인: $REPO"
if ! gh repo view "$REPO" --json nameWithOwner,visibility >/dev/null 2>&1; then
  echo "!! 저장소를 볼 수 없습니다. 저장소가 없거나 GitHub 앱 설치 범위에 없습니다." >&2
  gh repo list --limit 30 || true
  exit 1
fi

echo "== 2/4 빌드"
# 코인 로고 아이콘을 최신 유니버스로 갱신(실패해도 기존 아이콘으로 빌드)
npm run icons || echo "(아이콘 갱신 생략 — 기존 public/coin-icons 사용)"
npm run build

echo "== 3/4 $BRANCH 브랜치 게시"
STAGE=".tmp/gh-pages"
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -R dist/. "$STAGE"/
touch "$STAGE/.nojekyll"
(
  cd "$STAGE"
  git init -q
  git checkout -q -b "$BRANCH"
  git add -A
  git -c user.name="bitget-signal-scanner" -c user.email="deploy@local" \
      commit -qm "deploy: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  git push -f "https://github.com/${REPO}.git" "$BRANCH"
)

echo "== 4/4 GitHub Pages 활성화"
gh api -X POST "repos/${REPO}/pages" \
  -f "source[branch]=${BRANCH}" -f "source[path]=/" >/dev/null 2>&1 \
  || gh api -X PUT "repos/${REPO}/pages" \
       -f "source[branch]=${BRANCH}" -f "source[path]=/" >/dev/null 2>&1 \
  || echo "(Pages API 권한이 없으면 저장소 Settings → Pages 에서 Branch: ${BRANCH} / (root) 를 선택하세요)"

OWNER="${REPO%%/*}"
NAME="${REPO##*/}"
SITE="https://${OWNER,,}.github.io/${NAME}/"
echo "== 배포 URL: $SITE"
for i in $(seq 1 20); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "$SITE" || true)"
  echo "   [$i] HTTP $CODE"
  [ "$CODE" = "200" ] && break
  sleep 10
done
