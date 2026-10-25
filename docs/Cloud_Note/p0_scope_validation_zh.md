# P0 模块与删除范围验证

- 日期：2026-10-23。
- 基线提交：`ce0524d49f4e1c840689d83d3f8f18fce383effb`。
- 状态：已完成静态依赖核对；尚未进行 P0 原型运行验收。
- 关联：[开发计划](cloud_notes_rewrite_plan_zh.md)、[当前项目 Wiki](../repo_wiki/README.md)。

后续已建立独立原型并运行部分实际测试，见 [P0 原型运行验证报告](p0_runtime_validation_zh.md)。本页记录的是此前的静态核对，以下“尚无原型”等描述仅对应当时状态。

## 1. 验证结论

P0 采用独立插件入口、构建产物和状态命名空间是可行的实施方向，但本次仅核对了当前依赖关系，尚无新入口产物可以证明隔离已经实现。当前没有必须先删除才能开始 P0 的业务源码。直接删除本地数据库、Commonlib 或独立应用目录，会使现有入口、检查或发布流程失去依赖。

本次对 `src`、`test`、`utils`、`_tools` 和 `.github` 进行了文本搜索，并用 Node.js 扫描静态 import/export、相对路径及 `@/` 别名引用；手工核对了关键命中。扫描包含类型引用，未使用 TypeScript 编译器解析，也未解析外部包内部依赖、所有动态加载或构建转换，因此不能当作完整的打包依赖图。

没有安装依赖、执行 `npm ci`、构建、产品测试或真机测试。工作区没有 `node_modules`，也没有建议中的 `src/rewrite` 原型目录。未删除或修改任何现有业务源码。

## 2. 已核对的依赖与证据

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 旧入口是否自动装配旧核心 | 是，不能用旧入口包裹新原型后宣称已隔离 | [main.ts](../../src/main.ts) 创建 Service Hub、Core、add-ons 和 P2P 功能 |
| 旧服务是否仍需本地数据库 | 是，PouchDB 与键值存储均被注入 | [ObsidianServiceHub.ts](../../src/modules/services/ObsidianServiceHub.ts) |
| 旧键值数据库实际导出 | `KeyValueDB.ts` 重导出 `KeyValueDBv2.ts` 的实现 | [KeyValueDB.ts](../../src/common/KeyValueDB.ts)、[KeyValueDBv2.ts](../../src/common/KeyValueDBv2.ts) |
| 旧核心是否仅供插件使用 | 否，CLI 和 WebApp 也导入 `LiveSyncBaseCore` | [CLI main.ts](../../src/apps/cli/main.ts)、[WebAppRuntime.ts](../../src/apps/webapp/WebAppRuntime.ts) |
| 文件处理是否可直接摘取本地类 | 不能只看本地类；多个入口继承 Commonlib 基类 | [FileHandler.ts](../../src/serviceModules/FileHandler.ts)、[FileAccessObsidian.ts](../../src/serviceModules/FileAccessObsidian.ts)、[ServiceFileAccessImpl.ts](../../src/serviceModules/ServiceFileAccessImpl.ts) |
| 公共界面基类是否完全独立 | 否，`SvelteItemView` 引用 `deps.ts`，后者还重导出差异算法并引用 Commonlib 类型 | [SvelteItemView.ts](../../src/common/SvelteItemView.ts)、[deps.ts](../../src/deps.ts)；类型引用不等于运行时打包 |
| 原构建是否自动隔离产物 | 否，固定旧入口和根产物，且包含安装复制逻辑 | [esbuild.config.mjs](../../esbuild.config.mjs) 使用 `src/main.ts`、根 manifest、`main_org.js` 和 `main.js` |
| 删除应用目录是否只需改 workspace | 否，类型检查、lint、测试和版本脚本也有引用 | [package.json](../../package.json)、[eslint.config.mjs](../../eslint.config.mjs)、[eslint.community.config.mjs](../../eslint.community.config.mjs) |
| 删除应用是否影响发布 | 是，版本生命周期及 release preparation 包含应用 manifest 路径 | [update-workspaces.mjs](../../update-workspaces.mjs)、[prepare-release.yml](../../.github/workflows/prepare-release.yml) |
| 是否还存在浏览器共享适配层 | 是，`src/apps/browser` 也需纳入最终删除审计 | [browser 目录](../../src/apps/browser/)，及 [WebApp 测试](../../test/apps/webapp/WebAppRuntime.unit.spec.ts) |
| S3 SDK 是否只在独立应用使用 | 否，Obsidian HTTP 适配和 E2E 夹具也有引用 | [ObsHttpHandler.ts](../../src/modules/essentialObsidian/APILib/ObsHttpHandler.ts)、[objectStorage.ts](../../test/e2e-obsidian/runner/objectStorage.ts) |

