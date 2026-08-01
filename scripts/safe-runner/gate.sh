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
shift 9

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

runner_root=$(CDPATH= cd -- "$(dirname "$quota_gate")/../.." && pwd -P)
dependency_parent=$runner_root
while [ ! -d "$dependency_parent/node_modules" ]; do
  parent=$(dirname "$dependency_parent")
  if [ "$parent" = "$dependency_parent" ]; then
    echo 'safe-runner dependency root is unavailable' >&2
    exit 125
  fi
  dependency_parent=$parent
done
dependency_root=$dependency_parent/node_modules

bwrap --unshare-user --uid 0 --gid 0 \
  --ro-bind / / --dev-bind /dev /dev --proc /proc \
  --bind "$payload_cwd" "$payload_cwd" \
  --ro-bind "$runner_root/scripts/safe-runner" "$runner_root/scripts/safe-runner" \
  --ro-bind "$runner_root/packages/cli" "$runner_root/packages/cli" \
  --ro-bind "$dependency_root" "$dependency_root" \
  --ro-bind "$runner_root/tests/fixtures" "$runner_root/tests/fixtures" \
  --bind "$quota_ready_file" "$quota_ready_file" \
  --size "$temporary_max_bytes" --tmpfs "$temporary_directory" \
  --chdir "$payload_cwd" -- \
  /bin/sh "$quota_gate" "$quota_ready_file" "$quota_release_file" "$temporary_directory" "$@" &
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
