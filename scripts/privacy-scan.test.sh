#!/usr/bin/env bash
# Self-test for privacy-scan.sh: plants one line per pattern in a throwaway git repo and
# checks the scan reports each, then checks a repo with only allowed values passes.
# This file contains the patterns on purpose; privacy-scan.sh excludes it from the real
# scan the same way it excludes itself. Secrets are assembled from pieces so no complete
# token-looking string is stored here.
set -uo pipefail
SCAN="$(cd "$(dirname "$0")" && pwd)/privacy-scan.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
fail=0
X30=abcdefghijklmnopqrstuvwxyz0123
X35=abcdefghijklmnopqrstuvwxyz012345678

repo() { mkdir -p "$TMP/$1" && git -C "$TMP/$1" init -q; }
plant() { # <repo> <file> <line>
    printf '%s\n' "$3" > "$TMP/$1/$2" && git -C "$TMP/$1" add -- "$2"
}

# File names differ in more than case (macOS file systems are case-insensitive).
# --- every pattern must be reported -------------------------------------------------
repo bad
plant bad 'name with space.txt' 'see /Users/x/project'
plant bad lower-users.txt       'cd /users/bob'
plant bad windows-users.txt     'C:\Users\bob\project'
plant bad home.txt              'path = "/home/alice/x"'
plant bad name-kerem-lower.txt        'written by kerem'
plant bad name-kerem-upper.txt        'KEREM'
plant bad name-tuerker-title.txt      'Türker'
plant bad name-tuerker-lower.txt      'türker'
plant bad name-tuerker-upper.txt      'TÜRKER'
plant bad name-turker-ascii.txt       'turker'
plant bad template-fork.txt       'Keremturker/CmpTemplate-fork'
plant bad bare-kturker.txt        'user kturker'
plant bad other-repo.txt        'git clone Keremturker/Cmp-wizard-backend'
plant bad cmpose-fork.txt       'Keremturker/cmpose-private'
plant bad commit-hash.txt       "commit: '0123456789abcdef0123456789abcdef01234567'"
plant bad ipv4.txt              'host 10.1.2.3 next to 203.0.113.9'
plant bad ipv4-next-to-svg.txt  '<path d="M1 2c.55 0 1.41.39.39 1"/> host 10.1.2.3'
plant bad ipv4-after-version.txt 'XboxOneVersion: 1.0.0.0 and host 10.1.2.3'
plant bad ipv4-spaced-key.txt   'Server Version: 8.8.8.8'
plant bad ipv4-mid-line.txt     'note: see Version: 8.8.8.8'
plant bad name-kerem-near-kturker.txt 'Kturker.UnityBase by Kerem'
plant bad name-keremturker-bare.txt 'Keremturker'
plant bad secret-ant.txt        "key=sk-""ant-api03-$X30"
plant bad secret-proj.txt       "key=sk-""proj-$X30"
plant bad secret-slack.txt      "xox""b-123-456"
plant bad secret-google.txt     "AI""za$X35"
plant bad secret-ghp.txt        "gh""p_$X30"
plant bad secret-aws.txt        "AK""IAABCDEFGHIJKLMNOP"
plant bad branch.txt            'branch audit/some-package'
plant bad marker-handoff.txt    'read HANDOFF.md first'
plant bad marker-superpowers.txt 'see .superpowers/sdd'
out=$(bash "$SCAN" "$TMP/bad"); code=$?
if [ "$code" -ne 1 ]; then echo "FAIL: bad repo exited $code, expected 1"; fail=1; fi
for f in 'name with space.txt' lower-users.txt windows-users.txt home.txt name-kerem-lower.txt \
         name-kerem-upper.txt name-tuerker-title.txt name-tuerker-lower.txt name-tuerker-upper.txt name-turker-ascii.txt \
         name-kerem-near-kturker.txt name-keremturker-bare.txt ipv4-after-version.txt ipv4-spaced-key.txt ipv4-mid-line.txt template-fork.txt bare-kturker.txt other-repo.txt cmpose-fork.txt commit-hash.txt ipv4.txt ipv4-next-to-svg.txt secret-ant.txt secret-proj.txt secret-slack.txt \
         secret-google.txt secret-ghp.txt secret-aws.txt branch.txt marker-handoff.txt \
         marker-superpowers.txt; do
    printf '%s\n' "$out" | grep -qF -- "$f:1:" || { echo "FAIL: not reported: $f"; fail=1; }
done
for label in 'private path' 'personal name' 'IPv4 address' 'secret-looking value' \
             'backend audit branch' 'private backend marker' 'commit hash'; do
    printf '%s\n' "$out" | grep -qxF -- "== $label" || { echo "FAIL: no section: $label"; fail=1; }
done
# The other repo is a backend marker as well as a name
printf '%s\n' "$out" | sed -n '/^== private backend marker$/,/^==/p' | grep -qF 'other-repo.txt:1:' \
    || { echo "FAIL: other-repo.txt not reported as backend marker"; fail=1; }

# --- only allowed values: must pass ---------------------------------------------------
repo clean
plant clean allowed.txt "$(printf '%s\n' \
    '<path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 1.41.39.39 1.41-.39.39"/>' \
    "repo: 'Keremturker/CmpTemplate' and 'Keremturker/cmpose-template'" \
    'url https://github.com/Keremturker/cmpose.git and https://github.com/Keremturker/cmpose#readme' \
    "synthetic commits 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' and '0000000000000000000000000000000000000000'" \
    'sha256 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' \
    'package com.kturker.multiplatform' \
    'assert.match(x, /com\.kturker\.multiplatform and com\/kturker\/multiplatform/)' \
    'dir com/kturker/multiplatform and module com.kturker:networkmonitor' \
    "path.join('com', 'kturker')" \
    'namespace Kturker.UnityBase.Core and "Kturker"' \
    'loopback 127.0.0.1 and docs 192.0.2.4, 198.51.100.7, 203.0.113.45' \
    'sdk.dir=/home/dev/Android/sdk' \
    'feature/home/presentation' \
    'ca-app-pub-3940256099942544~3347511713')"
plant clean version-quad.txt "$(printf '%s\n' 'XboxOneVersion: 1.0.0.0' '  Version: 2.0.0.0' '  bundleVersion:   1.2.3.4')"
out=$(bash "$SCAN" "$TMP/clean"); code=$?
if [ "$code" -ne 0 ] || ! printf '%s\n' "$out" | grep -qxF 'PRIVACY OK'; then
    echo "FAIL: clean repo exited $code:"; printf '%s\n' "$out"; fail=1
fi

[ "$fail" -eq 0 ] && echo "SCAN SELF-TEST OK"
exit "$fail"
