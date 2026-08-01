#!/bin/sh
# Thin compatibility entrypoint. The guarded Node implementation owns all
# resource-intensive matrix work, so a forged PATH interpreter cannot approve
# a remaining shell body.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
exec node "$root/evals/hooks/compatibility-matrix.mjs" "$@"
