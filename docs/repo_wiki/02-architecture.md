# 02 架构与启动流程

## 分层结构

```text
Obsidian Plugin / CLI / WebApp 等宿主
    ↓ 提供各自的环境、界面和文件系统能力
ServiceContext + ServiceHub
    ↓ 装配依赖
LiveSyncBaseCore
    ├─ 中央远端 provider 定义
    ├─ ServiceModules：文件访问、文件处理、重建
    ├─ serviceFeatures：同步、调度、启动检查、命令
    ├─ add-ons：隐藏文件、配置同步、维护
    └─ legacy Modules：旧模块的生命周期绑定
    ↓ 调用共享实现
Commonlib：数据库、复制、文件处理、契约
```

这是职责图，不表示所有调用都必须逐层经过 Core。装配完成后，窄接口之间可以直接协作。

## 五种名称不要混淆

| 名称 | 含义 | 当前例子 |
| --- | --- | --- |
| ServiceContext | 提供特定宿主的上下文 | [ObsidianServiceContext](../../src/modules/services/ObsidianServiceContext.ts) |
| Service / ServiceHub | 长期存在的能力契约及其依赖集合 | [ObsidianServiceHub](../../src/modules/services/ObsidianServiceHub.ts) |
| ServiceModule | 宿主创建、可供多处使用的有状态能力或资源所有者 | [ServiceModules 类型](../../src/types.ts) 中的 `storageAccess`、`fileHandler`、`rebuilder` |
| serviceFeature | 接收声明依赖并注册处理器的功能组合函数 | [useReplicationFeature](../../src/serviceFeatures/replication/index.ts) |
| legacy Module | 继承旧模块基类，通过 `onBindFunction()` 绑定行为 | [ModuleLiveSyncMain](../../src/modules/main/ModuleLiveSyncMain.ts) |

`features/` 文件夹与 `serviceFeature` 概念也不是一一对应关系。新编排优先使用窄依赖的功能函数，已有旧模块按实际修改边界逐步整理。详见 [模块边界设计](../design_docs/service_feature_and_legacy_module_boundaries.md)。

## 关键服务

| 服务 | 负责什么 |
| --- | --- |
| `setting` | 加载、保存及应用配置 |
| `appLifecycle` / `control` | 生命周期处理器、启动、暂停、恢复及卸载控制 |
| `database` | 本地同步数据库的打开与访问 |
| `keyValueDB` | 检查点、待处理状态及来源记录等辅助持久化 |
| `vault` / `path` / `API` | Vault 判断、路径处理、宿主 API 及日志等能力 |
| `fileProcessing` / `databaseEvents` | 文件处理与数据库生命周期之间的协作 |
| `replicator` | 具体复制器的创建、活动实例和生命周期管理 |
| `replication` | 面向应用的同步操作和结果处理契约 |
| `conflict` / `UI` | 冲突处理协作及用户交互 |

准确构造关系见 [ObsidianServiceHub.ts](../../src/modules/services/ObsidianServiceHub.ts)。`replication` 表示应用要执行的同步行为，`replicator` 负责具体执行者，不能仅凭名称相似就合并两者。

## 插件装配顺序

[main.ts](../../src/main.ts) 的构造函数创建 `ObsidianServiceHub`，再创建 `LiveSyncBaseCore`。Core 内部按代码顺序：

1. 保存 Service Hub 并注册中央 provider。
2. 创建文件访问、数据库文件访问、文件处理和重建等 ServiceModules。
3. 创建并注册旧模块，此时尚未统一绑定其处理器。
4. 初始化核心 serviceFeatures，再初始化 Obsidian 特有功能。
5. 注册 ConfigSync、HiddenFileSync 和 LocalDatabaseMaintenance 等 add-ons。
6. 装配后置同步与基础命令功能，最后调用旧模块的 `onBindFunction()`。

同优先级处理器的注册先后可能影响运行顺序。不能随意将某段初始化代码提前，也不应在装配期间获取尚未打开的数据库实例。

## 从启动到可同步

主要调用链：

```text
Obsidian onload()
  → _startUp()
  → services.control.onLoad()
  → ModuleLiveSyncMain 的 onLoad 处理器
      连接事件 → 初始化 → 加载设置 → onSettingLoaded
      → 打开数据库 → onLoaded → 加载 add-ons
  → Obsidian workspace.onLayoutReady()
  → services.control.onReady()
  → ModuleLiveSyncMain 的 onReady 处理器
      onLayoutReady 检查 → Scram 状态处理
      → initialiseDatabase 扫描/协调
      → onFirstInitialise → applySettings → 额外安全扫描
```

这是主路径摘要，任一阶段都可能因为未配置、暂停、恢复流程或检查失败而提前退出。启动检查由 [startupLifecycle](../../src/serviceFeatures/startupLifecycle/startupLifecycle.ts) 及 [configuredStartupLifecycle](../../src/serviceFeatures/startupLifecycle/configuredStartupLifecycle.ts) 编排；flag 文件另见 [redFlag](../../src/serviceFeatures/redFlag.ts)。

普通启动允许部分单文件失败后报告问题并继续；数据库整体初始化失败会终止该就绪路径。显式 Fetch 和 Rebuild 有其更严格的流程，不能用普通启动的容错行为替代。

## 事件、资源和关闭

生命周期处理器、上下文事件和文件系统事件是不同的机制。阅读代码时要同时检查：谁注册、何时触发、是否等待完成、失败是否阻止后续步骤，以及卸载时如何释放资源。

`onunload()` 将关闭交给 `services.control.onUnload()`。Service Hub 注册了屏幕唤醒锁和通知资源的清理处理器。P2P 的共享服务、房间会话和传输所有权由 Commonlib 管理；界面不应另建一套连接所有者。

[返回 Wiki 首页](README.md) · [下一章：数据模型与同步流程](03-data-and-sync.md)
