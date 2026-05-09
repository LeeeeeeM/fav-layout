#!/bin/sh
set -e

PORT="${PORT:-8383}"
export PORT

/app/server &
SERVER_PID=$!

openresty -g 'daemon off;' &
NGINX_PID=$!

term_handler() {
  kill "$SERVER_PID" "$NGINX_PID" 2>/dev/null || true
}

trap term_handler TERM INT

while kill -0 "$SERVER_PID" 2>/dev/null && kill -0 "$NGINX_PID" 2>/dev/null; do
  sleep 1
done

term_handler
wait "$SERVER_PID" 2>/dev/null || true
wait "$NGINX_PID" 2>/dev/null || true
