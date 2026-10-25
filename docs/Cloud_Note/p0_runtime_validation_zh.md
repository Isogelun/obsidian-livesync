# P0 原型运行验证报告

- 日期：2026-10-23。
- 代码基线：`ce0524d49f4e1c840689d83d3f8f18fce383effb`，另含本次新增原型及文档。
- 结论：已完成部分 P0 实际运行验证，核心加密、文件草稿恢复、浏览器互通和基础传输重试通过；P0 整体尚未通过退出验收。
- 原型：[prototypes/p0](../../prototypes/p0/README.md)。
- 自动生成的原始结果：[validation-results.json](../../prototypes/p0/validation-results.json)。
- 既有静态核对：[模块与删除范围验证](p0_scope_validation_zh.md)。

## 1. 本次实际实施

新增独立 npm 包、Obsidian 插件入口、manifest、构建和测试脚本。插件 ID 为 `livesync-cloud-p0-validation`，构建输出为 `prototypes/p0/dist`；没有自动安装到用户 Vault，没有删除旧源码或修改旧插件业务入口。

原型包含密码/恢复密钥解锁、独立内容密钥、草稿认证加密、文件代次记录、最小输入与锁定界面，以及流式认证加密验证。真实 Obsidian 界面尚未运行，不能将已构建的插件描述成已完成宿主验收。

## 2. 环境与候选配置

| 项目 | 本次环境或候选 |
| --- | --- |
| 操作系统与架构 | Windows，x64 |
| Node.js | `v24.22.1` |
| 浏览器 | 本机 Edge，Chromium 版本 `155.0.4283.62`，无头临时 profile |
| 口令派生 | hash-wasm `4.12.0`，Argon2id：64 MiB、3 次迭代、1 lane |
| 小型正文与密钥包装 | Web Crypto AES-256-GCM；HKDF-SHA-256 用途分离 |
| 分段加密 | libsodium-wrappers-sumo `0.8.4`，secretstream；256 KiB 明文段 |
| 原型草稿上限 | 单份 2 MiB UTF-8、最多保留 128 代；达到上限拒绝新增，不自动丢弃草稿 |
| Android / iOS | 用户确认暂时没有可用真机，本次未验证 |

这些是原型参数，不是经过低配手机测量后冻结的产品参数。依赖精确版本和完整性由原型自己的锁文件记录。

## 3. 已运行并通过的检查

执行入口：

```sh
npm --prefix prototypes/p0 run verify
```

| 检查 | 实际结果 | 覆盖边界 |
| --- | --- | --- |
| 原型 TypeScript 检查 | 通过 | 独立 tsconfig、源代码和测试 |
| 自动测试 | 11 项通过，0 项失败 | 测试内部还包含多种错误输入和损坏方式 |
| 独立插件构建 | 通过，`main.js` 56,480 字节 | metafile 未发现 Commonlib、PouchDB、`idb` 或旧 Core；外部模块仅 Obsidian |
| 原型 iOS 15 静态兼容检查 | 通过 | 对原型产物单独运行现有兼容脚本；只检查语法规则，不证明移动端 API、WASM 或宿主运行成功 |
| Argon2id 交叉实现比较 | 通过 | hash-wasm 与 Libsodium 使用相同输入和参数得到相同结果 |
| AES-GCM 固定向量 | 通过 | AES-256-GCM 零密钥/零 nonce 测试向量解密；零值仅用于该固定测试 |
| 密钥包行为 | 通过 | 口令、恢复密钥、改口令重新包装、错误凭据、异常 KDF 参数拒绝 |
| 草稿身份和内容认证 | 通过 | 绑定 Vault、设备、笔记、代次；错误密钥和修改密文拒绝 |
| 实际磁盘恢复 | 通过 | 文件写入、串行保存、回读；最新一代写坏时保留损坏文件并明确报告回退 |
| 进程终止后恢复 | 通过 | 子进程确认保存后被终止，新进程读取密钥包、解锁并恢复第二代中文草稿 |
| 写入失败 | 通过 | 故障注入不会返回保存成功，随后保存仍可进行 |
| 流式完整性 | 通过 | 空内容、正常段、错误身份、缺段、乱序、重复、篡改、截断和末尾额外数据 |
| 本机 HTTP 重试 | 通过 | 测试服务已接收密文但返回 503；客户端重发相同密文字节，最终下载可解密 |
| Node 与浏览器双向互通 | 通过 | 两侧生成的数据可由另一侧解密，中文和 emoji 一致 |
| 浏览器文件持久化 | 通过 | 写入 OPFS 文件，重载页面后重新解锁并恢复草稿 |

固定 Argon2id 向量使用合成口令 `P0 中文 password`、16 字节 `0x02` salt，以及上表参数，32 字节输出为：

```text
c8a0c730e8f4d07c8b31ba460a5d13beacc9a08d66cdc74f336ce75831a465e3
```

