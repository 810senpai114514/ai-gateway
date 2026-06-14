# MCP WebSocket RPC 部署模板

这组模板用于把 MCP Tool 通过 `WebSocket JSON-RPC` 远端调用，并且在握手时做鉴权。

## 文件说明

- `single-machine-toolhub.config.json`：单机 ToolHub（提供 MCP WS）
- `single-machine-edge-agent.config.json`：单机 Edge Agent（通过 WS 远端拉 Tool）
- `multi-machine-toolhub.config.json`：多机 ToolHub
- `multi-machine-edge-agent.config.json`：多机 Edge Agent

## 架构角色

- ToolHub：运行真实 MCP 工具（例如 filesystem），并对外暴露 `WS /mcp/ws`
- Edge Agent：不直连本地 MCP 进程，只通过 `agent.mcpServers.transport=websocket` 访问 ToolHub

## 单机快速启动（两进程）

1. 启动 ToolHub（端口 `3101`）

```bash
cp deploy/mcp-ws/single-machine-toolhub.config.json /tmp/toolhub.config.json
export GATEWAY_CONFIG_PATH=/tmp/toolhub.config.json
npm run build && node dist/index.js
```

2. 启动 Edge Agent（端口 `3100`）

```bash
cp deploy/mcp-ws/single-machine-edge-agent.config.json /tmp/edge.config.json
export MCP_REMOTE_KEY='replace-with-strong-mcp-key'
export GATEWAY_CONFIG_PATH=/tmp/edge.config.json
npm run build && node dist/index.js
```

3. 验证远端 Tool 已接入 Edge Agent

```bash
curl -s http://127.0.0.1:3100/agent/tools
```

返回工具名应包含前缀 `remote-toolhub.`。

## 多机部署要点

1. ToolHub 机器使用 `multi-machine-toolhub.config.json`
2. Edge Agent 机器使用 `multi-machine-edge-agent.config.json`
3. 把 Edge 配置中的 URL 改为真实域名：

```json
"url": "wss://mcp-toolhub.example.com/mcp/ws"
```

4. 两侧使用同一个 `MCP_REMOTE_KEY`（建议通过密钥管理系统注入）
5. 生产环境建议：

- 使用 `wss`（TLS）
- `allowQueryToken=false`（模板已默认关闭）
- `mcpGateway.principals[].allowServers/allowTools` 收敛到最小权限
- `serverExposure` 仅暴露必须公网调用的 MCP server

## 直接验证 ToolHub WebSocket 鉴权

```bash
npx wscat -c ws://127.0.0.1:3101/mcp/ws -H 'Authorization: Bearer replace-with-strong-mcp-key'
```

连接后发送：

```json
{"jsonrpc":"2.0","id":"1","method":"tools/list","params":{}}
```

## 注意

不要把某个实例的 `agent.mcpServers[].url` 指向它自己同进程的 `/mcp/ws`，会导致 MCP 工具发现与调用形成递归依赖。
