# Cloudflare Pages 部署快速指南

## 问题

原始构建错误：
```
cp: cannot overwrite non-directory '/opt/buildhome/repo/node_modules/./@types/node' 
with directory '/opt/buildhome/repo/_tmp_node_modules/./@types/node'
```

## 解决方案

### 方法 1：在 Cloudflare Pages 控制台配置（最简单）

1. 进入 Cloudflare Dashboard → Workers & Pages → 你的项目
2. 点击 "Settings" → "Builds and deployments"
3. 修改以下设置：

**Build command:**
```bash
pnpm install --force && pnpm build
```

**Build output directory:**
```
dist
```

**Environment variables (optional):**
- `NODE_VERSION`: `20`
- `PNPM_VERSION`: `10.11.0`

4. 点击 "Save" 并重新部署

### 方法 2：使用自定义构建脚本

1. 将 `scripts/cloudflare-build.sh` 推送到仓库
2. 在 Cloudflare Pages 控制台设置：

**Build command:**
```bash
bash scripts/cloudflare-build.sh
```

### 方法 3：使用 GitHub Actions（推荐用于自动化部署）

1. 在 GitHub 仓库设置以下 Secrets：
   - `CLOUDFLARE_API_TOKEN`: Cloudflare API Token
   - `CLOUDFLARE_ACCOUNT_ID`: Cloudflare Account ID

2. 推送代码，GitHub Actions 将自动部署

## 已创建的文件

```
├── .cloudflare/
│   └── wrangler.toml          # Cloudflare Pages 配置
├── .github/
│   └── workflows/
│       └── cloudflare-pages.yml  # GitHub Actions 工作流
├── scripts/
│   └── cloudflare-build.sh    # 自定义构建脚本
├── .npmrc                     # pnpm 配置
├── .gitignore                 # Git 忽略文件
└── CLOUDFLARE_PAGES_DEPLOY.md # 详细部署文档
```

## 验证

部署成功后，访问你的 Cloudflare Pages URL，应该能看到在线水印去除工具。

## 故障排除

如果仍然失败，尝试在 Build command 中添加完整的清理步骤：

```bash
rm -rf node_modules && npm install -g pnpm@10.11.0 && pnpm install && pnpm build
```
