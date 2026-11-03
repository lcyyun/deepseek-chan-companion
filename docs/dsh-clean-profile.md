# DSH 干净 profile 接入与受限环境验收

最近校对：2026-11-03，按应用 0.23.0 核对。返回[文档目录](README.md)；完整命令契约见[DSH 操作手册](dsh-agent-guide.md)。

适用于大肥鱼 0.23.0。安装前先按[DSH 安装模式](dsh-install-modes.md)询问用户选择“接到已有会话”还是“新建独立桌宠会话”；不要默认。用户此前已反馈在 **DeepSeek Harness 0.2.1-rc.2 的全新 profile** 中完成真实端到端验证：MCP 十一个工具、状态桥、双向聊天和真实模型渲染均正常。这是此前版本的用户实机记录；0.23.0 新协议另按实际宿主源码契约与隔离测试验证，不能由旧结果推导当前账号已完成端到端验收。

## 1. 先选择运行环境

| 工作 | 推荐入口 | 需要什么 |
|---|---|---|
| DSH 作业、普通 CI 中检查代码 | `npm test` 或 `npm run test:ci` | Node、已安装依赖、可写临时目录、允许监听本机回环端口 |
| 沙箱不允许启动 esbuild／解压子进程 | `setup:live2d:restricted` 和 `build:restricted` | Node 当前进程执行、文件读写；首次下载 SDK 需要联网 |
| Electron UI、原生鼠标、实际桌宠 | 普通 Windows 用户会话中的 `npm run test:desktop`、`npm start` | 交互式桌面、子进程与父进程查询权限；模型渲染还需 WebGL |
| 全部自动回归 | 普通 Windows 用户会话中的 `npm run test:all` | 已构建 `dist`，满足上述桌面条件 |

CI 入口不会启动 Electron、.NET 观察器、Codex CLI、DSH 模型进程或真实在线配音。MCP／桥测试使用真实回环 HTTP/WebSocket 和测试宿主；不消耗模型额度。它在同一 Node 进程运行，并主动禁止子进程启动；新增测试一旦试图启动子进程，会明确失败。被排除的桌面测试文件会列在输出中，不能把 CI 通过当作实际鼠标、窗口或模型画面已通过。

如果作业连本机端口也禁止，网络协议测试仍会报权限错误；应使用允许回环通信的测试环境。不要通过关闭 DSH 沙箱、管理员运行或禁用 Electron sandbox 来掩盖问题。

## 2. 无构建子进程的源码准备

使用 Node.js 22.12 或更新版本。普通 Windows 终端仍可使用 README 中的 `npm ci`、`npm run setup:live2d`、`npm run build`。DSH 作业中可用以下路径：

```powershell
# 在项目根目录；已有完整依赖时可省略安装。
# 此模式跳过 Electron/esbuild 安装脚本，适合只做源码构建与 CI 的环境。
npm ci --ignore-scripts
npm run setup:live2d:restricted
npm run build:restricted
npm test
```

受限构建使用当前 Node 进程中的 Rollup + TypeScript；SDK 解压使用 JavaScript，保留官方下载地址、固定 SHA-256 校验、路径检查及许可证复制。两条路径使用同一份应用源码、同一份 SDK，产物都可交给桌面程序加载。受限构建不做压缩，文件会较大；它支持本项目当前使用的普通 CSS，遇到未支持的 CSS `@import` 或 `url()` 会明确报错。

`--ignore-scripts` 不会安装 Electron 可执行运行时。以后要运行桌面版，请在普通 Windows 用户终端执行 `npm rebuild electron esbuild`，再 `npm run build`、`npm start`。便携包生成仍使用 `npm run package`，需要原生编译器、Electron 和正常子进程权限；不是无桌面 CI 的一部分。

如已有经校验的 SDK 压缩包，可避免再次下载，或在独立目录验收产物：

```powershell
node --import ./scripts/assert-no-subprocess.mjs scripts/setup-live2d.mjs --restricted --archive=vendor/CubismSdkForWeb-5-r.4.zip --cache-dir=output/sdk-check --outdir=output/sdk-check/runtime
node --import ./scripts/assert-no-subprocess.mjs scripts/build-restricted.mjs --outdir=output/renderer-check
```

上面的 `--import` 是本仓库的验证守卫，会拒绝启动子进程和 Worker，不是申请额外权限。正式运行用前面的 npm 命令即可。`output/` 不进入源码仓库。

如果宿主需要直接执行 Node 入口，可分别调用 `node scripts/setup-live2d.mjs --restricted`、`node scripts/build-restricted.mjs`、`node scripts/test.mjs ci`，与对应 npm 脚本等价。

## 3. 创建独立 DSH home

在**新开的 PowerShell** 中进入项目根目录，再设置本次进程使用的路径。以下示例不覆盖现有 DSH home：

