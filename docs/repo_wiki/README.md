# Self-hosted LiveSync Repo Wiki

这份中文 Wiki 面向第一次阅读仓库、准备调试同步问题，或参与后续重写的开发者。它解释当前项目如何工作，并提供可直接打开的源码导航。

## 阅读基线

| 项目 | 本次记录 |
| --- | --- |
| 核对日期 | 2026-10-23 |
| 仓库提交 | `ce0524d49f4e1c840689d83d3f8f18fce383effb` |
| 插件版本 | `1.0.39` |
| Commonlib 依赖 | `@vrtmrz/livesync-commonlib`，精确版本 `0.1.44` |
| Obsidian 最低版本声明 | `1.7.2` |
| 移动端声明 | `isDesktopOnly: false` |
| 核对方式 | 本仓库源码、配置、测试代码，以及已有设计文档的静态阅读 |

版本依据：[package.json](../../package.json)、[manifest.json](../../manifest.json)。本次没有安装依赖、运行构建或执行测试；平台声明和已有测试用例不等于本次已完成运行验证。Commonlib 的内部实现以其独立仓库及锁定包为准，本 Wiki 不将未读取的依赖内部细节作为已核实源码。

## 先理解这个项目

Self-hosted LiveSync 将设备上的 Obsidian Vault 文件转换为本地数据库中的文档，再通过同步通道与其他设备交换这些文档，最后将收到的内容写回 Vault。

```text
设备 A                                            设备 B
Vault 文件                                        Vault 文件
    ↕ 文件事件、扫描和文件回写                         ↕
本地 PouchDB         ← 同步通道 →                   本地 PouchDB
                         │
              CouchDB / S3 兼容对象存储 / P2P
```

这里的三个同步通道使用不同的传输实现，图中只展示它们共同承担的角色。P2P 是设备间连接，不要求经过中央内容存储。

当前最重要的五个事实：

1. Vault 是真实文件目录，Markdown 和附件仍由 Obsidian 及文件系统承载。
2. 本地 PouchDB 是同步模型的一部分，保存 Metadata、Chunks，以及修订信息；另有键值数据库保存辅助状态。
3. 对象存储已经是现有远端选项，采用 Journal Replicator；它不是后续方案中新增的 PostgreSQL 内容对象层。
4. 大量平台无关逻辑已移到外部 Commonlib 包，本仓库主要负责宿主适配、功能装配、界面，以及下游验证。
5. 当前还有 CLI、WebApp 和 WebPeer。讨论中的 Java（Spring Boot）、PostgreSQL、无本地数据库及云端编辑器属于未来方案。

## 章节导航

| 章节 | 适合解决的问题 |
| --- | --- |
| [01 项目组成与目录地图](01-project-map.md) | 有哪些应用、依赖和目录？先读哪些文件？ |
| [02 架构与启动流程](02-architecture.md) | Service、ServiceModule 和 serviceFeature 有什么区别？启动如何串起来？ |
| [03 数据模型与同步流程](03-data-and-sync.md) | Markdown 怎样变成数据库记录？如何上传、下载和处理冲突？ |
| [04 功能、加密与恢复](04-features-and-recovery.md) | 设置、加密、隐藏文件、历史，以及恢复流程在哪里？ |
| [05 开发、测试与发布](05-development.md) | 如何构建、选测试、定位故障和理解发布流程？ |
| [06 重写影响与源码阅读路线](06-rewrite-map.md) | 当前实现与新版有何差异？哪些能力可以参考，哪些需要重写？ |

建议先读 01、02 和 03，建立整体理解，再按具体问题查阅 04、05 和 06。每章可以从页尾返回本页。

## 常用问题入口

| 想了解的事情 | 首先查看 |
| --- | --- |
| 插件如何启动 | [main.ts](../../src/main.ts)、[架构章节](02-architecture.md) |
| 本地数据库是什么 | [数据章节](03-data-and-sync.md) |
| 为什么收到远端数据后文件还没有更新 | [ReplicateResultProcessor](../../src/serviceFeatures/replication/ReplicateResultProcessor.ts)、[同步流程](03-data-and-sync.md) |
| 为什么不能只替换 CouchDB 驱动 | [重写映射](06-rewrite-map.md) |
| 如何避免旧文件覆盖新版本 | [FileReflectionProvenance](../../src/serviceModules/FileReflectionProvenance.ts)、[冲突规范](../specs_conflict_resolution.md) |
| 如何开始安全调试 | [开发与故障定位](05-development.md) |
| 新版完整开发计划 | [云端笔记重写方案](../Cloud_Note/cloud_notes_rewrite_plan_zh.md) |
| 新版服务端如何实现 | [服务端设计：Java / Spring Boot 基线](../Cloud_Note/server_design_java_zh.md) |

## 维护原则

本 Wiki 是当前实现的阅读指南，不替代正式协议、设置说明或测试证据。源码行为变动后，应同时更新相关章节和上述基线。说明不一致时，优先核对当前入口、实际导入、配置及测试，再检查历史文档；尤其不要把源码中的旧注释或已注释掉的代码视为当前运行路径。
