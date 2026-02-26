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

## MCP Client 配置模板（最小可用）

下面的模板统一使用：
- `command`: `pnpm`
- `args`: `["exec", "tsx", "packages/mcp-server/src/cli.ts"]`
- `env.JAVA_KG_DB_PATH`: 你的索引目录（需与 `--storage` 一致）

请将 `"/ABS/PATH/TO/vibe-coding-plugin"` 和 `"/ABS/PATH/TO/.javakg"` 替换成绝对路径。

### Claude Desktop

配置文件（macOS）通常在 `~/Library/Application Support/Claude/claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "codegb": {
      "command": "pnpm",
      "args": ["exec", "tsx", "packages/mcp-server/src/cli.ts"],
      "cwd": "/ABS/PATH/TO/vibe-coding-plugin",
      "env": {
        "JAVA_KG_DB_PATH": "/ABS/PATH/TO/.javakg"
      }
    }
  }
}
```

### Cursor

工作区文件 `.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "codegb": {
      "command": "pnpm",
      "args": ["exec", "tsx", "packages/mcp-server/src/cli.ts"],
      "cwd": "/ABS/PATH/TO/vibe-coding-plugin",
      "env": {
        "JAVA_KG_DB_PATH": "/ABS/PATH/TO/.javakg"
      }
    }
  }
}
```

### VS Code

工作区文件 `.vscode/mcp.json`：

```json
{
  "servers": {
    "codegb": {
      "type": "stdio",
      "command": "pnpm",
      "args": ["exec", "tsx", "packages/mcp-server/src/cli.ts"],
      "cwd": "/ABS/PATH/TO/vibe-coding-plugin",
      "env": {
        "JAVA_KG_DB_PATH": "/ABS/PATH/TO/.javakg"
      }
    }
  }
}
```

## 首次索引（MCP 前置）

MCP 只提供查询，首次必须先做 `init + index`：

```bash
pnpm exec tsx packages/cli/src/index.ts init /ABS/PATH/TO/REPO --storage /ABS/PATH/TO/.javakg
pnpm exec tsx packages/cli/src/index.ts index /ABS/PATH/TO/REPO --storage /ABS/PATH/TO/.javakg
```

## 常见问题（FAQ）

- Q: 能连上 MCP，但结果为空？
  A: 通常是未完成首次索引，或 `JAVA_KG_DB_PATH` 与索引 `--storage` 不一致。
- Q: 启动失败并输出 JSON 错误码？
  A: `E_NODE_VERSION`（Node < 18）、`E_STORAGE_PERM`（目录不可写）、`E_WORKER_UNAVAILABLE`（Worker 不可用）、`E_BACKEND_INIT`（后端初始化失败）。
- Q: 报 `pnpm` 找不到？
  A: 确保客户端运行环境 `PATH` 可找到 `pnpm`，或改用 `pnpm` 绝对路径。
- Q: `list_repos` 显示旧仓库？
  A: 对新仓库重新执行 `init + index`，并更新 `JAVA_KG_DB_PATH`。

## 降级行为

- 后端降级：`CODEGB_DB_BACKEND=auto` 时，优先 `wasm`，失败自动回退到 `native`，并打印一次性诊断日志。
- Cypher 降级：`cypher` 工具优先走后端；后端不可用或返回不兼容结果时，自动回退到内存图兼容执行路径。
- 数据降级：若索引目录为空或图加载失败，服务以空图启动，工具返回空结果而非进程崩溃。

## 图数据库后端选择

当前实现支持两条路径：

- `kuzu-wasm`：跨平台与安装体验更好，适合默认分发。
- `kuzu`（native）：在部分机器上可能更快，但安装/兼容性成本更高。

统一开关：
- `CODEGB_DB_BACKEND=wasm|native|auto`
- 默认值：`wasm`（兼容性优先）
- `auto`：优先尝试 `wasm`，失败后自动回退到 `native`，并打印一次性诊断日志

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


