#!/bin/bash
# BAKSS Kite League — One-command GitHub Pages deploy
# Run this from the bakss-kite-league folder:  bash DEPLOY.sh YOUR_GITHUB_USERNAME

USERNAME=${1:-"YOUR_GITHUB_USERNAME"}
REPO="bakss-kite-league"

echo "🚀 Deploying BAKSS Kite League to GitHub Pages..."

# Init git if needed
git init 2>/dev/null
git checkout -b main 2>/dev/null || git checkout main 2>/dev/null

# Stage all files
git add -A
git commit -m "🪁 BAKSS Kite League Manager — production deploy"

# Create repo on GitHub (requires gh CLI)
if command -v gh &> /dev/null; then
  gh repo create $REPO --public --source=. --remote=origin --push
  echo ""
  echo "✅ Deployed! Enable GitHub Pages:"
  echo "   → Go to: https://github.com/$USERNAME/$REPO/settings/pages"
  echo "   → Source: GitHub Actions"
  echo "   → Your app will be at: https://$USERNAME.github.io/$REPO/"
else
  echo "📋 Manual steps:"
  echo "  1. Create repo at: https://github.com/new (name: $REPO, public)"
  echo "  2. Run: git remote add origin https://github.com/$USERNAME/$REPO.git"
  echo "  3. Run: git push -u origin main"
  echo "  4. Go to Settings → Pages → Source: GitHub Actions"
  echo "  5. Your URL: https://$USERNAME.github.io/$REPO/"
fi
