# 云端笔记服务端设计：Java / Spring Boot 基线

- 日期：2026-10-24
- 更新：2026-10-25；修订上传封存、事务、幂等与任务恢复规则，明确 P1 范围及低配部署验证。
- 状态：设计提案；本文不表示功能已经实现。
- 代码基线：仓库提交 `ce0524d49f4e1c840689d83d3f8f18fce383effb`，以及本次新增的 [server](../../server/) Spring Boot 骨架（当前只有应用入口与默认配置）。
- 技术基线：Java 21、Spring Boot 4.1.2、PostgreSQL、S3 兼容对象存储。
- 关联：[开发方案与实施计划](cloud_notes_rewrite_plan_zh.md)。
- 范围：本文承接计划中的服务端部分（§4.2 模块、§5 数据模型实现、§6 对象与版本、§8 增量同步、§14 API、§16 部署、§18 目录、§19～§20 阶段与测试），并把其中的 Go 表述替换为 Java 基线。数据模型逻辑、API 清单与安全约束以计划为准；本文不重复定义它们，只给出实现映射、技术选型与补充约束。本文与计划冲突时，先修订文档再写代码。

## 1. 已确认决策与不变约束

1. 服务端语言定为 Java 21；框架定为 Spring Boot 4.1.2（现有 [pom.xml](../../server/pom.xml) 为起点，不更换版本基线）。
2. 首版是单一模块化单体服务：API 与后台任务在同一进程；任务队列持久化在 PostgreSQL；不引入 Redis、消息中间件、微服务、独立搜索集群或 Kubernetes。
3. 正式客户端在上传前加密正文与附件；服务端不提供接收明文正文、明文附件、明文主密钥或 Vault 加密口令的业务接口。`vault_key_envelopes` 与加密 Metadata 对服务端是不透明数据；服务端不能仅凭任意字节或摘要证明调用方已正确加密。
4. 客户端只使用 HTTPS API，不直连 PostgreSQL 或对象存储；对象存储凭据只存在于服务端。
5. 单实例部署是首版承诺；多实例不作为验收项。提交结果、上传状态与任务租约持久化在数据库，重启后按状态核对和恢复；不能只凭采用行锁与租约便宣称恢复已实现。
6. 服务端验证的是密文的长度与摘要；它不能也不需要验证明文，认证解密由客户端完成（计划 §6.2、§15.1）。

## 2. 技术选型

| 组件 | 选型 | 用途与理由 | 明确不选的替代 |
| --- | --- | --- | --- |
| 运行时 | Java 21（LTS），配置启用虚拟线程并验证 | pom 已锁定；阻塞式调用保持易读，并发能力与资源占用以实测为准 | 更高版本（升级走独立变更） |
| Web 层 | Spring MVC（`spring-boot-starter-webmvc`） | 本方案采用阻塞式 JDBC 与 S3 客户端，首版保持单一调用模型；虚拟线程不能替代并发限制 | WebFlux |
| 数据访问 | `spring-boot-starter-jdbc`（`JdbcClient` / `NamedParameterJdbcTemplate`）+ 手写 SQL | 发布锁顺序、幂等语义与事务边界需要逐语句控制；SQL 与 Flyway 迁移一一对应 | JPA / Hibernate / MyBatis；jOOQ 首版不引入，P1 后按 SQL 维护成本评估 |
| 迁移 | Flyway（`flyway-database-postgresql`） | 版本化迁移文件，启动时 `validate`；对齐计划 §21 的可审查迁移要求 | 启动时自动建表、ORM schema 生成 |
| 鉴权 | Spring Security 过滤链 + 自定义设备令牌认证 | 无 session、无 cookie；设备令牌摘要比对 | OAuth2 / OIDC（首版单用户自托管，配对码机制足够） |
| 对象存储 | AWS SDK for Java v2（S3） | 服务端控制 multipart 写入与完整性验证；SDK 覆盖分段、校验和与兼容端点配置 | 预签名直传（后续优化，计划 §6.2）；第三方轻量 S3 客户端 |
| API 文档 | springdoc-openapi 生成 `openapi.yaml` | 计划 PROTO-01 要求 OpenAPI 定稿 | 手写 YAML 与代码漂移 |
| 观测 | Actuator、Micrometer、Logback JSON + MDC | `/healthz`、`/readyz`、指标与结构化日志（计划 §16） | 自研探针 |
| 测试 | JUnit Jupiter（版本由 Boot BOM 管理）、AssertJ、Testcontainers（PostgreSQL + MinIO）、MockMvc | 真实依赖的集成测试（计划 §20.1） | H2 / 内存 S3 模拟替代真实行为验证 |
| 格式与静态检查 | Spotless（P1 定稿具体格式配置） | 与现有 TypeScript 仓库的格式体系分开，不混用 ESLint | 复用前端 lint 配置 |

