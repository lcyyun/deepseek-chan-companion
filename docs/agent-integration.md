# 智能体与语音接入

最近校对：2026-11-02，按应用 0.20.0 的代码与接口核对。返回[文档目录](README.md)。本文说明当前接入行为；版本沿革不作为安装步骤。

给 DeepSeek Harness 智能体直接阅读的完整操作说明见 [DSH 智能体操作手册](dsh-agent-guide.md)，包括十一个 MCP 工具、25 种表情、12 组独立肢体、12 个开场组合、朗读节奏、双向聊天桥和诊断流程。已有连接时可直接提供[模型控制快速指南](model-control-quickstart.md)。本文对应 0.20.0；DSH 新环境请从[干净 profile 接入指南](dsh-clean-profile.md)开始。

大肥鱼 · DeepSeek-chan 桌宠启动后提供 `http://127.0.0.1:39181`。在设置页复制配对码，将它作为 `Authorization: Bearer <配对码>`。Windows 默认应用数据目录为 `%APPDATA%\大肥鱼 · DeepSeek-chan`，升级兼容旧品牌目录迁移，以界面诊断中的 `dataDir` 为准。配对码重启后不变；不要放进仓库或截图。服务只监听回环地址。

## Codex 与 DeepSeek Harness 共用角色

首次安装保存 `provider:"unconfigured", providerSource:"auto"`。有效来源由服务端解析：可用 DSH 聊天桥优先；只检测到 DSH MCP 时显示表演已连接、聊天桥未启用；没有 DSH 时保持未连接。自动模式不检测或调用 Codex。DSH 聊天桥使用过后由 `autoProvider:"dsh"` 记忆来源，断线和重启保持 DSH，不改走其他提供方。

`GET /api/settings`、`GET /api/state` 返回同一连接快照：`providerEffective`、`providerSource`、`providerReason`、`chatAvailable`、`chatStatus`、`chatMessage`，以及独立的 `performance` 和 `dsh`。客户端显示／发送判断使用有效来源和 `chatAvailable`，不要只看保存的 `provider`。`performance.connected` 表示最近 65 秒的已认证 MCP 活动；它是无会话 Streamable HTTP 的活动判定，空闲超时会变为未连接，新的 MCP 调用会续期。无法区分同一来源范围内的多个客户端时，只记录通用 MCP 活动，不猜它属于 DSH。

`chatAvailable` 表示本地条件允许尝试对话，不是账户或模型已通过健康检查：DSH 要求聊天桥及 Session Controller 就绪；API 要求已填写地址和模型；Codex 仅在显式选择后允许调用，不做启动探测。模型权限、凭据和网络问题在实际请求时报告。新 DSH 桥显式发送 `sessionControllerAvailable:true`；旧桥省略该字段时按旧版已先验证宿主接口的契约兼容，显式 `false` 不会被当作聊天可用。

有用户接入授权时，可通过带配对码的 `PUT /api/settings` 设置 `{"provider":"dsh","providerSource":"user"}`、`{"provider":"codex","providerSource":"user"}`，或配置 API 及地址、模型、密钥。旧客户端只提交 `provider` 也视为手动选择。恢复自动模式使用 `{"provider":"unconfigured","providerSource":"auto"}`；明确停用内置对话使用 `{"provider":"unconfigured","providerSource":"user"}`，均保留其他配置。运行时状态广播不覆盖设置页未保存的编辑。

只调整回复长度或声音时，仅提交要改的字段，例如 `{"verbosity":"brief"}`。若保存完整表单，必须保留原 `providerSource`，否则只带 `provider` 会被视为新的手动选择。`providerEffective`、`chatAvailable`、`performance`、`dsh` 是返回值，`autoProvider` 是服务内部记忆，不应把它们当作配置入口。有效来源切换会取消旧生成并清空服务内的对话历史，界面已显示的消息与草稿不会因此自动删除。

旧配置没有 `providerSource` 时，无法证明保存的 Codex 是默认还是手动选择；升级保守保留已有有效提供方，用户可选择一次自动模式。未配置请求返回 `PROVIDER_NOT_CONFIGURED`；DSH 连接／凭据／取消问题返回 DSH 专属错误，不进入 Codex 适配器。不可用时禁用发送，草稿和外部 MCP 表演仍保留。配对码、密钥和原始错误输出不进入示例或日志。

两者连接同一个 `/mcp`，不需要各启动一份角色。工具包括 `avatar_capabilities`、`avatar_state`、`avatar_perform`、`avatar_expression`、`avatar_body`、`avatar_speak`、`avatar_set_state`、`avatar_stop`、`avatar_reset`、`avatar_watch_context`。动作工具立即返回接受状态；桌宠窗口负责实际动画和逐段朗读。

