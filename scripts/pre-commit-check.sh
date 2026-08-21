#!/usr/bin/env bash
# =============================================================================
# Pre-Commit Privacy & Secret Checker
# Prevents accidental commits of private domains, internal IPs, or Jellyfin tokens
# =============================================================================

# Sensitive regex patterns to check against codebase (excluding this check script itself)
SENSITIVE_PATTERNS=(
  "your-private-domain\.example"
  "192\.168\."
  "api_key=[a-zA-Z0-9]{15,}"
  "token=[a-zA-Z0-9]{15,}"
)

HAS_ERROR=0

# Get list of staged files excluding this script
STAGED_FILES=$(git diff --cached --name-only | grep -v "scripts/pre-commit-check.sh" || true)

if [ -n "$STAGED_FILES" ]; then
  for pattern in "${SENSITIVE_PATTERNS[@]}"; do
    MATCHES=$(git diff --cached -- "$STAGED_FILES" | grep -E "^\+[[:space:]]*.*$pattern" || true)
    if [ -n "$MATCHES" ]; then
      echo -e "\033[31m[PRIVACY SECURITY ALERT] Detected potential secret/private domain pattern: '$pattern'\033[0m"
      echo "$MATCHES"
      HAS_ERROR=1
    fi
  done
fi

if [ $HAS_ERROR -ne 0 ]; then
  echo -e "\033[33mCommit aborted. Please remove sensitive info or place it in .env.local / localStorage.\033[0m"
  exit 1
fi

exit 0