补充说明：

- 现有骨架的 starter（flyway、jdbc、security、validation、webmvc 及对应 test starter）与上表一致；P1 起步时需补充：AWS SDK v2 S3、springdoc-openapi、actuator、testcontainers、Spotless。
- 内容加解密与 Vault 口令派生在客户端（计划 §15）。服务端使用 SHA-256（`MessageDigest`）、常量时间比较（`MessageDigest.isEqual`）及安全随机数（`SecureRandom`）生成令牌与配对秘密；低熵配对码另外需要短有效期、尝试次数限制与限流，不能仅靠普通摘要保护。若管理入口接受管理员密码，使用 Spring Security 的适当密码哈希实现；管理员密码与 Vault 加密口令相互独立。

## 3. 模块与代码结构

包结构对应计划 §4.2 的服务端模块与 §18 的目录意图：

```text
server/
  pom.xml
  src/main/java/com/isogelun/server/
    ServerApplication.java
    config/        # @ConfigurationProperties 绑定、Security 过滤链、S3 客户端、调度配置
    api/           # /v1 控制器、DTO、错误模型（RFC 9457 ProblemDetail）、OpenAPI 注解
    auth/          # 配对交换、设备令牌签发与撤销、请求鉴权
    vaults/        # Vault、配额、能力协商、epoch 与 last_change_seq
    notes/         # 目录、路径校验、Metadata、隐私模式字段
    revisions/     # 修订提交、DAG、冲突分支、幂等操作记录
    uploads/       # 上传会话、分段接收、完整性验证、封存
    objects/       # blob 记录、引用核对、GC 状态机
    attachments/   # 附件身份与修订引用
    sync/          # changes 发布、游标编解码、目录快照
    storage/       # StoragePort 窄接口与 S3 实现
    search/        # 派生索引任务（仅 Metadata 可读模式）
    jobs/          # 租约任务执行器与各后台任务
    common/        # 事务模板、发布锁、ID/游标编解码、常量时间比较
  src/main/resources/
    db/migration/  # Flyway：V1__baseline.sql、V2__*.sql …
    application.yaml
  src/test/java/
    unit/          # 领域规则纯单测
    integration/   # Testcontainers + @SpringBootTest 集成测试
    contract/      # 与 TypeScript 共享的契约测试向量
```

依赖规则：

1. `api → 领域模块（auth、notes、revisions、uploads、sync…）→ common / storage`；反向依赖禁止。
2. `storage` 与 `jobs` 通过窄接口被领域模块使用；领域模块不直接引用 AWS SDK 类型。
3. 每个端点对应一个控制器方法与一个应用服务方法；应用服务持有事务边界，控制器不做事务与业务判断。
4. 不建立全能 Core 服务；共享状态放在有明确生命周期的所有者内（计划 §4.1 的原则同样适用于服务端）。

## 4. 数据库实现与迁移