```powershell
$projectRoot = (Resolve-Path '.').Path
$dshTestHome = Join-Path $projectRoot ('.local\dsh-rc2-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $dshTestHome | Out-Null
$env:DSH_HOME = $dshTestHome
dsh --version
```

验证基线是 `0.2.1-rc.2`。在这个 home 中完成 DSH 自身的模型配置／登录；不要为了测试覆盖常用配置，也不要复制整个常用 home 的密钥和历史记录。这里仅改变 DSH profile；桌宠的模型路径、配对码和桌面位置仍由桌宠自己的用户目录管理。

桥的工作目录在加载时固定，优先级为：

1. 显式 `chatCwd`：直接作为会话工作目录。
2. 显式 `dshHome` 下的 `live2d-companion`。
3. `DSH_HOME` 下的 `live2d-companion`。
4. 未指定 home 时，才使用 `~/.dsh/live2d-companion`。

支持 `~`、`~/`、`~\` 和相对路径，空白 `DSH_HOME` 视为未设置；相对路径以插件加载时的工作目录为基准，干净 profile 推荐绝对路径。更改环境变量后须重新加载桥／重启 DSH。指定 `chatSessionId` 复用会话时，不新建工作目录。规则参考 [DSH 官方 home-paths](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/util/home-paths/README.md)。

## 4. 连接桌宠与插件

1. 在正常桌面会话启动大肥鱼，选择本机模型，确认角色可见。打开设置复制配对码。
2. 在上面已设置 `DSH_HOME` 的 PowerShell 中，按[操作手册第 3 节](dsh-agent-guide.md#3-本地连接与鉴权)将配对码放入 `L2D_BRIDGE_TOKEN`。不要输出该变量或把它写进仓库。
3. 配置中的插件路径须指向完整项目或便携包中的插件目录，保留相邻 `home-paths.mjs`、`chat-errors.mjs` 以及可解析的 `ws` 依赖。不要单独复制一个桥文件。更新源码后重新加载插件／重启这个测试 profile；正在运行的旧桥不会自动换成新版。
4. 保持 `chat: true`、`searchTools: []`，先验证基础连接。避免在这个测试配置中设置指向常用目录的 `chatCwd` 或 `dshHome`。安装前先读[DSH 安装模式](dsh-install-modes.md)：选 A 填入用户选择的 `chatSessionId`；选 B 先让插件创建，再把生成的 `chatSessionId` 写回并重启。两者都设置 `native: true`，使用 `avatar_reply` 原生工具，不再每轮注入长 JSON 提示。应用内连接会自动生成 patch、token 文件和 B 模式 session 文件，也可手工用 `tokenFile` 取代 `L2D_BRIDGE_TOKEN`。
5. 先在同一个终端创建配置副本：

```powershell
$dshPatch = Join-Path $env:DSH_HOME 'live2d.patch.yml'
Copy-Item -LiteralPath (Join-Path $projectRoot 'integrations\dsh\cordis.patch.example.yml') -Destination $dshPatch
```

用编辑器把副本内的 `C:/path/to/...` 改为当前项目的绝对路径，非默认端口同时修改 MCP 与桥的 URL。完成修改后，从该终端启动：

```powershell
dsh web --patch $dshPatch
```

第一次完成桌宠双向聊天后，自动创建的工作目录应位于 `$DSH_HOME/live2d-companion`。状态连接和 MCP 握手本身不必创建聊天目录。

全新桌宠配置默认“自动 · 优先 DeepSeek Harness”。DSH 聊天桥就绪后会自动用于对话；只连接 MCP 时保持聊天不可用，不调用 Codex。这个 DSH home 是新的，并不代表桌宠配置也是新的：若桌宠沿用旧的手动 API／Codex 来源，先征得用户接入意图后在设置中改为自动，或按操作手册设置 `providerSource:"auto"`。不要为测试删除桌宠原有配置。

## 5. 按通路验收

| 检查 | 通过条件 |
|---|---|
| MCP 发现 | 能发现操作手册中的十一个 `avatar_*` 工具，包含 `avatar_reply` |
| 状态与模型 | `avatar_state` 的模型 ready；现场能看见真实模型渲染 |
| 表情／动作 | 分别调用 `avatar_expression`、`avatar_body`、`avatar_perform`，角色确实表现，预览结束后恢复 |
| 状态桥 | 普通 DSH 回合开始后显示思考，结束后恢复；自身角色工具不递归触发 |
| 双向聊天 | 自动模式下 `providerEffective=dsh`、`dsh.chatAvailable=true`、`chatAvailable=true`；在悬浮聊天窗提问，获得真实模型回复并播放 |
| MCP-only | 只连接 MCP 时显示表演已连接／聊天桥未启用，发送禁用，不启动 Codex |
| 断线重连 | 断开桥后仍显示 DSH，保留草稿并禁用发送；重连后自动恢复 |
| 手动来源 | 显式 API／Codex 不被 DSH 接入覆盖；显式 DSH 重启后保持。Codex 不自动选择 |
| 隔离 | 专用会话 cwd 位于本次 home，常用 home 下没有因此新建 `live2d-companion` |
| 停止 | 生成／朗读中停止后取消对应回合，不补播旧回复 |
| 新桥协议 | `/api/state.dsh.promptProtocol` 为 `2`；旧值不代表断线，但需要更新并正常重载桥一次 |
| 可见正文 | 连续聊两轮，DSH 每条用户消息只有本次输入，无旧助手回复、角色标签或规则前缀；历史仍由原 DSH 会话保留 |
| 原生表演 | `native:true` 时一次 `avatar_reply` 完成朗读与动作，普通助手回复不重复播放，不额外生成改写回合 |
| A 回合隔离 | 原会话正在工作时，桌宠消息先排队；取消该消息不停止原工作，也不把桌宠规则带入原工作 |

网页搜索单独验收：只有配置了已安装工具的精确 `searchTools` 名称，且真实工具成功返回，才记录“搜索通过”。空列表下搜索能力关闭，不属于基础连接故障。

可先只读取连接状态，不发起模型请求：

```powershell
$bridgeHeaders = @{ Authorization = "Bearer $env:L2D_BRIDGE_TOKEN" }
Invoke-RestMethod 'http://127.0.0.1:39181/api/state' -Headers $bridgeHeaders |
  Select-Object providerEffective, providerSource, chatAvailable, chatStatus, chatMessage,
    @{Name='mcpConnected';Expression={$_.performance.connected}},
    @{Name='dshChatReady';Expression={$_.dsh.chatAvailable}},
    @{Name='promptProtocol';Expression={$_.dsh.promptProtocol}}
