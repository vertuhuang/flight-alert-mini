#!/bin/bash
# 一键部署后端服务到 CloudRun
# 使用方法: ./deploy.sh

set -e  # 遇到错误立即退出

echo "🚀 开始部署 flight-alert-api 到 CloudRun..."

# 检查 cloudbase CLI
if ! command -v cloudbase &> /dev/null; then
    echo "❌ 错误: 未找到 cloudbase CLI，请先安装: npm install -g @cloudbase/cli"
    exit 1
fi

# 检查登录状态
echo "📝 检查 CloudBase 登录状态..."
if ! cloudbase user:info &> /dev/null; then
    echo "⚠️  未登录 CloudBase，正在进行交互式登录..."
    cloudbase login
fi

# 读取配置
ENV_ID="cloud1-d3gu5h3dk5e16d52b"
SERVICE_NAME="flight-alert-api"
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="$PROJECT_DIR/cloudbaserc.json"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "❌ 错误: 未找到 $CONFIG_FILE"
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

echo "📋 部署配置:"
echo "  环境 ID: $ENV_ID"
echo "  服务名称: $SERVICE_NAME"
echo "  项目目录: $PROJECT_DIR"
echo "  环境变量来源: $CONFIG_FILE"
echo ""

# 执行部署
echo "🔨 开始部署..."
cd "$PROJECT_DIR"

cloudbase -e "$ENV_ID" run service:deploy \
    --serviceName "$SERVICE_NAME" \
    --path "./" \
    --containerPort "8787" \
    --envParams "$ENV_PARAMS" \
    --noConfirm \
    --dockerfile "Dockerfile"

echo ""
echo "✅ 部署完成！"
echo ""
echo "📊 查看服务状态:"
echo "   cloudbase -e $ENV_ID run service:list"
echo ""
echo "🔍 查看服务日志:"
echo "   请在 CloudBase 控制台查看: https://console.cloud.tencent.com/tcb"