计划 §5 的表是完整产品的逻辑模型。P1 先实现身份与配对、Vault、密钥包、笔记与修订、对象与上传、幂等、变更、快照，以及必要清理任务的数据结构；配对和分段记录按状态机补充。`V1__baseline.sql` 只包含已经审定的首批结构，后续通过新迁移增量交付；附件、搜索及完整 GC 不为凑齐全部表而提前冻结。要点：

- 跨 Vault 引用由外键与应用层双重校验；所有按 ID 的查询必须携带 `vault_id`，不做全局 ID 查询（计划 §5 约束 3）。
- 加密 Metadata、路径令牌与密钥包存 JSONB 或字节数组列；数据库不理解其内容，只在令牌列上建唯一约束（计划 §5 约束 8）。
- HikariCP 连接池需要为发布锁等待预留余量：发布事务开始时 `SET LOCAL lock_timeout`（默认 3 秒，可配置），锁超时回滚后返回带 `retryable=true` 的错误，而不是无限占用连接。
- 启动时执行 Flyway `validate`，并断言 schema 版本不低于当前二进制的最低要求；不满足则拒绝启动（计划 §21 的启动兼容性检查）。
- 迁移由显式升级步骤执行；只调用 `validate` 不会建立空数据库。需要明确配置 Spring Boot 的迁移策略，避免默认启动行为与上述流程不一致，并拒绝未经支持的 schema 版本。

### 4.1 发布锁（对齐计划 §8.2）

每个会发布 `changes` 的事务遵循同一锁顺序，用 `TransactionTemplate` 显式表达：

```java
transactional(tx -> {
    // 1. 先锁 Vault 发布行
    long seq = jdbc.queryForObject(
        "select last_change_seq from vaults where id = ? for update", vaultId);
    // 2. 先核对幂等记录；重复请求返回原结果，不检查已变化的笔记基线
    ...按操作 ID 查询并比较请求摘要，已完成则返回原结果...
    // 3. 再检查基线，按固定顺序锁定并修改资源行
    ...资源状态修改、修订或引用写入...
    // 4. 同一事务内递增序号并写变更与操作结果
    long next = seq + 1;
    insert("insert into changes (vault_id, epoch, seq, resource_id, kind, metadata_version) values (...)", next);
    update("update vaults set last_change_seq = ? where id = ?", next, vaultId);
    insertOperationResult(...); // 唯一记录；不能覆写既有结果
    // commit；失败回滚不推进可见游标
});
```

- 上传、摘要验证等耗时工作在事务外完成，再由应用服务开启一个短发布事务。入口不得已有持锁外层事务；不统一使用 `REQUIRES_NEW`，避免悬挂外层事务、额外占用连接或独立提交本应共同回滚的结果。引用对象前，在事务内重新校验对象已验证、未进入删除状态及其 Vault 归属。
- 单 Vault 内串行化是接受的代价（计划 §8.2）；跨 Vault 互不阻塞。
- 不使用 `BIGSERIAL` 最大值作为水位；`changes.seq` 由发布事务在锁内分配（计划 §8.2 的并发序号问题因此不成立）。

### 4.2 幂等与操作记录

- `operations` 上 `(vault_id, device_id, operation_id)` 唯一。修订发布在获取 Vault 发布锁后、检查笔记基线之前查询操作记录；相同请求返回原结果并标记 `duplicate`，不同请求返回 `OPERATION_ID_REUSED`。请求摘要绑定端点、目标资源和约定的规范化业务字段，不包含易变化的传输头。
- 修订、变更与确定操作结果在同一事务提交；重复请求不分配新序号。其他幂等写入也必须定义原子判定边界，不能假定它们自动受发布锁保护。唯一约束作为兜底；采用合适的 `ON CONFLICT`、保存点或完整回滚后重新查询，不能在约束错误已使事务失败时继续普通查询，也不能更新覆盖已有操作结果。
- 幂等记录与删除记录的清理任务保留期必须覆盖客户端重试窗口；超出窗口的旧操作按计划 §5 约束 7 要求重新协调，不得当作新请求执行。

