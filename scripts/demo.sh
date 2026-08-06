#!/usr/bin/env bash
# Launch the CLI against a throwaway portal and project, so README screenshots
# show real screens without exposing real account names or ids.
#
#   npm run build && ./scripts/demo.sh
#
# Everything lives under a temp directory: no real config, repo or portal is
# touched, and the fake accounts cannot reach HubSpot.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO="${HSDM_DEMO_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/hsdm-demo.XXXXXX")}"

mkdir -p "$DEMO/home/.hscli" "$DEMO/project/db"

cat > "$DEMO/home/.hscli/config.yml" <<'YAML'
defaultAccount: 12345678
accounts:
  - name: pied-piper
    accountId: 12345678
    authType: personalaccesskey
  - name: pied-piper-sandbox
    accountId: 12345679
    authType: personalaccesskey
  - name: hooli
    accountId: 23456789
    authType: personalaccesskey
  - name: aviato
    accountId: 34567890
    authType: personalaccesskey
YAML

cat > "$DEMO/project/paths-config.json" <<'JSON'
{
  "portals": {
    "pied-piper-12345678": {
      "paths": ["/pied-piper-theme", "/marketing/landing-pages"]
    }
  }
}
JSON

cat > "$DEMO/project/db/deploy-history.json" <<'JSON'
{
  "deploys": [
    {
      "timestamp": "2026-08-05 17:01:40",
      "portal": "pied-piper",
      "portal_id": "12345678",
      "message": "feat(hubspot): deploy 3 file(s) to pied-piper",
      "status": "success",
      "file_count": 3,
      "files": [
        "src/pied-piper-12345678/pied-piper-theme/modules/hero.module/module.html",
        "src/pied-piper-12345678/pied-piper-theme/modules/hero.module/fields.json",
        "src/pied-piper-12345678/pied-piper-theme/css/main.css"
      ]
    },
    {
      "timestamp": "2026-08-04 09:12:05",
      "portal": "pied-piper",
      "portal_id": "12345678",
      "message": "fix(hubspot): correct pricing table spacing",
      "status": "partial",
      "file_count": 1,
      "files": ["src/pied-piper-12345678/pied-piper-theme/templates/pricing.html"]
    }
  ]
}
JSON

SCOPE="$DEMO/project/src/pied-piper-12345678/pied-piper-theme"
mkdir -p "$SCOPE/modules/hero.module" "$SCOPE/templates" "$SCOPE/css"
printf '{%% if module.heading %%}\n  <h1>{{ module.heading }}</h1>\n{%% endif %%}\n' > "$SCOPE/modules/hero.module/module.html"
printf '[]\n' > "$SCOPE/modules/hero.module/fields.json"
printf '<div class="pricing"></div>\n' > "$SCOPE/templates/pricing.html"
printf '.body { color: #111; }\n' > "$SCOPE/css/main.css"

cd "$DEMO/project"
git init --quiet
git -c user.name=Demo -c user.email=demo@example.com add . >/dev/null
git -c user.name=Demo -c user.email=demo@example.com commit --quiet -m "demo project"

echo "demo portal + project ready in $DEMO" >&2
echo "screenshots should show 'pied-piper', never a real account" >&2

# The fake accounts cannot answer, so skip the remote check instead of waiting
# for it to fail.
HOME="$DEMO/home" HSDM_NO_REMOTE_CHECK=1 exec node "$ROOT/dist/cli.js" "$@"
