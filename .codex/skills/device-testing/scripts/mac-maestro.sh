#!/usr/bin/env bash
set -euo pipefail
if [ $# -ne 3 ]; then
  echo "usage: mac-maestro.sh <simulator-udid> <flow.yaml> <local output dir>" >&2
  exit 2
fi
udid=$1 flow=$2 out=$3
host=maddisenmohnsen@macbook
remote=/tmp/maestro-$(date +%s)-$$
mkdir -p "$out"
ssh "$host" "mkdir -p $remote"
scp -q "$flow" "$host:$remote/flow.yaml"
cat > "$out/.run.sh" <<RUN
#!/bin/bash
~/.maestro/bin/maestro --device $udid test --test-output-dir $remote/out $remote/flow.yaml 2>&1 | tail -20
mkdir -p $remote/shots
find $remote/out -name '*.png' -path '*takeScreenshot*' -exec cp {} $remote/shots/ \;
RUN
scp -q "$out/.run.sh" "$host:$remote/run.sh"
rm "$out/.run.sh"
ssh "$host" "bash $remote/run.sh"
scp -q "$host:$remote/shots/*.png" "$out/" 2>/dev/null || echo "no screenshots taken"
ssh "$host" "rm -rf $remote"
