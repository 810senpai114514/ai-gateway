# Agent Routes 测试文档

## 概述

本文档描述了 `/src/agent/routes.test.ts` 中的所有测试用例,涵盖了 agent 相关的所有 API 接口。

## 测试框架

- **测试框架**: Vitest
- **HTTP 测试**: Fastify 的 inject 方法
- **测试数量**: 65 个测试用例(61个通过,4个跳过)

## 测试覆盖的接口

### 1. GET /agent/tools
获取可用工具列表

**测试用例**:
- ✓ 应该返回可用工具列表

### 2. POST /agent/agents
创建新的 agent

**测试用例**:
- ✓ 应该成功创建agent
- ✓ 应该拒绝没有name的请求
- ✓ 应该拒绝空name的请求
- ✓ 应该拒绝无效的tools字段
- ✓ 应该支持allowedTools字段(旧字段名)
- ✓ 应该拒绝非对象类型的请求体

**请求示例**:
```json
{
  "name": "测试Agent",
  "description": "这是一个测试Agent",
  "systemPrompt": "你是一个测试助手",
  "tools": ["tool1", "tool2"]
}
```

### 3. GET /agent/agents/:agentId
获取指定 agent 的信息

**测试用例**:
- ✓ 应该返回已创建的agent
- ✓ 应该为不存在的agent返回404

### 4. POST /agent/sessions
创建新的 session

**测试用例**:
- ✓ 应该成功创建session(无参数)
- ✓ 应该成功创建带prompt的session
- ✓ 应该成功创建指定agentId的session
- ✓ 应该成功创建自定义sessionId的session
- ✓ 应该拒绝重复的sessionId
- ✓ 应该拒绝不存在的agentId
- ✓ 应该成功创建带metadata的session
- ✓ 应该拒绝无效的metadata类型
- ✓ 应该成功创建带tools的session
- ✓ 应该成功创建带memoryRefs的session
- ⊘ 应该支持流式响应(stream=true) (已跳过 - SSE长连接测试)
- ⊘ 应该根据Accept header自动启用流式响应 (已跳过 - SSE长连接测试)

**请求示例**:
```json
{
  "agentId": "optional-agent-id",
  "sessionId": "optional-session-id",
  "prompt": "你好,请介绍一下自己",
  "metadata": {
    "userId": "user123"
  },
  "tools": ["tool1", "tool2"],
  "memoryRefs": ["memory1"],
  "stream": false
}
```

### 5. GET /agent/sessions/:sessionId
获取指定 session 的信息

**测试用例**:
- ✓ 应该返回已创建的session
- ✓ 应该为不存在的session返回404

### 6. POST /agent/sessions/:sessionId/resume
恢复 session 并可选地发送 prompt

**测试用例**:
- ✓ 应该成功恢复session
- ✓ 应该成功恢复session并发送prompt
- ✓ 应该支持fromOffset参数
- ✓ 应该正确处理负数的fromOffset(转换为0)
- ✓ 应该为不存在的session返回404

**请求示例**:
```json
{
  "prompt": "继续对话",
  "fromOffset": 0,
  "correlationId": "optional-correlation-id",
  "metadata": {}
}
```

### 7. GET /agent/sessions/:sessionId/stream
获取 session 的 SSE 事件流

**测试用例**:
- ⊘ 应该返回SSE流 (已跳过 - SSE长连接测试)
- ⊘ 应该支持fromOffset查询参数 (已跳过 - SSE长连接测试)
- ✓ 应该为不存在的session返回404

**注意**: SSE 流测试被跳过,因为它们是长连接,会导致测试超时。这些功能应该在实际环境中手动测试。

### 8. GET /agent/sessions/:sessionId/events
获取 session 的事件列表

**测试用例**:
- ✓ 应该返回session事件列表
- ✓ 应该支持limit查询参数
- ✓ 应该支持afterOffset查询参数

**查询参数**:
- `limit`: 限制返回的事件数量
- `afterOffset`: 返回此偏移量之后的事件

### 9. POST /agent/sessions/:sessionId/input
向 session 发送用户输入

**测试用例**:
- ✓ 应该成功发送用户输入
- ✓ 应该支持带metadata的用户输入
- ✓ 应该支持correlationId
- ✓ 应该拒绝没有text字段的请求
- ✓ 应该拒绝非对象类型的请求体

