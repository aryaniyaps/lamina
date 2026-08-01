#!/bin/sh
set -u

ready_file=$1
release_file=$2
payload_exit_file=$3
shift 3

if [ "$#" -eq 0 ]; then
  echo 'safe-runner gate requires READY RELEASE PAYLOAD_EXIT COMMAND [ARGS]' >&2
  exit 125
fi

rm -f "$release_file"
mkfifo -m 600 "$release_file"
printf '{"pid":%s}\n' "$$" > "$ready_file"
trap 'exit 143' TERM
trap 'exit 130' INT
IFS= read -r _release < "$release_file"

"$@" &
payload_pid=$!
forward_term() { kill -TERM "$payload_pid" 2>/dev/null || true; }
forward_int() { kill -INT "$payload_pid" 2>/dev/null || true; }
trap forward_term TERM
trap forward_int INT

set +e
wait "$payload_pid"
payload_status=$?
set -e
printf '{"status":%s}\n' "$payload_status" > "$payload_exit_file"
exit "$payload_status"