只换表情用 `avatar_expression({emotion:"happy"})`，只做肢体用 `avatar_body({animation:"chest-right"})`；分别传 `{active:false}` 结束对应预览，不停止另一通道或说话。HTTP 使用同字段，另加 `type:"expression"` 或 `type:"body"`。身体动画 ID 以 `bodyAnimations` 能力清单为准。常规 `avatar_speak` 自带肢体编排，不必同时重复发送身体指令。

### 能力目录中的选择指南

`GET /api/capabilities` 和 `avatar_capabilities({})` 返回同一份选择信息。`expressionPresets[]`、`bodyAnimations[]`、`combinations[]` 每项按原 `id` 增加 `tags`、`useWhen`、`avoidWhen`、`recommendedEmotions`、`recommendedBody`，六个常用组合另有 `displayName`。原来的标题、描述、时长、手型等字段保留。

顶层 `performanceGuide` 的结构为 `{modes, preferredCombinations, quickStart}`，只放模式说明、优先熟悉的组合 ID 与短指南；完整标签留在三个目录项，不复制一遍。`tags` 是稳定英文分类，场景说明是中文；推荐数组是备选 ID，组合的推荐用于开场完成后的独立承接。

这些是读取用元数据，不是新增命令字段、动作参数或调用顺序。传给工具的仍是 `emotion`、`bodyAnimation`、`combination` 等现有字段；不要把 `tags` 或 `displayName` 当 ID 提交。`agree/explain/shy/think/idea/cuddle` 分别对应“开心点头／讲个重点／有点害羞／冥思苦想／想到了／撒娇捧胸”，优先熟悉但不强制播放；`think` 仍不自动选择。对话服务把同源的紧凑指南注入提示词，外部 MCP 调用者则自行读取能力并选择。

### 说话肢体选择

`avatar_speak` 与 HTTP `type:"speak"` 支持可选 `bodyAnimation`：省略或 `auto` 使用 `intent/gesture/text` 本地规划；`none` 关闭本段说话肢体编排；具体 ID 选择对应姿态及其默认手型。左右均指画面左右。能力表 `speechGestures.bodyAnimation` 给出完整取值：

`auto / none / explain / think / reassure / happy / shy / listen / chest-left / chest-right / chest-both / pointer-left / pointer-right / talk`

独立预览的字段名仍是 `animation`，只接受 12 个具体 ID，不接受 `auto/none`。其中 `talk`（娓娓道来）跟随实际语音或静音阅读时间，包含周期性的柔缓强调和停顿。暂停不推进，相邻相同动画和手型可跨段保持；换轮、停止或触摸会取消旧节点，不补播。预览默认 10 秒不代表说话时只播放 10 秒。0.13 已移除 `pointer-both/compare`：显式命令会被拒绝，旧回复中的这两个值按 `auto` 兼容。

显式选择具体 `bodyAnimation` 优先于旧 `gesture` 的手臂提示，因此 `bodyAnimation:"chest-right", gesture:"none"` 仍会使用右侧抚胸。选择 `bodyAnimation:"none"` 才表示不安排本段肢体；它不关闭脸部、口型或日常呼吸。全局“说话手势频率”仍有效，设为 0 时不安排自动说话肢体，极短音频也会省略完整抬手。脸部预览和 `emotion/expressionCues` 始终独立。

```json
{"text":"我想到了，我们可以先从这个关键步骤开始。","intent":"explain","emotion":"happy","gesture":"none","bodyAnimation":"talk","expressionCues":[{"at":0,"emotion":"happy","intensity":0.7}]}
```

上例可直接传给 `avatar_speak`，HTTP 使用时另加 `type:"speak"`。聊天提供方返回的严格 JSON schema 要求每个 `segments` 项包含 `bodyAnimation`，通常填 `auto`；旧提供方省略该字段时，服务归一化仍按 `auto` 兼容。手臂表现来自已有姿态与完整手臂镜像，并不开放自由骨骼或逐帧参数控制。

### 说话开场组合

`speak.combination` 与回复段落的 `combination` 可选 `auto/none` 或 `greet/explain/agree/disagree/curious/reassure/shy/playful/surprised/cuddle/think/idea`。这是已有情境预设的动作与表情组合，不是独立肢体 ID。能力表 `combinations` 提供预设元数据，`speechCombinations.selection` 提供允许值。MCP/HTTP 可省略，默认 `auto`；严格回复 schema 要求填写该字段，旧回复缺失时仍按 `auto` 兼容。