```

MCP 注册与最近活动分别记录，65 秒没有调用只表示空闲，不应显示成配置丢失。`dshChatReady` 表示桥在线并声明宿主接口可用，`promptProtocol:2` 表示新提示通道；模型凭据、配额及语音合成仍需分别验收。默认晓伊需要联网，语音失败与 DSH 模型失败不是同一个问题。

从旧版升级时，保留会话 ID、session 文件和配对信息，正常更新完整集成目录并重新加载对应桥。新版不会清理之前已经写入的历史，也不应为得到干净截图删除用户会话。规约进入匹配回合的隐藏 `systemPrompt.section`；网页资料标为不可信引用，不能授权工具。宿主若缺少该 API，桥会明确报错，而不是退回把规则塞进用户消息。

## 6. 已知作业环境错误

| 错误 | 含义和处理 |
|---|---|
| Electron `0x80000003` | 用户在 DSH 作业／管道环境观察到的启动失败。仅凭退出码无法确定 Chromium 内部根因；CI 入口不启动 Electron，真实桌面检查移到正常 Windows 会话 |
| .NET 查不到父进程 PID | 观察器需要父进程可见性来保证随主进程退出；不要移除这个约束或把读取失败当作鼠标松开验证通过。CI 保留注入假进程的协议／故障释放测试，真实观察器在桌面入口检查 |
| `spawn EPERM` | 常规 Vite/esbuild、原生解压或辅助进程启动被限制；源码构建改用 restricted 入口，桌面程序本身仍需要相应运行环境 |
| 桥已心跳，但不能聊天 | 查看 `providerEffective`、`chatAvailable`、`dsh.chatAvailable`；检查 `chat:true`、Session Controller、专用会话模型配置。状态心跳和 MCP 都不是聊天可用证明 |
| 升级后仍显示旧 Codex | 旧文件没记录是否手选，升级保留已有来源。设置中选一次“自动 · 优先 DeepSeek Harness”并保存；不要删除模型／配对配置 |
| DSH 模型／凭据未配置 | `DSH_MODEL_NOT_CONFIGURED`：检查本次 DSH home 内的模型和凭据；不能拿常用 profile 的登录状态证明新 profile 可用 |
| DSH 回合取消／格式异常 | 分别查 `DSH_TURN_CANCELLED`、`DSH_TURN_TIMEOUT`、`DSH_INVALID_REPLY`；不循环重发已取消的请求 |
| Codex 已登录却初始化失败 | 仅在手动 Codex 模式查 `CODEX_PERMISSION_DENIED` / `CODEX_INIT_FAILED`、安全诊断摘要与退出码；登录成功不代表作业可以启动进程或访问临时目录 |

记录验收结果时分别写明 DSH 版本、测试 profile、模型提供方、MCP／聊天／搜索／渲染结果，以及使用的测试命令。保留脱敏错误和退出码，不记录配对码、API Key 或私人聊天正文。
