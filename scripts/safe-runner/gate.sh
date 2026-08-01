#!/bin/sh
set -u

ready_file=$1
release_file=$2
payload_exit_file=$3
quota_ready_file=$4
quota_release_file=$5
temporary_directory=$6
temporary_max_bytes=$7
payload_cwd=$8
quota_gate=$9
node_executable=${10}
sandbox_launcher=${11}
shift 11

if [ "$#" -eq 0 ]; then
  echo 'safe-runner gate requires READY RELEASE PAYLOAD_EXIT COMMAND [ARGS]' >&2
  exit 125
fi

rm -f "$release_file"
mkfifo -m 600 "$release_file"
rm -f "$quota_release_file"
mkfifo -m 600 "$quota_release_file"
: > "$quota_ready_file"
printf '{"pid":%s}\n' "$$" > "$ready_file"
trap 'exit 143' TERM
trap 'exit 130' INT
IFS= read -r _release < "$release_file"

LAMINA_SAFE_QUOTA_GATE=$quota_gate LAMINA_SAFE_TEMP_MAX_BYTES=$temporary_max_bytes \
  "$node_executable" "$sandbox_launcher" "$payload_cwd" "$quota_ready_file" \
  "$quota_release_file" "$temporary_directory" "$@" &
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