每轮只考虑第一段的组合。`auto` 仅在 `bodyAnimation` 缺省或为 `auto` 时按准确 `intent` 与兼容 `emotion` 选择，不靠正文中的情绪词机械匹配；普通 `think` 不自动选回长时间等待动作。显式 `combination` 可以覆盖开场选择，结束后仍使用所选 `bodyAnimation`。`none` 只关闭开场组合；“说话手势频率”为 0 时组合与自动肢体均关闭。

首段实际时长达到“组合预设时长 + 0.4 秒”才播放组合，组合和语音同时开始；短语音直接进入独立通道，不压缩完整手臂动作。组合结束后，`expressionCues` 和 `bodyAnimation` 按剩余语音的进度开始，`at:0` 指剩余部分的起点。暂停、停止和触摸遵循同一时轴与取消规则。已选组合取代旧的思考完成 `idea` 前导；没有选中组合时，原思考完成提示仍独立保留。

```json
{"text":"别着急，我们可以先把最重要的一步做好，剩下的再慢慢处理。","intent":"reassure","emotion":"gentle","gesture":"chest","bodyAnimation":"chest-right","combination":"reassure","expressionCues":[{"at":0,"emotion":"gentle","intensity":0.65}]}
```

这条 `avatar_speak` 先尝试完整的抚胸安慰组合，再在剩余语音中切换右侧抚胸与温柔脸；是否能播开场取决于实际语音时长。它不会改变“小表情”卡片的独立预览行为。

先把 `L2D_BRIDGE_TOKEN` 放入启动智能体的进程环境。Codex 配置示例在 `integrations/codex/config.example.toml`；追加该节到已有配置即可，不要覆盖原配置。连接后让智能体先查询 `avatar_capabilities`。

HTTP、MCP和聊天结构化回复共用能力表：`intent`支持`neutral/greet/agree/disagree/curious/explain/reassure/shy/playful/surprised/think/cuddle/idea`；`emotion`支持25种：`neutral/happy/joyful/squeezed/gentle/puzzled/curious/panic/shy/cold/sad/worried/embarrassed/playful/smug/angry/sleepy/surprised/determined/proud/relieved/love/teary/dizzy/speechless`。`cuddle`表示亲昵或撒娇，由行为层协调手臂；`idea`表示想到办法或恍然大悟；`puzzled`表示困惑。手势仍为`none/pointer/chest/foxtail`，没有`cuddle`手势。例如`POST /api/command {"type":"perform","intent":"cuddle","emotion":"gentle","gesture":"none"}`。未知命令能力会被拒绝，模型回复中的未知语义值会回退到已支持的值。

`avatar_speak`及回复段落支持`expressionCues:[{at,emotion,intensity}]`，最多4项，`at`为该段实际朗读进度0–0.9；若播放开场组合，则对应组合后的剩余语音进度。相邻至少间隔0.18，只控制脸部节奏，嘴部开合仍跟随音频。通常一段1–2个表情。单次工具返回已接受，不代表读完；连续独立朗读会替换旧回复，不应靠快速连发工具调用拼接队列。

DeepSeek Harness 的示例在 `integrations/dsh/cordis.patch.example.yml`。校正其中绝对插件路径后，将它作为 `dsh web --patch <绝对路径>` 的覆盖层。MCP 客户端负责显式表演，附带的 Cordis 插件负责将回合开始、非角色工具调用和回合结束映射成角色状态。状态观察部分只发送会话ID和状态，不上传会话正文；下述双向聊天桥会把桌宠问题及已授权页面内容交给DSH，并回传该回合的回答。多会话时可用 `sessionId` 限定状态观察来源。桌宠关闭不会阻断DSH。

加载完整项目或便携包中的集成目录，保留 `live2d-bridge.mjs` 相邻的 `home-paths.mjs`、`chat-errors.mjs`，并确保能解析项目依赖 `ws`。更新文件后需重新加载 DSH 插件／重启对应测试 profile，已运行的旧模块不会因 Git 更新自动替换。

DSH接入依据官方 [MCP客户端](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md)、[插件加载](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.md) 和 [事件接口](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/framework/events.md)。DSH仍在快速迭代，首次接入需使用你安装的版本验证。

安装前先按[DSH 安装模式](dsh-install-modes.md)询问用户选 A“接到已有会话”还是 B“新建独立桌宠会话”；不要默认。A 还要让用户选择具体会话。两种模式都推荐 `native: true`，由智能体在正常聊天中按需调用一次 `avatar_reply`，不再把长 JSON 表演规范作为每轮用户消息注入会话。

