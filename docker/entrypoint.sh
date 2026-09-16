#!/bin/sh
set -eu

export PORT="${NODE_PORT:-3000}"
export HOST="${HOST:-127.0.0.1}"

node --no-warnings /app/dist-server/index.js &
node_pid="$!"

nginx -g "daemon off;" &
nginx_pid="$!"

shutdown() {
  trap - INT TERM
  kill "$node_pid" "$nginx_pid" 2>/dev/null || true
  wait "$node_pid" 2>/dev/null || true
  wait "$nginx_pid" 2>/dev/null || true
}

trap 'shutdown; exit 143' INT TERM

while kill -0 "$node_pid" 2>/dev/null && kill -0 "$nginx_pid" 2>/dev/null; do
  sleep 1
done

shutdown
exit 1
