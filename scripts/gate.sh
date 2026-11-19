#!/usr/bin/env bash
# The release gate: everything CI checks, run locally and in the same order.
# Stops at the first failure. Test output is not piped anywhere, so a failing step
# fails the whole script (no `| tail` hiding an exit code).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

step() { printf '\n==> %s\n' "$1"; }

step "leak guard (sources)"
npm run leak-guard

step "typecheck"
npm run typecheck

step "unit tests"
npm test

step "e2e (builds first)"
npm run e2e

step "leak guard (sources and dist/)"
npm run leak-guard -- --dist

printf '\nGate passed.\n'
