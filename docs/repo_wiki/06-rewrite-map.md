# 06 重写影响与源码阅读路线

本章用当前代码解释我们讨论的重写范围。表中的新版内容是设计目标，尚未表示已实现；完整方案见 [云端笔记重写计划](../Cloud_Note/cloud_notes_rewrite_plan_zh.md)。

P0 的当前引用、构建和删除联动检查见 [P0 模块与删除范围验证](../Cloud_Note/p0_scope_validation_zh.md)。该报告区分已完成的静态核对与仍待实施的原型运行验收。

随后新增了独立验证原型，部分实际运行结果见 [P0 原型运行验证报告](../Cloud_Note/p0_runtime_validation_zh.md)。已有自动测试和浏览器互通证据，真实 Obsidian 与移动端验收仍未完成。

## 当前实现与目标架构

| 方面 | 当前实现 | 新版方案 |
| --- | --- | --- |
| 客户端范围 | Obsidian、CLI、WebApp、WebPeer | 首期交付 Obsidian 插件，全平台验证 |
| 本地同步数据 | PouchDB 和辅助键值数据库 | Vault 文件、必要状态文件、加密草稿和操作记录 |
| 中央服务 | 客户端使用 CouchDB 或对象存储 provider | Spring Boot API 协调 PostgreSQL 和 S3 兼容对象存储 |
| 正文 | 文件映射为 Metadata 和 Chunks | 加密 Markdown 版本对象 |
| 服务端数据库 | CouchDB 文档及修订模型 | PostgreSQL 元数据、版本关系及同步记录 |
| 笔记身份 | 当前路径/文档标识及兼容规则 | 稳定 `noteId` 与路径分离 |
| 版本 | 文档修订树及冲突分支 | 显式不可变版本及父版本关系 |
| 云端打开笔记 | 当前核心围绕本地 Vault 回写 | 云端自定义编辑器与本地原生编辑器并存 |
| 加密 | 现有 Commonlib E2EE、ID key 和重建契约 | 对象密钥、主密钥封装、恢复密钥及加密草稿 |
| 迁移 | 当前客户端与旧格式兼容逻辑 | 保留 Vault 文件，允许重新初始化远端 |

因此，替换 CouchDB 会同时影响复制协议、冲突模型、版本标识、检查点、初始化和恢复。PostgreSQL 连接驱动不能直接实现 CouchDB 文档复制契约。原对象存储 provider 也不能直接等同于新版对象上传服务。

## 模块处置建议

以下是阅读后的迁移建议，不代表可以直接复制代码或立即删除模块。

| 现有边界 | 新版如何处理 | 可参考内容 |
| --- | --- | --- |
| `main.ts` 与服务装配 | 新建隔离入口，逐步重组 | Obsidian 生命周期、依赖注入方式 |
| Vault / Path / 文件系统适配 | 审查后保留或简化 | 文件 API、路径别名防护、平台差异 |
| PouchDB 和键值状态 | 更换持久化设计 | 当前保存了哪些状态、重启后需要恢复什么 |
| provider / replication / scheduling | 重写传输协议和调度衔接 | 就绪检查、取消、生命周期及触发分层 |
| FileReflectionProvenance | 保留安全语义，重写数据格式 | 文件基于哪个版本、如何识别未修改内容 |
| 冲突与历史 | 适配新版本模型 | 保守合并策略、历史缺失和删除冲突场景 |
| 设置、通知与翻译 | 按新版流程调整 | 界面装配、通知生命周期、语言目录 |
| Setup / Fetch / Rebuild / flags | 设计新初始化和恢复流程 | 中断恢复、可信数据源选择，以及防止半完成写入 |
| Hidden File Sync / Customisation Sync | 单独确定新版范围 | 不应与普通笔记同步自动捆绑迁移 |
| CLI / WebApp / WebPeer / P2P | 新版首期不交付，迁移期保留参考 | 共享契约测试及跨宿主边界经验 |
| 测试基础设施 | 复用场景，按新协议替换断言 | 多设备、冲突、损坏、重启及部署验证方法 |

路径防护入口：[pathAliasGuard](../../src/serviceModules/FileSystemAdapters/pathAliasGuard.ts)。不要只保留“同步成功”测试，删除冲突、同时间不同内容、来源记录缺失和旧文件重启等场景更能暴露数据丢失问题。

## 建议的源码阅读顺序

1. [manifest.json](../../manifest.json) 和 [package.json](../../package.json)：先认清产物、依赖及命令。
2. [main.ts](../../src/main.ts)：看插件创建了哪些能力，不必立即深入每个导入。
3. [LiveSyncBaseCore.ts](../../src/LiveSyncBaseCore.ts)：看装配顺序和共享/宿主边界。
4. [ObsidianServiceHub.ts](../../src/modules/services/ObsidianServiceHub.ts)：理解依赖如何传递。
5. [ModuleLiveSyncMain.ts](../../src/modules/main/ModuleLiveSyncMain.ts)：沿启动主路径走一遍。
6. [StorageEventManagerObsidian.ts](../../src/managers/StorageEventManagerObsidian.ts) 和 [FileReflectionProvenance.ts](../../src/serviceModules/FileReflectionProvenance.ts)：理解文件事件与版本来源。
7. [replicatorProviders.ts](../../src/common/replicatorProviders.ts) 和 [replication/index.ts](../../src/serviceFeatures/replication/index.ts)：区分传输实现与业务编排。
8. [ReplicateResultProcessor.ts](../../src/serviceFeatures/replication/ReplicateResultProcessor.ts)：理解远端数据到 Vault 文件之间的处理。
9. [冲突规范](../specs_conflict_resolution.md) 与 [多设备测试](../../src/serviceModules/FileHandler.multidevice.integration.spec.ts)：用具体场景验证自己对流程的理解。
10. 再按实际问题进入 Commonlib 锁定包或独立仓库，避免从未使用的旧模块和注释分支开始追踪。

## 第一阶段落地点

先实现隔离的 Obsidian 验证入口，串起“编辑内容 → 客户端加密 → 保存加密草稿 → 关闭并重启 → 解锁恢复”。它验证加密、持久化和跨平台宿主能力三个基础边界。

这个阶段的输出应包括加密格式及测试向量、草稿恢复状态机、错误口令和损坏文件处理，以及桌面/Android/iOS 的实际验证记录。随后再接入 Spring Boot API、PostgreSQL 和对象存储，完成两设备同步。当前旧代码可继续作为行为参考，不需要在第一步先删除旧应用和数据库实现。

[返回 Wiki 首页](README.md)