**请求示例**:
```json
{
  "text": "这是用户输入",
  "metadata": {
    "source": "test"
  },
  "correlationId": "correlation-123"
}
```

### 10. POST /agent/sessions/:sessionId/config
更新 session 配置

**测试用例**:
- ✓ 应该成功更新systemPrompt
- ✓ 应该成功更新allowedTools
- ✓ 应该成功更新memoryRefs
- ✓ 应该成功同时更新多个配置
- ✓ 应该拒绝没有任何配置字段的请求
- ✓ 应该拒绝非对象类型的请求体

**请求示例**:
```json
{
  "systemPrompt": "新的系统提示词",
  "allowedTools": ["tool1", "tool2"],
  "memoryRefs": ["memory1"]
}
```

### 11. POST /agent/sessions/:sessionId/tool-result
提交工具执行结果

**测试用例**:
- ✓ 应该成功提交工具结果(status=ok)
- ✓ 应该成功提交工具错误结果(status=error)
- ✓ 应该根据error字段自动设置status为error
- ✓ 应该拒绝缺少toolCallId的请求
- ✓ 应该拒绝缺少toolName的请求
- ✓ 应该拒绝非对象类型的请求体

**请求示例**:
```json
{
  "toolCallId": "tool-call-123",
  "toolName": "testTool",
  "status": "ok",
  "result": { "data": "工具执行成功" }
}
```

**错误响应示例**:
```json
{
  "toolCallId": "tool-call-456",
  "toolName": "testTool",
  "status": "error",
  "error": "工具执行失败"
}
```

### 12. POST /agent/sessions/:sessionId/events
发布自定义事件到 session

**测试用例**:
- ✓ 应该成功发布USER_INPUT事件
- ✓ 应该成功发布SESSION_CONFIG_UPDATED事件
- ✓ 应该成功发布TOOL_RESULT事件
- ✓ 应该支持correlationId和causationId
- ✓ 应该拒绝不支持的事件类型
- ✓ 应该拒绝没有type字段的请求
- ✓ 应该拒绝非对象类型的请求体

**支持的事件类型**:
- `USER_INPUT` - 用户输入
- `SESSION_CONFIG_UPDATED` - 会话配置更新
- `TOOL_RESULT` - 工具结果

**请求示例**:
```json
{
  "type": "USER_INPUT",
  "payload": {
    "text": "通过事件API发送的输入"
  },
  "correlationId": "correlation-abc",
  "causationId": "causation-xyz"
}
```

## 边界情况测试

**测试用例**:
- ✓ 应该处理空字符串参数
- ✓ 应该处理超长字符串数组
- ✓ 应该处理tools数组中的重复项
- ✓ 应该处理tools数组中的空字符串
- ✓ 应该处理非常大的limit参数
- ✓ 应该处理无效的limit参数
- ✓ 应该处理无效的afterOffset参数

## 运行测试

```bash
# 运行所有测试
npm test

# 运行测试并生成覆盖率报告
npm run test:coverage

# 运行特定测试文件
npx vitest src/agent/routes.test.ts

# 以监视模式运行测试
npx vitest --watch
```

## 测试覆盖率

测试覆盖了以下方面:
- ✅ 正常的请求响应流程
- ✅ 参数验证和错误处理
- ✅ 边界情况和异常输入
- ✅ HTTP 状态码验证
- ✅ 响应数据结构验证
- ✅ 数据去重和清理
- ✅ 字段兼容性(如 allowedTools/tools)

## 注意事项

1. **SSE 流测试**: 由于 SSE 是长连接,相关的 4 个测试被跳过,应在实际环境中手动测试。

2. **测试隔离**: 每个测试都在独立的环境中运行,通过 `beforeEach` 和 `afterEach` 钩子进行设置和清理。

3. **唯一性**: 需要唯一标识符的测试(如 sessionId)使用时间戳确保唯一性。

4. **状态码**: Fastify 在处理非对象类型请求体时可能返回 400 或 415,测试使用 `toContain` 断言兼容这两种情况。

5. **数据清理**: 测试验证了字符串数组去重、空字符串过滤等数据清理功能。

## 贡献指南

添加新的测试用例时,请遵循以下原则:
1. 使用描述性的测试名称(中文)
2. 测试正常流程和错误情况
3. 验证响应状态码和数据结构
4. 考虑边界情况和异常输入
5. 保持测试独立和可重复运行