### 4.3 游标与 epoch

- 游标使用版本化的 base64url 编码，携带 `{vaultId, epoch, seq}`；编码不是加密或授权依据。解码时限制长度并校验字段、目标 Vault 权限、epoch 与序号范围；跨 Vault 游标拒绝，epoch 不同返回 `EPOCH_CHANGED`，低于保留水位返回 `CURSOR_EXPIRED`，未来序号或非法格式返回参数错误。
- epoch 只由恢复工具显式变更；数据库记录变更保留水位，启动核对须允许合法历史裁剪。只有无法解释的水位或区间不一致才拒绝发布并要求核查，不能将正常清理判为损坏；恢复旧数据库后不能复用旧 epoch 接受设备游标。
- 设备检查点 `POST /devices/{deviceId}/checkpoint` 更新 `devices.last_confirmed_cursor`；GC 读取它判断保护窗口，但长期离线设备不阻塞回收（计划 §14）。

### 4.4 目录快照（对齐计划 §8.4）

- `POST /snapshots` 在一个 REPEATABLE READ 读写事务内，以同一数据库快照读取目录与当前水位，物化到 `catalogue_snapshots`；事务提交后才返回快照 ID 与截止序号。不能在只读事务中写普通表，也不在 HTTP 请求间持有事务。分批写入仍属于同一事务，不能用多个独立事务冒充一致快照。
- 快照分页读取 `GET /snapshots/{snapshotId}` 只读已物化行；快照带有效期，过期由任务清理。
- 单事务规模受 Vault 目录数量约束；10,000 篇笔记的快照创建耗时在 P1 性能基线中记录，超出目标先限制规模或优化物化写入。跨事务分块若确有需要，须另行设计一致快照方案并验证，不能仅将查询拆页。

## 5. 对象上传、验证与封存（对齐计划 §6）

P1 交付有明确大小上限的小对象上传、校验、封存与故障恢复，足以承载加密 Markdown。以下 multipart 约束用于保持协议一致，完整大附件分段续传在 P5 验收；P1 不宣称已支持该能力。

### 5.1 上传会话与分段

1. `POST /vaults/{id}/uploads` 创建会话：校验配额、生成长度上限与有效期、分配随机对象键 `vaults/{vaultId}/objects/{randomBlobId}`，记录在 `upload_sessions`（计划 §6.1 的地址规则）。
2. `PUT /uploads/{uploadId}/parts/{n}`：持久化分段号、长度、实测密文摘要、S3 ETag 与接收状态。同号同内容可重试，同号不同内容拒绝；不能用 S3 覆写同 `partNumber` 代替业务幂等。先以短事务登记分段接收权，I/O 在事务外执行；同段同时只允许一个写入者。不确定写入结果时先核对或终止旧会话，不能在旧请求仍可能写入时重新分配同一目标。
3. 控制器强制单段大小上限与请求体上限；不接受无法确定长度的无界流。分段大小上限、会话并发数上限与 TTL 都在 `config/` 集中配置。
4. 小对象路径：声明长度的单段上传先以固定缓冲写入受配额限制的临时文件，计算实际长度及摘要后写入独立 S3 对象。对同一目标的写入串行化；结果不确定时先核对，禁止旧重试覆盖已验证对象。崩溃后扫描临时文件与上传状态进行核对或清理，不能只依赖 `finally` 删除。该路径不使用 multipart，并采用下述隔离、校验与封存规则。
5. 加密块与 S3 part 分层：客户端的 256 KiB 加密块不是 S3 part；聚合后的 S3 part 除最后一段外至少 5 MiB，长度、数量和供应商限制在能力声明与集成测试中固定。聚合使用有界缓冲或临时文件，不累积整个附件到内存。

### 5.2 完成与封存

`POST /uploads/{uploadId}/complete`：

