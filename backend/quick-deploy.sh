#!/bin/bash
# 一键部署脚本 - 最省心版本

echo "🚀 Flight Alert API - 一键部署"
echo ""

# 1. 检查并登录
echo "📝 步骤1: 检查 CloudBase 登录状态..."
if ! cloudbase user:info &> /dev/null; then
    echo "⚠️  未登录，正在打开浏览器登录..."
    cloudbase login --mode=web
    echo "✅ 登录完成！"
else
    echo "✅ 已登录"
fi

# 2. 部署服务
echo ""
echo "📦 步骤2: 部署服务到 CloudRun..."
echo "  环境: cloud1-d3gu5h3dk5e16d52b"
echo "  服务: flight-alert-api"
echo ""

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="$PROJECT_DIR/cloudbaserc.json"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "❌ 未找到 $CONFIG_FILE"
    exit 1
fi

ENV_PARAMS="$(node -e '
const fs = require("fs");
const config = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const env = config?.cloudrun?.envVariables || {};
process.stdout.write(
  Object.entries(env)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("&")
);
' "$CONFIG_FILE")"

cd "$PROJECT_DIR"
cloudbase -e cloud1-d3gu5h3dk5e16d52b run service:deploy \
    --serviceName flight-alert-api \
    --path ./ \
    --containerPort 8787 \
    --envParams "$ENV_PARAMS"

echo ""
echo "✅ 部署完成！"
echo ""
echo "🔍 查看服务状态："
cloudbase -e cloud1-d3gu5h3dk5e16d52b run service:list | grep flight-alert-api
