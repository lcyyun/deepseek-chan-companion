# 智能体与语音接入

给 DeepSeek Harness 智能体直接阅读的完整操作说明见 [DSH 智能体操作手册](dsh-agent-guide.md)，包括十个 MCP 工具、25 种表情、14 组独立肢体预览、朗读节奏、双向聊天桥和诊断流程。本文对应 0.12.0。

大肥鱼 · DeepSeek-chan 桌宠启动后提供 `http://127.0.0.1:39181`。在设置页复制配对码，将它作为 `Authorization: Bearer <配对码>`。Windows 默认应用数据目录为 `%APPDATA%\大肥鱼 · DeepSeek-chan`，升级兼容旧品牌目录迁移，以界面诊断中的 `dataDir` 为准。配对码重启后不变；不要放进仓库或截图。服务只监听回环地址。

## Codex 与 DeepSeek Harness 共用角色

两者连接同一个 `/mcp`，不需要各启动一份角色。工具包括 `avatar_capabilities`、`avatar_state`、`avatar_perform`、`avatar_expression`、`avatar_body`、`avatar_speak`、`avatar_set_state`、`avatar_stop`、`avatar_reset`、`avatar_watch_context`。动作工具立即返回接受状态；桌宠窗口负责实际动画和逐段朗读。

只换表情用 `avatar_expression({emotion:"happy"})`，只做肢体用 `avatar_body({animation:"chest-right"})`；分别传 `{active:false}` 结束对应预览，不停止另一通道或说话。HTTP 使用同字段，另加 `type:"expression"` 或 `type:"body"`。身体动画 ID 以 `bodyAnimations` 能力清单为准。常规 `avatar_speak` 自带肢体编排，不必同时重复发送身体指令。

### 0.12 说话肢体选择

`avatar_speak` 与 HTTP `type:"speak"` 新增可选 `bodyAnimation`：省略或 `auto` 使用 `intent/gesture/text` 本地规划；`none` 关闭本段说话肢体编排；具体 ID 选择对应姿态及其默认手型。左右均指画面左右。能力表 `speechGestures.bodyAnimation` 给出完整取值：

`auto / none / explain / think / reassure / happy / shy / listen / chest-left / chest-right / chest-both / pointer-left / pointer-right / pointer-both / talk / compare`

独立预览的字段名仍是 `animation`，只接受 14 个具体 ID，不接受 `auto/none`。其中 `talk`（娓娓道来）和 `compare`（两边说说）跟随整段实际语音或静音阅读时间，包含周期性的柔缓强调和停顿。暂停不推进，相邻相同动画和手型可跨段保持；换轮、停止或触摸会取消旧节点，不补播。预览默认 10 秒不代表说话时只播放 10 秒。

显式选择具体 `bodyAnimation` 优先于旧 `gesture` 的手臂提示，因此 `bodyAnimation:"chest-right", gesture:"none"` 仍会使用右侧抚胸。选择 `bodyAnimation:"none"` 才表示不安排本段肢体；它不关闭脸部、口型或日常呼吸。全局“说话手势频率”仍有效，设为 0 时不安排自动说话肢体，极短音频也会省略完整抬手。脸部预览和 `emotion/expressionCues` 始终独立。

```json
{"text":"我想到了，我们可以先从这个关键步骤开始。","intent":"explain","emotion":"happy","gesture":"none","bodyAnimation":"talk","expressionCues":[{"at":0,"emotion":"happy","intensity":0.7}]}
```

上例可直接传给 `avatar_speak`，HTTP 使用时另加 `type:"speak"`。聊天提供方返回的严格 JSON schema 要求每个 `segments` 项包含 `bodyAnimation`，通常填 `auto`；旧提供方省略该字段时，服务归一化仍按 `auto` 兼容。手臂表现来自已有姿态与完整手臂镜像，并不开放自由骨骼或逐帧参数控制。

先把 `L2D_BRIDGE_TOKEN` 放入启动智能体的进程环境。Codex 配置示例在 `integrations/codex/config.example.toml`；追加该节到已有配置即可，不要覆盖原配置。连接后让智能体先查询 `avatar_capabilities`。

HTTP、MCP和聊天结构化回复共用能力表：`intent`支持`neutral/greet/agree/disagree/curious/explain/reassure/shy/playful/surprised/think/cuddle/idea`；`emotion`支持25种：`neutral/happy/joyful/squeezed/gentle/puzzled/curious/panic/shy/cold/sad/worried/embarrassed/playful/smug/angry/sleepy/surprised/determined/proud/relieved/love/teary/dizzy/speechless`。`cuddle`表示亲昵或撒娇，由行为层协调手臂；`idea`表示想到办法或恍然大悟；`puzzled`表示困惑。手势仍为`none/pointer/chest/foxtail`，没有`cuddle`手势。例如`POST /api/command {"type":"perform","intent":"cuddle","emotion":"gentle","gesture":"none"}`。未知命令能力会被拒绝，模型回复中的未知语义值会回退到已支持的值。

`avatar_speak`及回复段落支持`expressionCues:[{at,emotion,intensity}]`，最多4项，`at`为该段实际朗读进度0–0.9，相邻至少间隔0.18；只控制脸部节奏，嘴部开合仍跟随音频。通常一段1–2个表情。单次工具返回已接受，不代表读完；连续独立朗读会替换旧回复，不应靠快速连发工具调用拼接队列。

