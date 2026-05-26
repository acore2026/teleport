#!/bin/sh
set -eu

export PORT="${NODE_PORT:-3000}"
export HOST="${HOST:-127.0.0.1}"

node --no-warnings /app/dist-server/server.js &
node_pid="$!"

term() {
  kill "$node_pid" 2>/dev/null || true
  wait "$node_pid" 2>/dev/null || true
}

trap term INT TERM

nginx -g "daemon off;" &
nginx_pid="$!"

wait "$nginx_pid"
term