应用内「连接 DeepSeek Harness」会检测 CLI/`DSH_HOME`、生成 patch 并使用同一个 profile 启动或复用 DSH，不新建独立实例；连接正在运行的 DSH 前会显示 3 秒警示并要求用户确认；程序不会关闭 DSH，用户需手动退出 DSH 后重试。手工配置时可用 `tokenFile` 代替环境变量；B 模式可用 `sessionFile` 保存新建的会话 ID，A 模式使用 `chatSessionId`。

插件支持 `tokenFile`（本地 token 文件）作为 `L2D_BRIDGE_TOKEN` 的替代；B 模式支持 `sessionFile`，首次创建后写入会话 ID，重启复用。应用内连接默认使用这两项。

插件的`chat:true`开启双向聊天桥（当前插件默认启用，`chat:false`关闭）。它调用官方`ctx.sessionController.create/prompt/cancel`，在 DSH home 下的 `live2d-companion` 创建独立桌宠会话。目录优先级为显式 `chatCwd` → `dshHome/live2d-companion` → `$DSH_HOME/live2d-companion` → `~/.dsh/live2d-companion`；支持 `~` 展开，桥加载时固定路径，自定义 home 不会写入默认 home。也可配置`chatSessionId`复用专门会话，此时不创建目录。`sessionId`仅过滤状态观察来源，不能代替`chatSessionId`。服务通过认证WebSocket发送问题，插件以内部`requestId`关联用户消息及同一回合的最终助手回复，返回真实结果；停止会取消该回合。桥未连接时明确报错，不伪造回复。契约依据[官方Session Controller](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/api/session-controller/src/index.ts)及[DSH home-paths](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/util/home-paths/README.md)。

桌宠会话的工具守卫默认禁止执行命令、访问文件和调用角色工具。`native: true`时额外允许 `avatar_reply` 这一个原子表演工具：它一次接收最多三段完整计划，负责朗读和动作，普通助手文本只用于聊天窗展示，不会重复朗读；`avatar_speak` 等低层工具不会在聊天桥里开放。需要联网时，在`searchTools`里填写已安装的可信只读网页检索工具**精确名称**；插件会检查工具存在。默认空列表表示没有网页搜索，界面不会显示伪造来源。DSH使用程序化工具模式时，通用`run_code`仍被禁止，建议该专用会话使用原生工具模式。守卫仅影响桌宠会话，不影响其他DSH会话。用户已在 DSH `0.2.1-rc.2` 全新 profile 中完成 MCP 十一个工具、状态桥、双向聊天和真实模型渲染的端到端验证；自动测试另行覆盖契约及真实 WebSocket 传输，其他版本与插件配置仍需连接后验证。

## 桌宠内聊天

- **DeepSeek Harness：** 自动模式优先使用已就绪的聊天桥；手动固定为 DSH 后也不会因断线切到其他来源。MCP 表演与状态心跳不能替代聊天桥；不可用时禁用发送并显示对应原因。
- **Codex：** 仅手动选择后使用项目附带的官方Codex原生可执行文件和本机登录，便携包不要求另装Node；仅沿用用户配置中的模型名，其余工具及项目配置不继承。每次调用通过独立应用数据目录、只读沙箱、结构化JSON输出运行；禁用Shell、Apps、多智能体、Hooks和远程插件，可开启实时网页搜索。提示词通过标准输入传递，不拼接Shell命令。取消会结束子进程树。此调用不是你正在使用的Codex聊天，不继承该聊天上下文。
- **兼容API：** 填入Base URL、模型名和API Key，调用`/chat/completions`的JSON模式。需模型支持JSON输出。普通兼容API通路没有默认网页搜索工具；不会假称已经联网。
- 默认简短回复，通常一两句。最多三段依次朗读，详细说明放`details`供点击展开，不自动朗读详情。提供`brief`、`balanced`、`detailed`三档预算。回答超出朗读预算时最多做一次语义改写，完整原文转入详情，不机械截断句子。

API密钥仅在服务端使用。有Electron系统加密回调时加密保存；独立调用服务且没有加密回调时只保留在进程内，不写明文密钥。也可用`L2D_API_KEY`、`L2D_TTS_API_KEY`环境变量。

## 语音与口型