1. 用条件更新将会话从 `receiving` 转为 `completing`，阻止新增和替换分段，等待已登记的在途写入结束；固定可恢复的分段清单。不能在持有数据库事务锁时等待网络 I/O。
2. multipart 路径用 `ListParts` 对照持久化清单，核对分段号、长度与 ETag，再调用 `CompleteMultipartUpload`。完整对象在完成后才可读；不能先读完整对象再 complete。小对象路径在单次写入完成后进入同样的未验证隔离状态。
3. 对象进入 `verifying` 阶段，禁止普通客户端下载与修订引用；从 S3 流式读回密文，单遍计算 SHA-256 与实际总长度，匹配会话约定后才允许发布。客户端自报摘要只作交叉比对；S3 ETag 不等同于完整对象 SHA-256。
4. 在短事务内记录服务端实测摘要、字节数与格式字段，将对象标记 `verified`，持久化完成结果。此后不提供覆写 API；所有重试只查询或返回同一完成结果。引用关系只在后续修订提交事务内建立。

会话的 `receiving`、`completing`、`verifying`、`verified` 与失败状态须持久化并支持查询；这与 `blobs` 的引用和删除状态分开。S3 写入成功但数据库更新失败时，以预先登记的对象键核对并重新验证；不能盲目再写同一对象，也不能将未登记结果直接视为 `verified`。完成调用超时、验证中断及完成响应丢失均要有恢复测试；验证不符时保留明确失败结果，禁止引用并按策略清理。

### 5.3 失败与回收（对齐计划 §6.3）

| 失败路径 | 处理 |
| --- | --- |
| 对象写入失败 | 会话保持未完成，客户端重试或重建会话；不发布修订 |
| 对象写入或 complete 成功，但状态更新失败 | 会话保留不确定状态，按固定对象键核对并重新验证；不保证数据库已有 `verified` 记录 |
| 已验证但修订提交失败 | 保留未引用对象，查询操作结果或使用同一操作 ID 重试修订提交 |
| 数据库成功但响应丢失 | 同一 `operationId` 返回原结果（§4.2） |
| 已提交对象读取失败 | 下载授权接口返回明确错误，客户端按计划 §6.3 显示版本不可用 |
| 会话过期 | 先阻止新写入并协调在途请求；未完成 multipart 执行 abort，已形成对象走未引用对象核对与清理，不能只 abort 或先删会话记录 |
| GC（P5） | 在与引用提交互斥的数据库锁下标记 `deleting`，禁止新引用；宽限期后复核当前版本、冲突、历史、会话、快照、备份与检查点保护，再删除对象并记录结果。仅引用计数不作为删除依据；P1 关闭已提交内容的自动 GC |

## 6. 鉴权与设备管理（对齐计划 §15）

- 配对：`POST /pairing/exchange` 校验一次性短期配对码，事务内原子消费配对资格并创建设备凭据，限制尝试频率与次数；令牌格式暂定 `v1.<keyId>.<secret>`，`secret` 为安全随机生成的 256 位值，数据库只存摘要（计划 §5 `device_tokens`）。响应丢失后的重新配对或恢复流程须明确定义，不保存可直接使用的令牌明文。
- 请求鉴权：Security 过滤链解析令牌 → 摘要常量时间比对（可带短 TTL 缓存，撤销时立即失效）→ 校验设备存在、未撤销、未到期、属于目标 Vault。
- 无效令牌返回 401；已认证但被撤销的设备返回 `DEVICE_REVOKED`。对外不区分其他失败细节，避免泄露存在性。
- 撤销 `POST /devices/{deviceId}/revoke` 只阻断后续访问，不影响设备已下载内容与密钥；密钥泄露场景走计划 §15.4 的轮换流程，不在本服务端范围内自动处理。
- 管理入口（初始化管理员、配对码生成）是服务的受保护管理端点或附带工具，不属于笔记 API（计划 §16）。
- 密钥包端点 `GET /key-envelopes` 与 `POST /key-envelopes/replace` 只搬运不透明数据；`replace` 带包版本条件更新，冲突返回明确错误，服务端不解包。

