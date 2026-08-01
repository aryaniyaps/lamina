#!/bin/sh
set -u

ready_file=$1
release_file=$2
temporary_directory=$3
shift 3

exec 3<> "$release_file"
set -- $(stat -f -c '%T %S %b %c' "$temporary_directory") "$@"
filesystem_type=$1
block_size=$2
blocks=$3
inodes=$4
shift 4
printf '{"filesystem_type":"%s","block_size":%s,"blocks":%s,"inodes":%s}\n' \
  "$filesystem_type" "$block_size" "$blocks" "$inodes" > "$ready_file"
IFS= read -r _release <&3
exec 3>&-
exec "$@"
