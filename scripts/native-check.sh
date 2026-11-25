#!/usr/bin/env bash
# 네이티브 순수 계산(진입 구간·반익절·수량 단위·본절 보호) 단위 검증 — v1.5.7
#   Android SDK 없이 JDK 만으로 컴파일·실행한다(javac/java).
#   실행: npm run check:native
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JAVA_HOME="${JAVA_HOME:-$HOME/.deps/jdk17/jdk-17.0.21.1+2}"
if [ ! -x "$JAVA_HOME/bin/javac" ]; then
  # 다른 경로의 JDK 17 도 허용
  if command -v javac >/dev/null 2>&1; then
    JAVA_BIN="$(dirname "$(command -v javac)")"
  else
    echo "!! JDK 17(javac)을 찾지 못했습니다. JAVA_HOME 을 지정해 주세요." >&2
    exit 1
  fi
else
  JAVA_BIN="$JAVA_HOME/bin"
fi

SRC="$ROOT/android/app/src/main/java/com/hw3238/bitgetscanner"
OUT="$ROOT/.tmp/native-check"
rm -rf "$OUT"
mkdir -p "$OUT"

"$JAVA_BIN/javac" -encoding UTF-8 -d "$OUT" \
  "$SRC/QtyStep.java" \
  "$SRC/EntryZoneRule.java" \
  "$SRC/PartialTpRule.java" \
  "$SRC/EarlyStopRule.java" \
  "$ROOT/scripts/native/PartialTpRuleTest.java" \
  "$ROOT/scripts/native/EntryZoneRuleTest.java"

"$JAVA_BIN/java" -Dfile.encoding=UTF-8 -cp "$OUT" com.hw3238.bitgetscanner.PartialTpRuleTest
"$JAVA_BIN/java" -Dfile.encoding=UTF-8 -cp "$OUT" com.hw3238.bitgetscanner.EntryZoneRuleTest