## 7. API 实现映射

端点清单沿用计划 §14 的表格，本文只补充实现层约束。其他章节的简写路径在实现和 OpenAPI 中必须还原 `/v1` 及 `/vaults/{id}` 前缀，并检查资源的 Vault 归属：

- 错误模型：RFC 9457 ProblemDetail；`type` 使用稳定的问题类型 URI，扩展字段 `code` 携带计划 §14 的错误码。`committed` 与 `conflicted` 表示确定的业务结果，`duplicate` 标记对原结果的重放并保留其结果字段；`retryable` 是错误响应的重试属性，不是成功保存状态。HTTP 状态、错误码、是否已提交及后续动作在契约中逐项定义。
- OpenAPI 由 springdoc 从控制器注解生成，构建产物包含 `openapi.yaml`；契约测试校验错误码枚举与响应 schema。
- 横切限制：请求体上限、分页上限、上传会话数与快照并发上限、会话 TTL 集中在配置；所有端点默认受限，不依赖调用方自觉。
- 重试语义：网络错误或 5xx 可能发生在提交之后；有副作用的请求须查询结果或以同一操作 ID、同一内容重放，不生成新操作 ID。429 与暂时不可用按契约及 `Retry-After` 退避；版本冲突、游标失效与策略变化按错误码重新协调，不能只按 HTTP 大类盲目重试。收到未知结果时保留客户端草稿。
- `GET /events`：首版用 Spring WebSocket 提供"可能有变化"提示，按设备订阅其所属 Vault；允许丢失、重复与乱序（计划 §8.1），重连与轮询是客户端的兜底。排在 P1 之后，不是两设备闭环的前置条件。

## 8. 后台任务（对齐计划 §5 `jobs`）

- 租约执行器：`@Scheduled` 以短事务领取已到执行时间的 `queued` 任务或租约过期的 `running` 任务；使用数据库时间、`FOR UPDATE SKIP LOCKED` 与批量上限，领取时设置 owner、lease_until 并递增执行代次。执行 I/O 在事务外完成。
- 续租、成功、失败与重试更新均条件匹配任务 ID、owner、执行代次及有效租约；过期执行者不能修改新执行者的结果。数据库代次不能取消已经发出的 S3 请求，外部操作仍须幂等，并由对象状态机隔离不确定结果；租约到期不能被当成旧 I/O 已停止的证明。
- 配置重试上限、退避、失败记录与人工重试入口。P1 实现上传临时资源、会话与快照清理等必需任务；幂等记录保留策略必须先定义，清理不能破坏重试窗口。完整对象 GC、派生索引重建与备份核查按 P5/P6 推进。
- 单实例部署即单执行器；租约与 `skip locked` 语义兼容将来的多实例，但首版不测试也不宣称多实例支持。

## 9. 观测、部署与运维（对齐计划 §16）

- Actuator 探针组：liveness 与 readiness 分开；反向代理可将其暴露为 `/healthz`、`/readyz`。诊断入口需要管理凭据。
- 指标（Micrometer，Prometheus 格式）：请求延迟分布、发布事务耗时与锁等待、提交结果分类计数、对象校验失败数、任务积压与失败、连接池饱和、S3 错误率。
- 日志：Logback JSON 编码；过滤器生成 `requestId` 并写入响应头；日志不包含正文、密钥、令牌与签名 URL（计划 §15.6）。
- 交付物：多阶段 Dockerfile（Temurin 21 JRE，分层 jar）、`compose.yaml` 与 `example.env`。生产默认是 server、PostgreSQL 及外部 S3；已有反向代理可复用。MinIO 放在开发测试或显式可选 profile 中，不在 2 核 2 GB 生产配置中默认启动；固定镜像版本。
- 备份与恢复：`pg_dump` 一致备份 + 引用对象清单 + 对象复制由备份任务协调（计划 §16 的一致性要求）；恢复工具在隔离环境执行核查并递增 epoch；恢复演练是发布门槛。

