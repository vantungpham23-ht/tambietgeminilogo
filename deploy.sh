#!/bin/bash
set -e

echo "🔨 Building..."
pnpm build

echo "🧹 Cleaning..."
cd dist
rm -f README.md README_zh.md DEPLOY_*.md
ls -la

echo "🚀 Pushing to gh-pages branch..."
cd ..
# Add dist files to a separate branch
git branch -D gh-pages 2>/dev/null || true
git checkout --orphan gh-pages
git --work-tree dist add --all
git --work-tree dist commit -m "deploy: $(date +'%Y-%m-%d %H:%M:%S')"
git push origin HEAD:gh-pages --force
git checkout main

echo "✅ Done!"