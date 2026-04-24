# Flight Alert Mini

`Flight Alert Mini` 是一个基于微信小程序的机票价格提醒项目骨架，支持两种接入方式：

- 本地联调：小程序直接请求本机 Node 服务
- 微信云托管：小程序通过 `wx.cloud.callContainer` 调用云托管容器

## 项目结构

- `backend`：抓价、任务管理、价格对比、PushPlus 通知、云托管部署文件
- `miniprogram`：微信小程序端，负责任务创建、查看和手动触发检查

## 当前能力

- 创建单程或往返监控任务
- 从携程最低价接口拉取价格
- 本地模式可保存到 JSON 文件；云托管模式可切到 CloudBase 数据库
- 阈值变动时生成事件，并可选发送 PushPlus 通知
- 小程序查看任务列表、任务详情、历史记录、手动检查

## 运行模式

### 1. 微信云托管模式

这是当前默认模式。

小程序通过 `wx.cloud.callContainer` 发请求，不需要配置 request 合法域名。CloudBase 官方文档说明见：

- 微信小程序访问云托管：<https://docs.cloudbase.net/run/develop/access/mini>
- 服务开发说明：<https://docs.cloudbase.net/run/develop/developing-guide>
- 从源代码部署：<https://docs.cloudbase.net/run/deploy/deploy/deploying-source-code>

你需要在 [miniprogram/app.js](/Users/vertu.huang/flight-alert-mini/miniprogram/app.js:1) 配置：

- `runtimeMode: "cloud"`
- `cloudEnv`: 你的云开发环境 ID，当前项目已回填为 `cloud1-d3gu5h3dk5e16d52b`
- `cloudService`: 云托管服务名，本文档默认使用 `flight-alert-api`

后端部署时，建议环境变量至少配置：

- `STORE_DRIVER=cloudbase`
- `CLOUDBASE_ENV_ID=<你的云开发环境 ID>`

这会让服务把任务、历史、事件写进 CloudBase 数据库，而不是写本地 JSON 文件。

### 2. 本地联调模式

如果你只是先在开发者工具里调接口，把 [miniprogram/app.js](/Users/vertu.huang/flight-alert-mini/miniprogram/app.js:1) 改成：

```js
runtimeMode: "local"
```

然后使用本地 Node 服务。

## 本地启动

### 1. 启动后端

```bash
cd backend
npm start
```

默认监听 `http://127.0.0.1:8787`。

### 2. 打开微信开发者工具

将 `miniprogram` 目录导入为小程序项目。

`project.config.json` 里放的是占位 `appid`，你需要替换成自己的测试号或正式小程序 `appid`。

### 3. 本地调试设置

开发者工具里勾选 `开发环境不校验请求域名、TLS版本及HTTPS证书` 后，可直接联调本地服务。

使用真机调试时，不要填 `127.0.0.1`，而要改成你电脑的局域网 IP。

## 云托管部署

### 1. 安装依赖

```bash
cd backend
npm install
```

### 2. 准备部署配置

后端目录已经包含：

- [backend/Dockerfile](/Users/vertu.huang/flight-alert-mini/backend/Dockerfile:1)
- [backend/.dockerignore](/Users/vertu.huang/flight-alert-mini/backend/.dockerignore:1)

云托管官方要求源代码部署必须包含 `Dockerfile`，并且服务要监听 `PORT` 环境变量；当前项目已经适配。参考：

- `PORT` 监听要求：<https://docs.cloudbase.net/run/develop/developing-guide>
- 源代码部署要求：<https://docs.cloudbase.net/run/deploy/deploy/deploying-source-code>

### 3. 在云托管控制台创建服务

推荐参数：

- 服务名称：`flight-alert-api`
- 部署方式：本地代码上传
- 代码目录：`backend`
- Dockerfile：`backend/Dockerfile`
- 端口：`3000`
- 访问方式：如果只给小程序调，优先选小程序内网访问或关闭公网后只走 `callContainer`

### 4. 配置环境变量

至少配置：

```bash
STORE_DRIVER=cloudbase
CLOUDBASE_ENV_ID=你的云开发环境 ID
```

可选：

```bash
TASKS_COLLECTION=flight_alert_tasks
HISTORIES_COLLECTION=flight_alert_histories
EVENTS_COLLECTION=flight_alert_events
```

### 5. 配置小程序

把 [miniprogram/app.js](/Users/vertu.huang/flight-alert-mini/miniprogram/app.js:1) 里的这几项改成你的真实值：

```js
runtimeMode: "cloud",
cloudEnv: "你的云开发环境 ID",
cloudService: "flight-alert-api"
```

### 6. 关联云开发环境

确保小程序已经和目标云开发环境关联，否则 `callContainer` 调不到服务。CloudBase 文档里说明了这是前置条件：
<https://docs.cloudbase.net/run/develop/access/mini>

## 后端接口

- `GET /api/health`
- `GET /api/tasks`
- `POST /api/tasks`
- `GET /api/tasks/:id`
- `PATCH /api/tasks/:id`
- `POST /api/tasks/:id/check-now`
- `GET /api/tasks/:id/history`

## 说明

- 这个项目参考了原始仓库的思路，但代码是重新组织的新实现。
- 航司/OTA 接口随时可能调整，生产环境建议加缓存、限流、鉴权和告警。
- 小程序前端不应该直接调用抓价接口，也不应该直接持有通知密钥，所以后端是必要的。
- 云托管是无状态运行环境，官方要求不要依赖实例本地永久状态；因此云托管部署时建议使用 `STORE_DRIVER=cloudbase`，不要继续用本地 JSON 文件。
