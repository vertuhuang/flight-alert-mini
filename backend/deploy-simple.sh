#!/bin/bash

set -e

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

echo "🚀 开始部署到 CloudRun..."
cd "$PROJECT_DIR"
cloudbase run service:deploy \
cloudbase -e cloud1-d3gu5h3dk5e16d52b run service:deploy \
  --serviceName flight-alert-api \
  --path ./ \
  --containerPort 8787 \
  --envParams "$ENV_PARAMS"
echo "✅ 部署完成！"
