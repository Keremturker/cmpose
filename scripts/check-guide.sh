#!/usr/bin/env bash
# docs/guide.html: every in-page link (#id, ?section=id, an enabled sidebar data-target) names an
# element id, and every local asset the page loads exists under docs/.
# Usage: check-guide.sh [docs dir]. Exit 0 ok ("GUIDE OK"), 1 problems (one "FAIL: ..." line each).
set -uo pipefail
D="${1:-$(cd "$(dirname "$0")/.." && pwd)/docs}"
G="$D/guide.html"
[ -f "$G" ] || { echo "FAIL: $G is missing"; exit 1; }
fail=0
ids="$(grep -oE 'id="[^"]+"' "$G" | sed -E 's/^id="(.*)"$/\1/' | sort -u)"
refs="$( { grep -oE 'href="(guide\.html)?(\?[^"#]*)?#[^"]+"' "$G" | sed -E 's/.*#([^"]+)"$/\1/'
           grep -oE '[?&]section=[A-Za-z0-9_-]+' "$G" | sed -E 's/.*=//'
           grep -vE 'sidebar-item disabled' "$G" | grep -oE 'data-target="[^"]+"' | sed -E 's/^data-target="(.*)"$/\1/'
         } | sort -u)"
for r in $refs; do
  grep -qxF -- "$r" <<<"$ids" || { echo "FAIL: link to '$r' has no id=\"$r\""; fail=1; }
done
for a in $(grep -oE '(src|href)="assets/[^"]+"' "$G" | sed -E 's/^[a-z]+="(.*)"$/\1/' | sort -u); do
  [ -f "$D/$a" ] || { echo "FAIL: $a is missing under $(basename "$D")/"; fail=1; }
done
[ "$fail" -eq 0 ] && echo "GUIDE OK"
exit "$fail"