### 9.1 2 核 2 GB 共用服务器的验证约束

以下为 P1 压测起点，不是已证明的最低规格或资源承诺：

- JVM 从 `-Xms128m -Xmx256m` 起测；容器总内存上限暂以 512 MiB 验证，须为元空间、直接内存、线程栈与其他本机内存留余量。根据启动与实际负载修订，不能将 `Xmx` 当成进程总占用。
- HikariCP 先采用 maximumPoolSize=5、minimumIdle=1；限制锁等待、语句执行时间与连接获取时间，后台任务共享此预算，不额外建立大池。
- 初始每实例最多 2 个对象传输、1 个快照生成任务、1 个清理任务；入口在读取大请求体前执行有界准入，超限明确拒绝或退避，避免虚拟线程与等待队列无限增长。读写缓冲、SDK 重试、HTTP 连接数与超时一并受限。
- 为临时密文文件设置总字节配额、单文件上限与保留期；配额不足先拒绝上传，失败或重启后的清理由状态机核对，不能删除仍被在途任务使用的文件。
- PostgreSQL 连接数、共享缓冲与查询内存单独预算；服务内存上限不覆盖数据库、系统、代理、文件缓存或已有其他服务。默认不部署 Redis、消息队列或独立监控栈。
- 在启动、10,000 篇目录快照、双设备提交、并发传输与清理时记录 CPU、容器内存、JVM 堆/非堆、进程 RSS、磁盘及交换使用；同时记录原有服务负载。验收报告说明对象大小、并发、限额、延迟与是否发生 OOM。没有真实共用服务器测试时，只报告受限环境结果，保留共存验收项。

## 10. 测试与验收（对齐计划 §20）

| 层 | 内容 | 入口 |
| --- | --- | --- |
| 纯单测 | 修订 DAG、冲突判定、路径校验、游标编解码、幂等判定、配额计算 | `mvn test` |
| 集成 | Testcontainers 真实 PostgreSQL 与 MinIO；注入延迟、断连、事务失败；发布锁并发回归（并行提交断言 seq 严格有序、无跳号、失败不推进水位） | `mvn verify` |
| 契约 | OpenAPI schema、错误码枚举、与 TypeScript 共享的测试向量（游标编码、错误语义；密码格式向量属于客户端） | `src/test/java/.../contract/` |
| 故障演练 | P1：小对象写入与验证中断、响应丢失、重复请求、快照事务、过期租约重领与旧执行者回写、epoch 及重放窗口；P5：multipart 竞争与 GC/新引用并发 | 集成测试专用 profile |
| 性能 | 按计划 §20.3 记录：JVM 堆与 RSS 基线、发布吞吐、上传吞吐、快照创建耗时 | P1 记录基线 |

CI：在现有 workflow 之外新增服务端 job（`mvn verify`，包含 Spotless 检查），在服务端、共享契约或相关 CI 配置变更时触发；与旧插件发布 job 分开运行。

Surefire 执行 `*Test` 纯单测，Failsafe 在 `integration-test` / `verify` 执行 `*IT` 集成测试；绑定 Spotless 检查到 verify。Testcontainers 的依赖不可用时，集成验收应明确失败，不通过跳过测试宣称通过。共享契约与 CI 配置变更也应触发服务端检查。测试框架版本跟随 Spring Boot BOM 核对，不额外强制覆盖生成骨架所管理的 JUnit 版本。

## 11. Java 基线特有的风险与待定项

