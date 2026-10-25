# 05 开发、测试与发布

## 首次建立本地开发环境

在仓库根目录运行：

```sh
npm ci
npm run build
```

`npm ci` 按锁文件安装，包含精确的 Commonlib 包。本次 Wiki 编写未执行这些命令，工作区检查时尚无 `node_modules`。Node/npm 版本应结合当前 CI 和 [测试指南](../../test/README.md) 的安装检查选择，不将编写文档机器的版本当作项目最低要求。

构建入口是 [esbuild.config.mjs](../../esbuild.config.mjs)，主要过程为：

```text
src/main.ts
  → esbuild：TypeScript、Svelte、worker 和依赖打包
  → main_org.js
  → 生产构建使用 Terser
  → main.js
```

插件交付还需要 [manifest.json](../../manifest.json) 和 [styles.css](../../styles.css)。`obsidian`、Electron 及部分编辑器依赖被声明为 external，由运行宿主提供。

## 开发监听与测试 Vault

`npm run dev` 使用 `node --env-file=.env`，需要存在 `.env`。可参照 [example.env](../../example.env)；若配置 `PATHS_TEST_INSTALL`，每项指向测试 Vault 下的插件目录，Windows 以分号分隔，Unix 以冒号分隔。

仅在独立测试 Vault 中进行自动复制和恢复测试。构建脚本会将产物复制到配置目录，并写入带构建时间的测试 manifest 版本；这段复制逻辑不只存在于开发监听分支，执行生产构建前也应检查相应环境变量。

当前 `buildDev` 和 `dev` 都进入非 production 的 watch 分支。虽然旧开发说明将 `buildDev` 写成单次构建，实际行为应以脚本为准。

## 如何选择验证命令

以下命令均在仓库根目录执行；它们是维护入口，不表示本次已运行通过。

| 目的 | 命令 | 前置条件或覆盖边界 |
| --- | --- | --- |
| 综合静态检查 | `npm run check` | 包含主项目和 apps 类型检查、ESLint、Svelte，以及构建后兼容性检查 |
| 单元测试 | `npm run test:unit` | Node.js Vitest；主要发现 `*.unit.spec.ts` 和 `*unit.test.ts` |
| 单元覆盖率 | `npm run test:unit:coverage` | 仅在需要覆盖率时执行 |
| CouchDB 集成 | `npm run test:integration` | 需要环境文件和可用的测试服务 |
| CLI 单元测试 | `npm run test:unit --workspace self-hosted-livesync-cli` | 当前脚本显式列出测试文件，不是 CLI 全目录通配 |
| CLI 端到端 | `npm run test:e2e:cli` | Deno 及对应测试环境 |
| CLI P2P | `npm run test:e2e:cli:p2p` | Compose 管理的 P2P 测试基础设施 |
| 浏览器应用 | `npm run test:browser-apps` | WebApp/WebPeer 自有浏览器测试环境 |
| Obsidian 冒烟 | `npm run test:e2e:obsidian:smoke` | 构建产物、真实 Obsidian 及测试运行器配置 |
| 双 Vault 同步 | `npm run test:e2e:obsidian:two-vault-sync` | 真实 Obsidian 和场景所需服务 |
| S3 回归 | `npm run test:e2e:obsidian:minio-upload` | 真实 Obsidian 和 S3 夹具；脚本名保留 MinIO 命名 |
| 生产打包 | `npm run build` | 生成插件产物 |

`check:compatibility` 的 npm 前置脚本会构建插件，所以 `npm run check` 并非纯粹不写文件的检查。根单元配置和 CLI 自有单元脚本的发现范围不同，不能将某个局部命令通过描述成整个仓库通过。

Docker 辅助命令中有 Bash、`sleep` 等平台要求。Windows 上执行相关脚本前按其指南准备 Bash/WSL 或指定环境，避免照搬 Unix 环境变量语法到 PowerShell。只启动当前测试需要的 CouchDB、S3 或 relay；停止命令及卷清理也应以测试夹具说明为准。

详细入口：[test/README.md](../../test/README.md)、[真实 Obsidian 测试](../../test/e2e-obsidian/README.md)、[CLI package.json](../../src/apps/cli/package.json)、[Vitest 单元配置](../../vitest.config.unit.ts)、[集成配置](../../vitest.config.integration.ts)。

## 针对模块选择回归场景

| 修改内容 | 优先补充或执行的验证 |
| --- | --- |
| 生命周期与服务装配 | 对应单元测试，必要时真实 Obsidian 冷启动 |
| 文件入库、来源记录、冲突 | [多设备集成测试](../../src/serviceModules/FileHandler.multidevice.integration.spec.ts)，以及真实重启/文件回写场景 |
| 复制结果就绪控制 | [receivedChangeReadiness 测试](../../src/serviceFeatures/replication/receivedChangeReadiness.unit.spec.ts)，以及实际文件回写 |
| 设置和 Setup URI | 配置单元测试、真实设置对话框和两设备导入流程 |
| S3 或 CouchDB provider | 对应服务集成或真实 Obsidian 场景，不能只测连接 |
| P2P 生命周期 | CLI Compose P2P 与相关界面/连接场景 |
| 移动端兼容性 | 静态兼容检查，加 Android/iOS 实机启动、输入、挂起及恢复测试 |

真实桌面 Obsidian 测试不能证明移动操作系统终止进程后仍可靠恢复。单元测试中的内存文件系统也不能证明移动端文件写入具有相同原子性。

## CI 与发布导航

| 工作流 | 用途 |
| --- | --- |
| [unit-ci.yml](../../.github/workflows/unit-ci.yml) | 核心检查与测试编排，具体矩阵以文件为准 |
| [cli-e2e.yml](../../.github/workflows/cli-e2e.yml) | CLI 端到端验证 |
| [cli-docker.yml](../../.github/workflows/cli-docker.yml) | CLI 镜像构建和发布 |
| [prepare-release.yml](../../.github/workflows/prepare-release.yml) | 准备版本与发布 PR |
| [finalise-release.yml](../../.github/workflows/finalise-release.yml) | 固定被审核提交与标签 |
| [release.yml](../../.github/workflows/release.yml) | Obsidian 插件发布 |
| [deploy-pages.yml](../../.github/workflows/deploy-pages.yml) | 浏览器应用部署 |

正式发布有不可变标签、预发布验证、版本元数据及维护者门禁，具体以 [devs.md](../../devs.md) 为准。理解项目时无需触发发布；本 Wiki 没有执行任何发布动作。

## 文档与代码修改约定

修改前读 [AGENTS.md](../../AGENTS.md)；设置、术语和用户提示应查 [terms.md](../terms.md)、[glossary.md](../glossary.md)、[settings.md](../settings.md) 和 [troubleshooting.md](../troubleshooting.md)。英文文字使用项目规定的英式拼写，保留精确代码标识。新增用户可感知功能按开发规范维护 `updates.md`，跨仓库改动遵守 Commonlib 的打包验证边界。

[返回 Wiki 首页](README.md) · [下一章：重写影响与源码阅读路线](06-rewrite-map.md)
