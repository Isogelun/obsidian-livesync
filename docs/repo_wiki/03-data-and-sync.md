# 03 数据模型与同步流程

## 一篇笔记有三种需要区分的状态

| 状态 | 保存位置 | 作用 |
| --- | --- | --- |
| Vault 文件 | 用户的文件目录 | Obsidian 编辑和读取的 Markdown、图片等真实文件 |
| 本地数据库文档 | 本机 PouchDB | 文件 Metadata、内容 Chunks，以及文档修订和冲突 |
| 远端副本 | CouchDB、对象存储或其他 P2P 节点 | 在设备之间传播同步数据 |

另外还有本地键值状态。当前 [KeyValueDB.ts](../../src/common/KeyValueDB.ts) 导出的 `OpenKeyValueDatabase` 来自 [KeyValueDBv2.ts](../../src/common/KeyValueDBv2.ts)，通过 IndexedDB 持久化。阅读时不要误把同文件中 `_OpenKeyValueDatabase` 的旧实现当成当前导出。

数据库同步完成，不代表文件回写已经完成。这两个步骤之间可能隔着就绪检查、内容块获取、暂停、冲突判断或失败重试。

## Metadata、Chunks 和 Revision

以下为概念模型，不是可直接提交到数据库的 JSON Schema：

```text
文件 Metadata
  文档标识、路径、时间、大小、类型
  内容块引用 → Chunk A、Chunk B、Chunk C
  PouchDB 修订信息 → 当前文档分支

内容 Chunks
  实际文本或二进制内容的分块表示
```

Metadata 负责描述文件并引用内容，Chunks 承担正文。共享块有助于减少重复内容传输。历史上的 Eden 兼容机制可能将新块暂存于文档中；它不应成为新增设计将正文直接写入 Metadata 的依据。

Revision 是 PouchDB/CouchDB 文档修订，不是预先设计好的“每次保存一个完整 Markdown 对象”的业务版本。文件历史能否完整读取，还取决于修订内容和引用块是否仍保留。Compaction 和 GC 会影响可恢复范围，因此同步历史不能直接当作永久备份。

术语依据：[项目词汇表](../glossary.md)、[冲突规范](../specs_conflict_resolution.md)、[垃圾回收规范](../specs_garbage_collection.md)。

## 本地修改如何到达另一台设备

以 CouchDB 通道为例：

1. 用户修改 Vault 文件，Obsidian 产生文件事件。
2. [StorageEventManagerObsidian](../../src/managers/StorageEventManagerObsidian.ts) 及其共享基类接收、过滤和协调事件；启动扫描还会处理应用关闭期间发生的修改。
3. 文件访问和文件处理能力读取内容，将 Metadata 和 Chunks 更新到本地数据库。入口由 [main.ts](../../src/main.ts) 装配，实际核心算法位于 Commonlib。
4. [replicationScheduling](../../src/serviceFeatures/replicationScheduling.ts) 和 [automaticTriggers](../../src/serviceFeatures/replication/automaticTriggers.ts) 根据设置决定何时复制。
5. CouchDB Replicator 将本地数据库变化与远端交换。
6. 另一设备接收文档后，通过 [ReplicateResultProcessor](../../src/serviceFeatures/replication/ReplicateResultProcessor.ts) 处理结果，再经文件处理及存储接口回写 Vault。

处理器会保留待处理状态，并在应用就绪后继续处理。判断“没有同步成功”时，应分别确认文件是否入库、数据库是否复制，以及结果是否已安全写回文件。

## 删除事件与物理删除不同

Vault 发生删除产生的文件事件，首先请求更新数据库状态。远端删除传播回来时，文件回写路径还需要核对当前状态，才能决定是否实际删除文件。

这一区分避免将排队事件误当成无条件文件系统操作。普通删除、冲突中的删除、恢复后的删除检查，以及重命名有各自契约。详见 [文件事件与存储写入](../tech_info.md) 和 [冲突规范](../specs_conflict_resolution.md)。

## 三种同步通道

| 通道 | 本仓库入口 | 当前重要差异 |
| --- | --- | --- |
| CouchDB | `LiveSyncCouchDBReplicator` | 支持中央远端单次复制和 continuous capability |
| S3 兼容对象存储 | `LiveSyncJournalReplicator` | 通过 Journal 复制；当前 provider 的 continuous capability 为不适用 |
| WebRTC P2P | `useP2PReplicatorFeature` | 在 `main.ts` 中单独装配，共享服务及连接生命周期由 Commonlib 提供 |

前两种的完整能力表见 [replicatorProviders.ts](../../src/common/replicatorProviders.ts)，P2P 装配见 [main.ts](../../src/main.ts)。对象存储不支持此处的 continuous capability，不代表它完全不能自动同步；它仍可由定时或事件触发单次同步。

`LiveSync mode`、Periodic Sync 和 On Events 描述调度方式；CouchDB、对象存储和 P2P 描述传输路径。这两个维度应分开理解。信令 relay 协调 P2P 发现和连接，TURN 是必要时转发连接流量的另一种设施。

## 冲突为什么不能按最后修改时间解决

```text
共同修订 R0
   ├─ RA：设备 A 修改后的内容
   └─ RB：设备 B 离线修改后的内容
```

PouchDB 可以选择一个确定性的 winner，但 winner 不等于用户认可的最终版本，也不保证当前 Vault 已展示该分支。

当前实现区分：

- `winner`：数据库规则选出的当前分支。
- `Vault-matching`：内容与目前文件一致的修订，可能不止一个。
- `displayed`：该设备记录的、最近回写至文件的确切修订。

[FileReflectionProvenance](../../src/serviceModules/FileReflectionProvenance.ts) 将来源记录接入设备本地键值存储。文件未变时，可根据确切修订或保存的内容哈希与长度识别；文件发生真实编辑时，应延伸其原本展示的分支。仅比较修改时间和大小不足以证明内容没有变化。

例如远端已经解决冲突，但设备 B 的文件仍是旧 RB。若 B 没有编辑，就应应用已解决的结果；若 B 又修改了 RB，则必须保留这次新修改，不能因为数据库已选定 RA 就覆盖它。

自动合并需要可用的共同祖先及安全的内容比较。缺少合并基准、修改重叠或二进制版本不同，应按冲突策略保留并交由用户处理。显式选择的按时间覆盖选项另有政策，不能将它当成系统默认保证。

源码导航：[conflictResolution](../../src/serviceFeatures/conflictResolution/)、[interactiveConflictResolution](../../src/serviceFeatures/interactiveConflictResolution/)、[多设备集成测试](../../src/serviceModules/FileHandler.multidevice.integration.spec.ts)。

[返回 Wiki 首页](README.md) · [下一章：功能、加密与恢复](04-features-and-recovery.md)