`POST /api/tts {"text":"你好"}` 按 `tts.provider` 选择语音来源，默认 `edge` 使用“大肥鱼 · 晓伊”（`zh-CN-XiaoyiNeural`，语速 `+3%`、音调 `+8Hz`）生成真实 MP3。此来源需要联网，会向微软语音服务发送待朗读文字，无需 API Key。

`tts.provider: "system"` 使用 Windows System.Speech 在本机生成 WAV。中文文本优先选中文系统嗓音；未安装时明确报错。`GET /api/voices` 列出系统可用嗓音；`tts.systemVoice` 可指定。

`tts.provider: "api"` 使用独立语音 API 配置调用兼容的 `/audio/speech` 端点，返回 MP3；旧的 `tts.enabled` 字段仍兼容，API 模式为 `true`。语音 API 密钥与聊天 API 密钥分开。切换来源不会清除配置，失败也不会静默切换。播放器使用实际音频振幅驱动嘴部，属于音量同步，不宣称精确音素对齐；中断应同时停止音频、清空播放队列并收口。

## 一起看网页

`PUT /api/watch {"enabled":true}` 后，Chrome/Edge扩展才能向`POST /api/watch/context`发送`{title,url,text,selection}`。内容只在内存保留，默认两分钟过期；关闭立即清除，重新启动默认关闭。扩展需要配对码，普通网站Origin被拒绝。

每次重新开启返回新的`sessionId`，扩展随页面提交该值；旧会话内容会被拒绝，防止关闭后静默恢复跟随。切换页面URL或选区、关闭或过期会取消旧的陪看生成；同页定时刷新不会打断生成。陪看回复包含`mode:watch`、`contextUrl`和`watchSessionId`，播放器可据此停止旧页面的语音。

`POST /api/chat {"text":"解释这一段","mode":"watch","verbosity":"brief"}` 将当前新鲜网页内容作为不可信数据供模型分析。页面内容不能授权工具操作，也不会被当作系统指令。Codex模式可根据用户问题搜索相关资料；DSH 取决于已授权的检索工具；普通API模式只分析提供的内容。

服务端接收页面本身不直接调用模型，但**运行中的桌宠会尝试主动短评**：收到页面更新后等待约 3.5 秒；只有一起看仍开启、`chatAvailable=true`、角色空闲、该 URL 尚未自动评论且距上次尝试至少 60 秒时，才提交一次简短 watch 请求。该请求仍可能计入所选提供方用量。关闭一起看会清空页面并取消待执行短评；不要另开高频轮询来重复触发。

## 本地HTTP与WebSocket协议

全部`/api/*`、`/model/*`及`/mcp`请求需要Bearer配对码（模型资源也支持`?token=`供不支持请求头的加载器使用）。`/events`连接后五秒内发送`{"type":"auth","token":"..."}`；认证成功收到`auth`和`state`。

| 接口 | 行为 |
| --- | --- |
| GET `/api/state` | 当前角色、模型、桥接、陪看状态；无密钥 |
| GET `/api/capabilities` | 支持的意图、情绪、动作 |
| GET/PUT `/api/settings` | 读取脱敏配置、保存配置 |
| GET `/api/model-manifest` | 模型地址、表情与动作相对路径 |
| POST `/api/command` | `type: perform/speak/state/stop/reset/expression/body` |
| POST `/api/chat` | `{text,mode,verbosity}` → `{id,requestId,segments,details,sources}` |
| POST `/api/stop` | 取消生成和语音，广播停止 |
| POST `/api/tts` | 返回WAV或MP3音频 |
| GET `/api/voices` | Windows语音列表 |
| PUT `/api/watch` | 开关陪看 |
| GET/POST `/api/watch/context` | 读取/提交有效页面内容 |
| POST `/api/bridge/event` | 原生插件心跳及角色状态 |

WebSocket事件：`command`含`command`；`chat`含`reply`与`requestId`（和`reply.requestId`相同）；`state`含完整状态对象（对象内`state`为状态枚举，`requestId`为当前生成请求编号，没有请求时为`null`）；`chat-progress`含`stage`与`requestId`；`watch-context`含页面`context`。新问题会取消前一个请求；已取消、被替换或已结束请求的迟到进度和结果不再广播。前端仍应按请求编号忽略本地队列中的旧事件。只有桌宠窗口播放`chat`，聊天面板仅展示，防止重复朗读。

连接变化使用 `state` 广播，不作为用户保存设置；客户端应将连接状态与编辑中的配置表单分开。配置保存后发送 `settings` 事件。DSH 专属错误、自动／手动来源示例和分层排查见[DSH 操作手册](dsh-agent-guide.md#11-故障定位)。
