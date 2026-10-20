#!/bin/sh
# Manual smoke test on Linux: start server, list drives, scan home, trash a temp folder.
set -e
N=${NODE:-node}
DATA=$(mktemp -d); export WEGWISCH_DATA=$DATA
$N bin/wegwisch.js --no-open --port 4799 & PID=$!
sleep 2
H='x-wegwisch: 1'
curl -s -H "$H" localhost:4799/api/drives; echo
curl -s -H "$H" localhost:4799/api/state; echo
mkdir -p $HOME/wegwisch-smoke/sub && echo hi > $HOME/wegwisch-smoke/sub/f.txt
curl -s -X POST -H "$H" -d '{"items":[{"path":"'"$HOME"'/wegwisch-smoke"},{"path":"/etc"},{"path":"'"$HOME"'"}]}' localhost:4799/api/delete; echo
ls -d $HOME/wegwisch-smoke 2>/dev/null && echo "STILL THERE" || echo "trashed ok"
curl -s -H "$H" "localhost:4799/api/junk"; echo
kill $PID; rm -rf "$DATA"
