# 01 项目组成与目录地图

## 产品与运行环境

| 组成 | 运行位置 | 作用与边界 |
| --- | --- | --- |
| Obsidian 插件 | 桌面端及移动端 Obsidian | 监听 Vault、维护本地同步数据库、连接远端，并提供设置和诊断界面 |
| CLI | Node.js | 无需 Obsidian 的命令行同步客户端；可以长期运行，但不是独立云端笔记业务 API |
| WebApp | 浏览器 | 实验性本地 Vault 同步应用，通过 File System Access API 访问用户授权目录 |
| WebPeer | 浏览器 | P2P 辅助客户端及连接检查工具，不等同于普通笔记编辑器 |
| Commonlib | 外部 npm 包 | 为多个宿主提供共享数据库、复制、服务契约，以及文件处理能力 |
| CouchDB / S3 服务 | 外部基础设施 | 提供已有中央远端的数据存储与相应接口 |

应用说明：[CLI](../../src/apps/cli/README.md)、[WebApp](../../src/apps/webapp/README.md)、[WebPeer](../../src/apps/webpeer/README.md)。WebApp 的浏览器文件访问能力有额外限制，不能从插件支持移动端推断 WebApp 同样支持所有浏览器。

## 技术栈

| 技术 | 在仓库中的用途 | 核对入口 |
| --- | --- | --- |
| TypeScript | 插件、应用和功能编排 | [tsconfig.json](../../tsconfig.json) |
| Svelte | 设置、对话框及功能界面 | [package.json](../../package.json)、[模块目录](../../src/modules/) |
| PouchDB | 本地修订数据库及复制模型 | [ObsidianServiceHub](../../src/modules/services/ObsidianServiceHub.ts) |
| IndexedDB / `idb` | Obsidian 浏览器环境中的持久化及辅助键值状态 | [KeyValueDBv2](../../src/common/KeyValueDBv2.ts) |
| Commonlib | 跨宿主共享逻辑 | [依赖声明](../../package.json)、[开发指南](../../devs.md) |
| esbuild / Terser | Obsidian 插件打包与压缩 | [esbuild.config.mjs](../../esbuild.config.mjs) |
| Vite | 独立应用构建 | [CLI 配置](../../src/apps/cli/vite.config.ts)、[WebApp 配置](../../src/apps/webapp/vite.config.ts) |
| Vitest / Deno / Docker | 单元、集成及端到端验证 | [测试指南](../../test/README.md) |

PouchDB 是数据库抽象，IndexedDB 是其浏览器持久化所使用的底层能力之一，二者不是互斥选项。CLI 另有 LevelDB 适配依赖，不能将 Obsidian 的数据库落盘方式直接套用到 CLI。

## 仓库目录地图

| 路径 | 阅读时应关注的内容 |
| --- | --- |
| [src/main.ts](../../src/main.ts) | Obsidian 入口、服务装配，以及插件生命周期 |
| [src/LiveSyncBaseCore.ts](../../src/LiveSyncBaseCore.ts) | 共享核心装配、provider 注册、功能初始化和旧模块绑定 |
| [src/modules/services/](../../src/modules/services/) | Obsidian 宿主服务和依赖注入 |
| [src/modules/main/](../../src/modules/main/) | 当前主生命周期模块 |
| [src/modules/coreFeatures/](../../src/modules/coreFeatures/) | 核心功能模块，例如同步参数兼容性处理 |
| [src/modules/essentialObsidian/](../../src/modules/essentialObsidian/) | Obsidian 事件适配 |
| [src/modules/features/](../../src/modules/features/) | 设置、日志、历史、安装引导及冲突界面 |
| [src/serviceModules/](../../src/serviceModules/) | 文件系统适配、文件处理入口，以及修订来源记录的装配 |
| [src/serviceFeatures/](../../src/serviceFeatures/) | 同步、启动检查、诊断和命令等功能编排 |
| [src/managers/](../../src/managers/) | Obsidian 文件事件管理与适配 |
| [src/features/](../../src/features/) | 隐藏文件、配置同步、数据库维护、P2P 界面等功能 |
| [src/common/](../../src/common/) | 远端配置、provider 定义、翻译、状态，以及通用工具 |
| [src/integrations/](../../src/integrations/) | TURN 等外部能力集成 |
| [src/apps/](../../src/apps/) | CLI、浏览器共享适配、WebApp，以及 WebPeer |
| [test/](../../test/) | 测试夹具、真实 Obsidian 和浏览器测试；单元测试也与源码同目录存放 |
| [utils/](../../utils/) | 部署、配置生成、兼容性及发布辅助脚本 |
| [_tools/](../../_tools/) | 翻译等维护工具 |
| [docs/](../) | 操作指南、协议规范、架构决策和设计记录 |
| [.github/workflows/](../../.github/workflows/) | CI、发布、CLI 镜像和浏览器部署工作流 |

部分旧文档中的 `modules/core/`、`modules/essential/` 等分组名称不能当成当前实际路径。上表依据本次 checkout 的文件目录。

## Commonlib 边界：为何有些文件只有几行

[FileHandler.ts](../../src/serviceModules/FileHandler.ts) 中的 `ServiceFileHandler` 继承 Commonlib 的 `ServiceFileHandlerBase`；[DatabaseFileAccess.ts](../../src/serviceModules/DatabaseFileAccess.ts) 同样继承外部基类。它们的名字很重要，但实际业务逻辑并不全在这些本地文件中。

阅读时按以下顺序判断归属：

1. 找到当前类或函数在 `main.ts`、Service Hub 或功能工厂中的装配位置。
2. 查看它实际导入的包路径，区分本仓库源码和 Commonlib 导出。
3. 若需要修改外部基类，应转到 Commonlib 独立仓库，验证打包产物，再更新这里的精确依赖。

不要重新建立 `src/lib` 镜像或生成 `_types` 兜底目录。约束见 [AGENTS.md](../../AGENTS.md)。

[返回 Wiki 首页](README.md) · [下一章：架构与启动流程](02-architecture.md)
