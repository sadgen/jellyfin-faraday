#!/usr/bin/env bash
# =============================================================================
# Setup Git Remotes for Gitea (Internal) & GitHub (Public/Private)
# =============================================================================

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# Install pre-commit hook
echo "📦 Installing pre-commit privacy check hook..."
mkdir -p .git/hooks
chmod +x scripts/pre-commit-check.sh
ln -sf "../../scripts/pre-commit-check.sh" ".git/hooks/pre-commit"
echo "✅ Pre-commit hook installed."

# Gitea remote (Private/Self-hosted - pass as argument $1 or configure in local git)
GITEA_URL="${1:-ssh://git@your-gitea-server.example.com:2226/sadgen/jellyfin-faraday.git}"
# GitHub remote (pass as argument $2 or default)
GITHUB_URL="${2:-git@github.com:sadgen/jellyfin-faraday.git}"

echo "🔧 Configuring Remotes..."
if git remote | grep -q "^gitea$"; then
  git remote set-url gitea "$GITEA_URL"
else
  git remote add gitea "$GITEA_URL" 2>/dev/null || true
fi

if git remote | grep -q "^github$"; then
  git remote set-url github "$GITHUB_URL"
else
  git remote add github "$GITHUB_URL" 2>/dev/null || true
fi

# Configure dual-push remote 'all'
if git remote | grep -q "^all$"; then
  git remote remove all
fi
git remote add all "$GITEA_URL"
git remote set-url --add --push all "$GITEA_URL"
git remote set-url --add --push all "$GITHUB_URL"

echo "✅ Git Remotes configured successfully!"
git remote -v
