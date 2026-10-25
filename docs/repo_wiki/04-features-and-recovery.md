# 04 功能、加密与恢复

## 功能导航

| 功能 | 入口 | 阅读重点 |
| --- | --- | --- |
| 安装与设置引导 | [SetupManager](../../src/modules/features/SetupManager.ts)、[setupObsidian](../../src/serviceFeatures/setupObsidian/) | 首设备初始化、其他设备加入、Setup URI 和二维码 |
| 设置界面 | [ModuleObsidianSettingTab](../../src/modules/features/ModuleObsidianSettingTab.ts) | UI 定义、编辑状态、持久化配置的关系 |
| 设置服务 | [ObsidianSettingService](../../src/modules/services/ObsidianSettingService.ts) | 保存、加载和配置生命周期 |
| 远端 profile | [remoteConfiguration](../../src/common/remoteConfiguration.ts) | 活动远端选择与配置转换 |
| 普通笔记同步 | [replication](../../src/serviceFeatures/replication/)、[replicationScheduling](../../src/serviceFeatures/replicationScheduling.ts) | 就绪检查、触发、复制结果处理 |
| Hidden File Sync | [CmdHiddenFileSync](../../src/features/HiddenFileSync/CmdHiddenFileSync.ts) | 隐藏目录文件的独立处理及过滤 |
| Customisation Sync | [CmdConfigSync](../../src/features/ConfigSync/CmdConfigSync.ts) | 插件、主题、片段和设置的选择性同步 |
| 单文件历史 | [ModuleObsidianDocumentHistory](../../src/modules/features/ModuleObsidianDocumentHistory.ts) | 修订浏览与恢复 |
| 全局历史 | [ModuleGlobalHistory](../../src/modules/features/ModuleGlobalHistory.ts) | 跨文件查看历史变化 |
| 历史恢复操作 | [documentHistoryRestoration](../../src/serviceFeatures/documentHistoryRestoration.ts) | 读取旧内容与执行恢复的边界 |
| 数据库维护 | [CmdLocalDatabaseMainte](../../src/features/LocalDatabaseMainte/CmdLocalDatabaseMainte.ts) | 维护前置条件与数据库操作 |
| 诊断与修复 | [databaseDiagnostics](../../src/serviceFeatures/databaseDiagnostics.ts)、[fileRepair](../../src/serviceFeatures/fileRepair.ts) | 按文件和具体修订定位问题 |
| P2P 界面 | [P2PSync](../../src/features/P2PSync/)、[useP2PReplicatorUI](../../src/serviceFeatures/useP2PReplicatorUI.ts) | 房间、连接状态、设备及传输交互 |
| 日志与报告 | [ModuleLog](../../src/modules/features/ModuleLog.ts)、[reportTool](../../src/common/reportTool.ts) | 操作证据、诊断输出及敏感信息处理 |
| 多语言 | [translation](../../src/common/translation.ts)、[messagesYAML](../../src/common/messagesYAML/) | 编辑 YAML，再运行 `npm run i18n:bake` |

界面标签和设置键的完整映射以 [settings.md](../settings.md) 与 [settings_ja.md](../settings_ja.md) 为准，中文 Wiki 不另建一套配置键名。

## 当前加密的几个独立概念

| 概念 | 保护对象或作用 | 不应混同的内容 |
| --- | --- | --- |
| E2EE / `encrypt` / `passphrase` | 端到端数据加密 | 不代表本地 Vault Markdown 自动成为密文 |
| E2EE 算法版本 | 现有 V2 与兼容旧数据的 V1 路径 | 不等于未来方案的加密格式版本 |
| Security Seed | 远端用于密钥派生的盐，复制前需要准备 | 不是用户登录密码 |
| ID key | 独立生成加密 Chunk ID 和混淆 Metadata ID 的秘密 | 不等于正文加密口令 |
| ID recovery code | 保存或导入现有 ID key 的版本化表示 | 不能单独恢复所有正文加密秘密 |
| Path Obfuscation | 路径相关信息的隐私保护 | 不能推断远端所有 Metadata 均不可见 |
| Setup URI 口令 | 保护携带连接配置的 Setup URI | 与 Vault 内容加密口令有不同职责 |

当前设置还有 Property Encryption 和 `encryptInternalMetadata` 等能力。例如内部 Metadata 加密有远端类型和 E2EE 版本前置条件，开启设置不意味着旧修订立即被重写为密文。具体说明见 [设置文档](../settings.md)。

代码入口：[复制前检查](../../src/serviceFeatures/replication/preflight.ts)、[Security Seed 资源](../../src/common/replicatorResources/securitySeed.ts)、[Setup URI](../../src/serviceFeatures/setupObsidian/setupUri.ts)。加密底层及部分设置类型由 Commonlib 所有。

当前更改内容加密口令涉及既有重新加密和 Rebuild 流程，不能直接套用未来方案中“只重新包装主密钥”的设计。未来方案的恢复密钥、对象级密钥及草稿加密均以 [重写计划](../Cloud_Note/cloud_notes_rewrite_plan_zh.md) 为设计提案。

## 初始化、Fetch 和 Rebuild

需要先分清哪一侧是可信数据源，再理解维护动作：

| 动作 | 主要方向和目的 |
| --- | --- |
| 首设备初始化 | 从选定设备建立初始同步数据 |
| Fast Setup / Simple Fetch | 推荐用于第二台设备的初始获取；适用传输使用流式下载并延迟文件回写 |
| Reset Synchronisation on This Device | 重建该设备的本地数据库，从远端重新获取 |
| Overwrite Server Data with This Device's Files | 以当前设备文件为依据重建本地及远端数据 |

Fetch 过程中的本地独有文件、远端删除和时间比较有显式策略，不能概括为“无条件删除所有本地文件”。CouchDB Fast Fetch 的传输条件不满足时会回退普通路径，也不能推断所有 provider 都采用同一流式实现。

阅读入口：[redFlag.simpleFetch.ts](../../src/serviceFeatures/redFlag.simpleFetch.ts)、[Fast Setup 指南](../tips/fast-setup.md)、[故障恢复指南](../troubleshooting.md)。重建核心实现通过 Commonlib 的 `ServiceRebuilder` 装配。

## Flag 文件与 Scram

这些是恢复控制，不是普通笔记业务功能：

| 标记或状态 | 含义 |
| --- | --- |
| `redflag.md` | 停止正常启动处理 |
| `redflag2.md` / `flag_rebuild.md` | 触发重建流程 |
| `redflag3.md` / `flag_fetch.md` | 丢弃并重新获取本地数据库的流程 |
| `suspendFileWatching` | 暂停文件监听 |
| `suspendParseReplicationResult` | 暂停复制结果向文件的应用 |

标记文件位于 Vault 根目录。不要为了“让它启动”就删除标记或清除 Scram：它们可能是维护流程为防止错误回写而留下的状态。先根据 [troubleshooting.md](../troubleshooting.md) 查清触发原因、数据源和恢复方向，再执行相应操作。

## 排查时观察哪些边界

1. 配置是否加载，目标文件是否被过滤，数据库是否就绪。
2. 监听是否暂停，修改是否已进入本地数据库。
3. 活动远端是否正确，连接与加密前置检查是否通过。
4. 复制是否完成，必要的 Chunks 是否可读取。
5. 文件回写是否暂停、失败，或被本地修改和冲突保护阻止。

先缩小失败阶段，再决定是否维护数据库。连接成功、对象上传成功、复制完成和文件可用是四种不同证据。

[返回 Wiki 首页](README.md) · [下一章：开发、测试与发布](05-development.md)
