# Cloudflare Pages 部署指南

## 问题描述

原始构建错误：
```
cp: cannot overwrite non-directory '/opt/buildhome/repo/node_modules/./@types/node' with directory '/opt/buildhome/repo/_tmp_node_modules/./@types/node'
Error: Exit with error code: 1
```

## 原因

Cloudflare Pages 的构建环境有预先存在的 `node_modules` 目录（通过 npm 安装的文件），当 pnpm 尝试安装时，会创建目录来覆盖文件，导致冲突。

## 解决方案

### 方案 1：使用 Cloudflare Pages 环境变量（推荐）

在 Cloudflare Pages 控制台中设置以下环境变量：

1. **Build command**:
   ```
   pnpm install --force && pnpm build
   ```

2. **Environment variables**:
   - `NODE_VERSION`: `20`
   - `PNPM_HOME`: `/opt/buildhome/.cache/pnpm`
   - `PNPM_VERSION`: `10.11.0`
   - `NPM_CONFIG_IGNORE_SCRIPTS`: `false`

### 方案 2：使用自定义构建配置

在项目中已经创建了以下配置文件：

1. `.npmrc` - pnpm 配置，强制覆盖现有文件
2. `.cloudflare/wrangler.toml` - Cloudflare Pages 构建配置

### 方案 3：清理后重新构建

如果方案 1 和 2 不起作用，可以在构建命令中先删除 node_modules：

```bash
rm -rf node_modules && pnpm install && pnpm build
```

或者使用更激进的方式：

```bash
rm -rf node_modules _tmp_node_modules && pnpm install --force && pnpm build
```

## 重要说明

这个项目主要是：
- 一个 npm 包 (`@pilio/gemini-watermark-remover`)
- 一个在线工具网站 (`public/` 目录)
- Tampermonkey 用户脚本
- Chrome 扩展

如果只需要部署在线工具网站，可以：

1. 仅将 `public/` 目录部署到 Cloudflare Pages
2. 或者将整个 `dist/` 目录（构建输出）部署为静态网站

## 部署步骤

### 步骤 1：连接 GitHub 仓库

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 "Workers & Pages"
3. 点击 "Create application"
4. 选择 "Pages" -> "Connect to Git"
5. 选择你的 GitHub 仓库

### 步骤 2：配置构建设置

在 "Set up builds and deployments" 页面：

- **Production branch**: `main` (或你的主分支)
- **Build command**: `pnpm install --force && pnpm build`
- **Build output directory**: `dist`

### 步骤 3：添加环境变量（可选）

在 "Environment variables" 部分添加：

| Variable name | Value |
|--------------|-------|
| `NODE_VERSION` | `20` |
| `PNPM_VERSION` | `10.11.0` |

### 步骤 4：部署

点击 "Save and Deploy"

## 故障排除

### 如果仍然出现 node_modules 冲突

尝试在构建命令中添加清理步骤：

```bash
rm -rf node_modules pnpm-lock.yaml && pnpm install && pnpm build
```

### 如果 pnpm 未安装

Cloudflare Pages 默认可能没有 pnpm。可以在构建命令中先安装 pnpm：

```bash
npm install -g pnpm@latest && pnpm install && pnpm build
```

### 如果 sharp 构建失败

sharp 是可选依赖。如果在构建环境中遇到问题，可以：

1. 将 `sharp` 从 `devDependencies` 移到 `optionalDependencies`
2. 或在构建命令中忽略 sharp：

```bash
pnpm install --ignore-scripts && pnpm build
```

然后在运行时环境中单独安装 sharp。

## 验证部署

部署成功后，访问你的 Cloudflare Pages 域名，应该能看到在线工具网站。

## 相关链接

- [Cloudflare Pages 文档](https://developers.cloudflare.com/pages/)
- [pnpm 文档](https://pnpm.io/)
- [项目 GitHub 仓库](https://github.com/GargantuaX/gemini-watermark-remover)
