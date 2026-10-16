#!/usr/bin/env bash
# Public repo hygiene: no private paths, personal names, server addresses or secrets.
# Usage: privacy-scan.sh [repo-dir]   (default: this repository; the self-test passes a temp repo)
set -uo pipefail
cd "${1:-$(dirname "$0")/..}" || exit 2
# Byte-wise matching: identical results on every machine; non-ASCII letters are spelled out.
export LC_ALL=C
status=0
check() { # <label> <grep flags: "" or -i> <extended regex> [allowlist extended regex, group 1 = leading boundary]
    # With an allowlist, each hit line is re-checked after the allowed matches are
    # removed from it, so an allowed value never hides a real one on the same line.
    # The scanner and its self-test are excluded: they contain the patterns on purpose.
    local hits line rest
    hits=$(git ls-files -z | xargs -0 grep -nIE $2 -e "$3" -- 2>/dev/null \
        | grep -vE '^scripts/privacy-scan(\.test)?\.sh:')
    if [ -n "$hits" ] && [ -n "${4:-}" ]; then
        hits=$(printf '%s\n' "$hits" | while IFS= read -r line; do
            rest=${line#*:*:}
            # (BSD sed has no \b: the allowlist regex carries its own boundaries; the trailing
            # boundary is consumed, so a second pass catches back-to-back allowed values.)
            if printf '%s\n' "$rest" | sed -E "s#$4#\1 #g; s#$4#\1 #g" | grep -qE $2 -e "$3"; then
                printf '%s\n' "$line"
            fi
        done)
    fi
    if [ -n "$hits" ]; then echo "== $1"; echo "$hits"; status=1; fi
}

# A path segment like feature/home/... is not a home directory, so /home/ and /users/
# must start a path (line start, whitespace, quote, '=' or '(' before it). /Users/ and
# C:\Users\ are matched anywhere.
# Allowlist: /home/dev/ is the generic placeholder in a test fixture's local.properties
# (packages/core/test/support/seedTemplate.js), not a real user's home.
check 'private path' '' '/Users/|C:\\Users\\|(^|[[:space:]"'"'"'`=(])/(home|users)/[a-z]' '(=)/home/dev/'

# Case-insensitive; Turkish letters spelled out because LC_ALL=C folds ASCII only.
# Allowlist (case-sensitive, exact):
#   Keremturker/cmpose       the MCP Registry name io.github.Keremturker/cmpose (mcpName, server.json),
#                            which stays when the repositories move to whinstudio/
#   Keremturker/cmpose-template, Keremturker/cmpose-game-template  the template snapshots' former
#                            address (GitHub redirects it; published releases still clone it);
#                            CmpTemplate its private source; any other Keremturker/<repo> is still reported
#   com.kturker / com/kturker / com.kturker:  the template's own package and Maven group
#                            (com.kturker.multiplatform, com.kturker:networkmonitor), also
#                            regex-escaped in tests (com\.kturker, com\/kturker)
#   'kturker'                path segment of that package in a test (path.join('com', 'kturker'))
#   Kturker                  the template's identifier as a whole word, standalone or as the
#                            Kturker.UnityBase namespace prefix (Unity template); Keremturker, Turker, Kerem stay reported
NAME_ALLOW='(^|[^A-Za-z0-9_])(Keremturker/(CmpTemplate|cmpose-template|cmpose-game-template|cmpose)|com\\?[./:]kturker|'"'"'kturker'"'"'|Kturker)([^A-Za-z0-9_-]|$)'
check 'personal name' '-i' 'kerem|t(u|ü|Ü)rker' "$NAME_ALLOW"

# IPv4 allowlist (addresses that can never point at a real server):
#   192.0.2.x, 198.51.100.x, 203.0.113.x  documentation ranges (RFC 5737), used in tests
#   127.x.x.x                            loopback, used in tests
#   <Key>Version: 1.0.0.0                a dotted version quad as the value of a YAML key that is one word
#                                        ending in Version, at the start of the line (Unity ProjectSettings'
#                                        XboxOneVersion:), not an address; 'Server Version: 8.8.8.8' or a
#                                        'Version:' later in a line is still reported
#   d="M…"                               an SVG path's data (docs/guide.html icons: '1.41.39.39' is four
#                                        coordinates); the rest of the line is still checked
IPV4_ALLOW='(^|[^0-9.])((192\.0\.2|198\.51\.100|203\.0\.113)\.[0-9]{1,3}|127\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})([^0-9.]|$)|^[[:space:]]*[A-Za-z0-9_]*Version:[[:space:]]*([0-9]{1,3}\.){3}[0-9]{1,3}([^0-9.]|$)|([[:space:]<])d="M[^"]*"'
check 'IPv4 address' '' '\b([0-9]{1,3}\.){3}[0-9]{1,3}\b' "$IPV4_ALLOW"

# A 40-hex literal looks like a git commit and may name an object of a private repository.
# Allowlist: a synthetic value of one repeated character (e.g. 'a'.repeat(40), forty zeros).
# Any other value needs its own commented entry here (none today). Longer hex runs
# (sha256 and the like) are not matched.
HEX40='(^|[^0-9A-Fa-f])[0-9A-Fa-f]{40}([^0-9A-Fa-f]|$)'
HEX_ALLOW='(^|[^0-9A-Fa-f])('
for c in 0 1 2 3 4 5 6 7 8 9 a b c d e f A B C D E F; do HEX_ALLOW="$HEX_ALLOW$c{40}|"; done
HEX_ALLOW="${HEX_ALLOW%|})([^0-9A-Fa-f]|\$)"
check 'commit hash' '' "$HEX40" "$HEX_ALLOW"

check 'secret-looking value' '' '(ghp_|github_pat_|(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|xox[abprs]-|AIza[0-9A-Za-z_-]{35})'
check 'backend audit branch' '' 'audit/[a-z]'
check 'private backend marker' '' 'HANDOFF\.md|\.superpowers|Cmp-wizard-backend'
# The old cmpose domain lapses (anyone may register it): nothing published may name it
check 'old domain' '-i' 'cmpose\.dev'

if command -v gitleaks >/dev/null 2>&1; then
    gitleaks detect --no-banner --redact -s . || status=1
else
    echo "(gitleaks not installed: pattern checks only)"
fi
[ "$status" -eq 0 ] && echo "PRIVACY OK"
exit "$status"
