# CodeGB

CodeGB 是一个面向本地开发者环境的代码知识图谱工具，提供可在本机运行的 MCP Server，供 MCP Client（如 Claude/Cursor）调用。

## 功能概览

- Java 代码解析与图谱构建（类、方法、字段、调用、继承、导入）
- MCP 工具：
  - `query`
  - `context`
  - `impact`
  - `cypher`
  - `list_repos`
- 本地优先存储与查询
- 可切换图存储后端（WASM / Native）

## 环境要求

- Node.js 18+
- pnpm

## 安装依赖

```bash
pnpm install
```

## 构建

```bash
pnpm build
```

## 本地使用（CLI）

```bash
# 1) 初始化仓库索引目录
pnpm exec tsx packages/cli/src/index.ts init /path/to/your/repo --storage .javakg

# 2) 建索引
pnpm exec tsx packages/cli/src/index.ts index /path/to/your/repo --storage .javakg

# 3) 查询
pnpm exec tsx packages/cli/src/index.ts query "payment" --storage .javakg --limit 10
```

## 启动 MCP Server（stdio）

```bash
JAVA_KG_DB_PATH=.javakg pnpm exec tsx packages/mcp-server/src/cli.ts
```

说明：
- 该进程通过 stdio 与 MCP Client 通信。
- MCP Client 里将此命令配置为 MCP Server 启动命令即可。

## 图数据库后端选择

当前实现支持两条路径：

- `kuzu-wasm`：跨平台与安装体验更好，适合默认分发。
- `kuzu`（native）：在部分机器上可能更快，但安装/兼容性成本更高。

统一开关：
- `CODEGB_DB_BACKEND=wasm|native|auto`
- 默认值：`wasm`（兼容性优先）
- `auto`：优先尝试 `native`，失败后自动降级到 `wasm`，并打印一次性诊断日志

> 说明：后端切换能力已在 core 层实现，具体运行策略可通过启动配置统一管理。

## 测试

```bash
# Core tests
pnpm exec tsx --test packages/core/test/*.test.ts

# E2E tests
pnpm test:e2e
```

## 项目结构

- `packages/core`: 解析、图模型、存储适配、搜索、MCP 工具逻辑
- `packages/mcp-server`: MCP Server 启动与协议对接
- `packages/cli`: 本地初始化/索引/查询命令
- `tests/e2e`: 端到端测试

## 设计文档

- `架构设计.md`