| 项 | 处理方向 | 冻结或记录阶段 |
| --- | --- | --- |
| JVM 资源占用高于 Go 二进制 | P1 记录单实例堆与 RSS 基线，据此给出最低部署规格；不先验地宣称小规格 VPS 可用 | P1 |
| 虚拟线程 pinning（`synchronized` 与原生调用阻塞） | 用真实负载测量；热点路径必要时改用显式锁或调整实现 | P1～P2 |
| Spring Boot 4.1 起步版本较新 | 锁定精确版本；升级作为独立变更，不随功能改动升级 | 全程 |
| S3 兼容实现差异 | 按计划 §22 只验证一个本地实现（MinIO）与一个目标云服务 | P1～P5 |
| SQL 维护成本 | 首版手写 SQL；数量或复杂度超预期再评估 jOOQ | P1 后 |
| 多实例部署 | 语义兼容（行锁、租约、幂等），但未测试不宣称支持 | P6 后再决定 |
| WebSocket 状态 | 单实例内存态订阅即可；不引入外部 broker | P1 之后 |

## 12. 落地顺序（P1 起步）

P1 以两个测试客户端完成授权、密钥包获取、密文上传、修订提交、增量读取及客户端解密为退出闭环；真实 Obsidian 监听与文件反映属于 P2。P0 真机、密码格式和 Metadata 决策未完成时，可开展工程与非争议基础工作，受影响字段仍保留草案状态，不冻结生产协议、不迁移实际 Vault 或删除旧代码。

1. 先审定协议草案、错误与幂等语义、状态机及数据库事务规则；补充兼容 Spring Boot 4.1.2 的 AWS SDK v2、springdoc、actuator、testcontainers、Spotless 等依赖，锁定实际版本，并使开发配置与测试入口可运行。
2. Flyway 首批迁移：实现 P1 所需结构、约束与索引（任务 DB-01），包含配对状态；后续迁移随模块递增，不一次冻结完整产品的所有表。
3. 配置绑定、Security 过滤链、`StoragePort` 与 S3 实现、租约执行器及必要清理任务。
4. `GET /capabilities`、配对、设备令牌、密钥包端点（鉴权闭环）。
5. 小对象上传会话、完成、验证与封存（任务 OBJ-01），覆盖状态不确定与重试；完整大附件 multipart 续传在 P5 交付。
6. 修订提交、冲突分支、幂等记录与发布锁（任务 DB-01 的提交顺序故障测试）。
7. 快照与 `changes` 拉取、目录端点；用测试客户端完成双设备加密闭环、权限与故障回归及 §9.1 资源测试，再接入 P2 的 Obsidian 双设备闭环。

P1 验收记录须同时覆盖密钥包条件更新、重复提交确定返回、变更不漏读、重启恢复与资源基线。协议与日志无明文正文、附件或 Vault 密钥；服务端不承担鉴别任意上传字节是否正确加密的责任。附件产品体验、完整合并界面、自动 GC、索引重建与完整备份恢复工具分别在后续阶段完成。

实现依据：[S3 multipart 流程](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html)、[S3 分段限制](https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html)、[PostgreSQL 事务模式](https://www.postgresql.org/docs/current/sql-set-transaction.html)、[事务失败与保存点](https://www.postgresql.org/docs/18/tutorial-transactions.html)。以上修订是设计约束，不代表这些场景已通过运行验证。

## 13. 与计划章节的映射

| 计划章节 | 本文处理 |
| --- | --- |
| §4.2 服务端模块 | §3 包结构与依赖规则 |
| §5 数据模型 | §4 迁移、锁与约束实现（表定义不重复） |
| §6 对象与版本模型 | §5 |
| §8 增量同步与游标 | §4.1～§4.4 |
| §14 API 契约草案 | §7 实现约束（端点清单不重复） |
| §15 鉴权与端到端加密 | §6（服务端边界不变） |
| §16 部署、运维与数据出口 | §9 |
| §18 建议目录结构 | §3 |
| §19、§20 阶段与测试 | §10、§12；计划中 P1 工作包与测试命令已同步为 Java 表述 |