DeepSeek Harness 的示例在 `integrations/dsh/cordis.patch.example.yml`。校正其中绝对插件路径后，将它作为 `dsh web --patch <绝对路径>` 的覆盖层。MCP 客户端负责显式表演，附带的 Cordis 插件负责将回合开始、非角色工具调用和回合结束映射成角色状态。状态观察部分只发送会话ID和状态，不上传会话正文；下述双向聊天桥会把桌宠问题及已授权页面内容交给DSH，并回传该回合的回答。多会话时可用 `sessionId` 限定状态观察来源。桌宠关闭不会阻断DSH。

DSH接入依据官方 [MCP客户端](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md)、[插件加载](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.md) 和 [事件接口](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/framework/events.md)。DSH仍在快速迭代，首次接入需使用你安装的版本验证。

插件的`chat:true`开启双向聊天桥（当前插件默认启用，`chat:false`关闭）。它调用官方`ctx.sessionController.create/prompt/cancel`，默认在`~/.dsh/live2d-companion`创建独立桌宠会话；也可配置`chatSessionId`指定专门会话。`sessionId`仅过滤状态观察来源，不能代替`chatSessionId`。服务通过认证WebSocket发送问题，插件以内部`requestId`关联用户消息及同一回合的最终助手回复，返回真实结果；停止会取消该回合。桥未连接时明确报错，不伪造回复。契约依据[官方Session Controller](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/api/session-controller/src/index.ts)。

桌宠会话的工具守卫默认禁止执行命令、访问文件和调用角色工具。需要联网时，在`searchTools`里填写已安装的可信只读网页检索工具**精确名称**；插件会检查工具存在。默认空列表表示没有网页搜索，界面不会显示伪造来源。DSH使用程序化工具模式时，通用`run_code`仍被禁止，建议该专用会话使用原生工具模式。守卫仅影响桌宠会话，不影响其他DSH会话。接口已通过原生方法契约及真实WebSocket传输测试；尚未取得并连接本机DSH地址，未做真实账户端到端验证，具体版本仍需连接后验证。

## 桌宠内聊天

- **Codex：** 优先使用项目附带的官方Codex原生可执行文件和本机登录，便携包不要求另装Node；仅沿用用户配置中的模型名，其余工具及项目配置不继承。每次调用通过独立应用数据目录、只读沙箱、结构化JSON输出运行；禁用Shell、Apps、多智能体、Hooks和远程插件，可开启实时网页搜索。提示词通过标准输入传递，不拼接Shell命令。取消会结束子进程树。此调用不是你正在使用的Codex聊天，不继承该聊天上下文。
- **兼容API：** 填入Base URL、模型名和API Key，调用`/chat/completions`的JSON模式。需模型支持JSON输出。普通兼容API通路没有默认网页搜索工具；不会假称已经联网。
- 默认简短回复，通常一两句。最多三段依次朗读，详细说明放`details`供点击展开，不自动朗读详情。提供`brief`、`balanced`、`detailed`三档预算。回答超出朗读预算时最多做一次语义改写，完整原文转入详情，不机械截断句子。

API密钥仅在服务端使用。有Electron系统加密回调时加密保存；独立调用服务且没有加密回调时只保留在进程内，不写明文密钥。也可用`L2D_API_KEY`、`L2D_TTS_API_KEY`环境变量。

## 语音与口型

`POST /api/tts {"text":"你好"}` 默认使用Windows System.Speech生成真实WAV音频。中文文本优先选中文系统嗓音；未安装中文语音时明确报错，可在系统里安装中文语音或配置TTS API。`GET /api/voices`列出系统可用嗓音；设置`tts.systemVoice`可指定。

开启`tts.enabled`后，独立的语音API配置调用兼容的`/audio/speech`端点，返回MP3。语音API的密钥与聊天API密钥分开。播放器使用实际音频振幅驱动嘴部，属于音量同步，不宣称精确音素对齐；中断应同时停止音频、清空播放队列并收口。

## 一起看网页

`PUT /api/watch {"enabled":true}` 后，Chrome/Edge扩展才能向`POST /api/watch/context`发送`{title,url,text,selection}`。内容只在内存保留，默认两分钟过期；关闭立即清除，重新启动默认关闭。扩展需要配对码，普通网站Origin被拒绝。

每次重新开启返回新的`sessionId`，扩展随页面提交该值；旧会话内容会被拒绝，防止关闭后静默恢复跟随。切换页面URL或选区、关闭或过期会取消旧的陪看生成；同页定时刷新不会打断生成。陪看回复包含`mode:watch`、`contextUrl`和`watchSessionId`，播放器可据此停止旧页面的语音。

`POST /api/chat {"text":"解释这一段","mode":"watch","verbosity":"brief"}` 将当前新鲜网页内容作为不可信数据供模型分析。页面内容不能授权工具操作，也不会被当作系统指令。Codex模式可根据用户问题搜索相关资料；普通API模式只分析提供的内容。上下文上传本身不会触发模型付费请求或自动发言，主动短评应由界面的去重与冷却控制。

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
