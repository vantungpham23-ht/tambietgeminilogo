#!/bin/bash
# Cloudflare Pages 构建脚本
# 
# 这个脚本用于解决 Cloudflare Pages 环境中的 node_modules 冲突问题
# 
# 使用方法：
# 在 Cloudflare Pages 构建设置中使用：
#   bash scripts/cloudflare-build.sh

set -e

echo "🔧 Starting Cloudflare Pages build..."

# 记录当前状态
echo "📂 Current directory: $(pwd)"
echo "📊 Node version: $(node --version)"
echo "📊 npm version: $(npm --version)"

# 检查是否安装了 pnpm
if ! command -v pnpm &> /dev/null; then
    echo "⚠️ pnpm not found, installing..."
    npm install -g pnpm@10.11.0
fi

echo "📊 pnpm version: $(pnpm --version)"

# 清理可能存在的冲突文件
echo "🧹 Cleaning existing node_modules..."
rm -rf node_modules
rm -rf _tmp_node_modules
rm -rf .pnpm-store

# 使用 --force 强制覆盖安装
echo "📦 Installing dependencies with pnpm..."
pnpm install --force

# 构建项目
echo "🔨 Building project..."
pnpm build

echo "✅ Build complete!"
echo "📁 Output directory: dist/"
ls -la dist/ | head -20