## 3. P0 修改清单

以下为待实施项，不是本次已完成的改造。

| 工作包 | P0 输出 | 与旧实现的关系 |
| --- | --- | --- |
| 独立宿主入口 | 测试插件 ID、入口、输出目录、manifest 和安装目标 | 不实例化旧 Core 或 Service Hub |
| 最小平台适配 | 读写、目录、生命周期和传输能力接口 | 直接使用必要的 Obsidian 能力；逐项评估旧适配的复用 |
| CryptoSession | 密钥包、解锁/锁定、恢复路径及固定测试向量原型 | 不复用旧 E2EE 协议或旧设置的隐式状态 |
| 加密草稿 | 文件代次、校验、恢复流程及中断测试 | 不调用旧 PouchDB 或 IndexedDB 状态层 |
| 编辑器原型 | 中文输入、草稿状态、锁定和恢复交互 | 不接入旧设置向导和同步 UI |
| 大文件验证 | 分段读取、认证加密、测试上传、取消与安全重试 | 测试接收端即可，不要求先实现生产 API |
| 搜索与 Metadata 决策 | 中文检索实验、隐私模式、路径令牌 ADR | 验证可行性，不宣称完整搜索已交付 |
| 协议与能力矩阵 | 协议 v0、错误、幂等、版本、游标及设备记录 | 为后续服务端和双设备闭环提供契约 |
| 构建和测试 | 独立脚本、类型检查、测试发现和构建依赖审计 | 旧命令仍用于验证旧路径，新增命令明确覆盖新原型 |

建议 `src/rewrite/` 仅作为阶段性目录。新源码位于 `src` 下仍会受到根类型检查和 lint 范围影响，不能仅凭另建目录就声称整个工具链独立。独立测试配置应明确纳入该原型，依赖树应通过实际构建的 metafile 再验证。

## 4. 删除顺序与联动范围

| 对象 | P0 处理 | 后续删除时必须一并核对 |
| --- | --- | --- |
| 旧数据库、复制器、启动和恢复实现 | 保留源码，新原型不引用 | 当前插件入口、Commonlib 使用、配置字段、测试和维护命令 |
| CLI、WebApp、WebPeer | 不参与新原型运行 | workspace、锁文件 link/package 项、类型与 lint 配置、构建、测试、Docker、CI、版本及发布脚本 |
| `src/apps/browser` | 保留至引用清理完成 | 浏览器应用和 `test/apps` 的剩余引用；它不是单独声明的 workspace |
| 旧 P2P 及 TURN 集成 | 新原型不注册 | Commonlib P2P 导入、设置、界面、浏览器检查工具、relay 夹具和测试 |
| 旧设置向导、历史与冲突界面 | 等待新流程接替 | 命令注册、翻译、样式、持久化配置与回归场景 |
| Commonlib、PouchDB、`idb`、AWS/Smithy 包 | 暂不卸载 | 运行时引用、类型引用、测试工具和间接依赖；锁文件通过包管理器更新 |
| Hidden File Sync、Customisation Sync | 暂不迁入原型 | 产品范围单独决定，不能仅因其他客户端退出而删除 |

实际清理应按功能成组进行：先有替代能力与回归证据，再移除旧调用入口、实现及专用基础设施，最后清理依赖、配置和文档。保留多设备冲突、来源记录、路径别名和中断恢复的测试意图，并将其适配到新版协议。

本次没有发现必须在 P0 立即删除的业务源码；这不代表已证明所有旧文件都必要，也不代表已经完成全仓库无用代码分析。

## 5. 原型建立后必须补齐的验证

1. 构建新插件，检查 metafile 中没有旧 Core、旧 provider、PouchDB 和 `idb`；Commonlib 类型引用与实际运行依赖分开判断。
2. 检查插件 ID、输出目录、安装目标和持久化目录确实不同，启动时没有旧数据库初始化或旧同步连接。
3. 运行密码格式测试向量、错误口令、密文篡改、草稿写入中断和重启恢复测试。
4. 在桌面、Android 和 iOS 记录解锁时间、内存、中文输入、锁定和进程终止后的恢复结果。
5. 测量大文件分段读写与加密内存；传输恢复不得造成 nonce 重用，缺段、乱序与截断必须被拒绝。
6. 根据实测冻结密码库和参数、大小限制、Metadata 模式及协议 v0，之后进入 P1。

本次验证支持开始独立 P0 原型开发，但不构成 P0 完成或跨平台兼容性通过的结论。
