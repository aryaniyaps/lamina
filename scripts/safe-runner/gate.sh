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
bwrap_executable=${12}
bwrap_identity=${13}
execution_authority=${14}
oracle_launcher=${15}
oracle_authority=${16}
oracle_env=${17}
oracle_cwd=${18}
shift 18

if [ "$#" -eq 0 ]; then
  echo 'safe-runner gate requires READY RELEASE PAYLOAD_EXIT COMMAND [ARGS]' >&2
  exit 125
fi

rm -f "$release_file"
mkfifo -m 600 "$release_file"
exec 3<> "$release_file"
rm -f "$quota_release_file"
mkfifo -m 600 "$quota_release_file"
: > "$quota_ready_file"
printf '{"pid":%s}\n' "$$" > "$ready_file"
trap 'exit 143' TERM
trap 'exit 130' INT
IFS= read -r _release <&3
exec 3>&-

if [ -n "$oracle_launcher" ] || [ -n "$oracle_authority" ] || [ -n "$oracle_env" ] || [ -n "$oracle_cwd" ]; then
  if [ -z "$oracle_launcher" ] || [ -z "$oracle_authority" ] || [ -z "$oracle_env" ] || [ -z "$oracle_cwd" ]; then
    echo 'safe-runner oracle-host gate received an incomplete sealed profile' >&2
    exit 125
  fi
  cd "$oracle_cwd" || exit 125
  "$oracle_env" -i LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC \
    "$node_executable" "$oracle_launcher" "$oracle_authority" &
else
  LAMINA_SAFE_QUOTA_GATE=$quota_gate LAMINA_SAFE_TEMP_MAX_BYTES=$temporary_max_bytes \
    "$node_executable" "$sandbox_launcher" "$bwrap_executable" "$bwrap_identity" "$execution_authority" "$payload_cwd" "$quota_ready_file" \
    "$quota_release_file" "$temporary_directory" "$@" &
fi
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
