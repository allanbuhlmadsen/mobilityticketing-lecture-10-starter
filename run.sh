#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

usage() {
  cat >&2 <<'USAGE'
Usage: bash run.sh up | down | check
       bash run.sh status [mongo1|mongo2|mongo3]
       bash run.sh write ID majority|1|3
       bash run.sh read ID primary|secondary
       bash run.sh verify ID [ID...]
IDs: 1-80 letters, numbers, dots, underscores or hyphens; start with a letter/number.
USAGE
  exit 2
}
valid_id() { [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$ ]] || usage; }
[[ $# -gt 0 ]] || usage
action=$1; shift
ids= setting= member=mongo1
case "$action" in
  up|down|check) [[ $# -eq 0 ]] || usage ;;
  status)
    [[ $# -le 1 ]] || usage
    member=${1:-mongo1}
    [[ "$member" =~ ^mongo[123]$ ]] || usage ;;
  write|read)
    [[ $# -eq 2 ]] || usage
    valid_id "$1"; ids=$1; setting=$2
    if [[ "$action" == write ]]; then
      [[ "$setting" == majority || "$setting" == 1 || "$setting" == 3 ]] || usage
    else
      [[ "$setting" == primary || "$setting" == secondary ]] || usage
    fi ;;
  verify)
    [[ $# -ge 1 ]] || usage
    for id in "$@"; do valid_id "$id"; done
    ids=$(IFS=,; echo "$*") ;;
  *) usage ;;
esac
command -v docker >/dev/null || { echo 'Docker is required.' >&2; exit 2; }
docker compose version >/dev/null
case "$action" in
  up)
    docker compose up -d --wait --wait-timeout 90 mongo1 mongo2 mongo3 client
    docker compose exec -T client mongosh --quiet --nodb --file /lab/scripts/init.js ;;
  down) docker compose down ;;
  check) docker compose exec -T client mongosh --quiet --nodb --file /lab/scripts/check.js ;;
  *) docker compose exec -T -e LAB_ACTION="$action" -e LAB_IDS="$ids" \
       -e LAB_SETTING="$setting" -e LAB_MEMBER="$member" \
       client mongosh --quiet --nodb --file /lab/scripts/runner.js ;;
esac