该向量是本原型的互通向量，不冒称 RFC 原文中的向量。它先经过两个实现比较，再用于 Node/浏览器交叉检查。

## 4. 桌面性能观察

以下为原始结果文件所记录的一轮运行，不作为性能承诺：

| 测量 | 结果 |
| --- | --- |
| Node 密钥包创建 | 193 ms |
| Node 口令解锁 | 182 ms |
| 浏览器密钥包创建 | 181 ms |
| 8 MiB 分段加解密 | 61 ms；RSS 基线 131 MiB，采样峰值 148 MiB |
| 128 MiB 分段加解密 | 765 ms；RSS 基线 148 MiB，采样峰值 160 MiB |

输入由生成器按段产生，密文直接进入解密器，没有预先积累整个文件。两档数据量的采样显示未同比增长，但这不是严格内存上界证明；WASM、GC、操作系统和缓存都会影响 RSS。性能路径未包含网络、大文件磁盘 API、移动系统和后台恢复。本机 HTTP 测试是另外的小规模故障场景。

## 5. 尚未完成的 P0 门槛

1. **真实 Obsidian**：插件加载、关闭、重开、输入与设置生命周期；现有浏览器测试没有加载 Obsidian。
2. **Android / iOS 实机**：解锁内存与延迟、中文输入法、系统挂起及终止、文件 API 和网络行为。浏览器重载与 Node 终止进程无法替代这些场景。
3. **密钥包可靠持久化**：原型初始化单文件写入，失败不会开放编辑，但完整的多代密钥包、更新中断及恢复状态机尚未完成。
4. **附件重启续传**：已测运行进程内重发相同密文；尚未实现持久化密文 spool、跨进程续传、上传会话和生产分段协议。流状态丢失时应换新对象和密钥，不尝试重用旧 nonce。
5. **完整下载提交**：secretstream 可逐段返回已认证内容，但最终标记缺失仍会使整个文件失败。生产实现必须在恢复区暂存，完整通过后才公开附件。
6. **编辑与锁定体验**：原型有显式锁定，尚无自动空闲锁定或系统后台锁定；400 ms 保存确认前的输入仍可能因立即终止而丢失。口令派生尚未移入 Worker，需要验证解锁期间主线程响应。JavaScript 无法承诺清除所有内存副本。
7. **中文搜索、Metadata 与协议冻结**：尚未完成真实检索数据集、路径令牌 ADR、隐私模式决定和协议 v0，也没有正式的服务端（Java / Spring Boot、PostgreSQL、S3）验收。
8. **密码格式审查**：现有格式是实验格式；候选库、大小边界和 KDF 参数仍需平台验证及审查，不能据本轮直接冻结生产协议。

## 6. 仓库回归检查

本次使用 `npm ci` 安装根目录锁文件依赖，运行了原仓库回归检查。结果与原型独立验证分开记录：

| 命令 | 结果 |
| --- | --- |
| `npm run check` | 通过：主项目和 apps 类型检查、lint、Svelte、生产构建，以及旧插件 iOS 15 静态兼容检查；community lint 有 51 条警告、0 条错误 |
| `npm run test:unit` | 未通过：1274 项通过、22 项失败、2 项跳过；147 个测试文件中 141 个通过、5 个失败、1 个跳过 |

失败位于当前未修改的原仓库测试文件：`utils/cli-ci.unit.spec.ts`（16 项）、`utils/release-process.unit.spec.ts`（2 项）、`utils/copy-build-files.unit.spec.ts`（1 项）、`src/apps/cli/main.bootstrap.unit.spec.ts`（2 项），以及 `src/apps/cli/adapters/NodeFileSystemAdapter.unit.spec.ts`（1 项）。

错误输出包括缺少 `jq`、Bash/Windows 路径和权限、CRLF 比较、临时 LevelDB 文件锁、大小写目录冲突，以及发布脚本结果不符。本次没有通过改写这些断言或跳过测试来获取通过结果，也未在另一干净系统复现以证明全部失败原因。新增原型不在原单元测试命名匹配范围内，使用独立命令验证。

根目录类型检查发现的新增 HTTP 测试 `Buffer` 类型冲突已修正，随后完整 `check` 通过。生产构建由 `check:compatibility` 的前置脚本实际执行。

## 7. 下一步

先补齐可在桌面完成的宿主验收、密钥包故障恢复、持久化密文续传和协议 ADR。没有真机时可以继续这些独立工作，但保留 P0 移动端门槛，不将整体阶段标记为完成，不执行批量迁移和旧实现删除。

密码库及格式参考：[hash-wasm](https://github.com/Daninet/hash-wasm)、[Libsodium JavaScript](https://github.com/jedisct1/libsodium.js)、[secretstream](https://doc.libsodium.org/secret-key_cryptography/secretstream)、[RFC 9106](https://www.rfc-editor.org/rfc/rfc9106.html)。
