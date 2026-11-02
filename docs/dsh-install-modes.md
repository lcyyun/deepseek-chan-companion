# DSH 安装：先选择会话模式

本页给安装智能体使用。安装桌宠插件前，**不要替用户默认选择模式**，先问清楚，再开始写配置。

## 先在应用里连接

大肥鱼 0.20 起，用户入口是「设置 → 连接 DeepSeek Harness」或首次启动向导。应用会：

1. 检测 DSH CLI 和 `DSH_HOME`
2. 生成自己的 patch、token 文件和 B 模式的 session 文件
3. 用同一个 DSH home/profile 启动或复用 DSH，**不新建独立实例**
4. 健康检查 MCP 和聊天桥
5. 如果 DSH 正在运行，先显示 3 秒倒计时警示；程序**不会关闭 DSH**，用户需完成任务、手动退出 DSH，再点“连接 DSH”重试；点“取消”不会动 DSH
6. 如果自动启动失败，面板提供“打开手动启动脚本位置”；双击 `start-dsh.cmd`，等 DSH 启动后回来刷新或点连接

应用生成的 patch 使用 `tokenFile`，不需要 `L2D_BRIDGE_TOKEN`。B 模式会在 `dsh/chat-session.txt` 保存会话 ID，重启后复用；A 模式在界面里列出最近会话并写入 `chatSessionId`。

下面的手工配置段落仍然适用于智能体安装、旧 DSH 或需要排查的场景。

## 先问用户

```text
安装皮套前，请先选择：

A. 接到已有聊天
   保留你现在这条聊天的人格和上下文。
   我平时正常聊天，需要表演时调用 avatar_reply 工具控制皮套。
   不会每轮往聊天里塞长 JSON 提示词。

B. 新建独立的桌宠会话
   新建一条不可见的“肥鱼”会话，不继承当前聊天上下文。
   同样使用 avatar_reply 工具，不会每轮注入长提示。
   适合想要一只独立桌宠、又不想影响主会话的情况。

两种模式都使用原生工具，表演质量相同；区别主要是是否继承上下文、
是否会影响原聊天、以及会话权限和所有权。

你选 A 还是 B？
```

用户选完后：

- 选 A：继续问“要接到哪个聊天窗口/会话？”，列出可见会话让用户选。
- 选 B：新建专用会话；创建后保存 `chatSessionId`，不要每次启动重新创建。
- 用户不选：停止安装，不要猜。

## 配置差异

两种模式都需要：

```yaml
- id: live2d-state-bridge
  name: 'C:/path/to/deepseek-chan-companion/integrations/dsh/live2d-bridge.mjs'
  config:
    baseUrl: http://127.0.0.1:39181
    chat: true
    native: true
```

### A：已有会话

把用户选中的会话 ID 填入：

```yaml
    chatSessionId: <用户选择的会话 ID>
```

这样皮套消息会进入用户原有的聊天上下文，不会新建会话。

### B：独立会话

第一次先不要填 `chatSessionId`，让插件创建专用会话；创建后把返回的会话 ID 保存回配置：

```yaml
    chatSessionId: <新建的专用会话 ID>
```

否则重启后会再建一条新会话，不继承上次的肥鱼上下文。

## 原生模式要求

- DSH 已安装并能调用 MCP 的 `avatar_reply` 工具
- 字段必须使用 `avatar_capabilities` 里的真实 ID；不要写 `hand_on_chest`、`wave` 等自造名字
- **抚胸**使用 `combination: reassure`（或 `gesture: chest`）；只写 `combination: shy` 只会换脸
- **娓娓道来**使用后续段的 `bodyAnimation: talk`
- “害羞抚胸，接着娓娓道来”应为：第一段 `combination: reassure` + `emotion: shy` + 抚胸；第二段 `combination: none` + `bodyAnimation: talk`
- `native: true` 时，桥只允许 `avatar_reply` 这类角色工具；终端、文件、其他角色工具仍被阻止
- 智能体正常说话；需要表演时调用一次 `avatar_reply`
- 不要把整段 JSON 表演规范再写回聊天；表演规范由工具 schema 承担
- `avatar_reply` 已经负责朗读/动作，普通助手文本只用于聊天窗展示，不应重复朗读

## JSON 桥还保留吗

保留，但只作为兼容旧 DSH 或外部客户端的 fallback。正常 DSH 安装优先使用 `native: true`，不要同时启用两套表演路径。

## 安全提醒

- 不要把配对码写进仓库、截图或公开聊天
- A 模式会共享原会话上下文，安装前要让用户明确知道
- B 模式如果需要限制工具权限，优先用专用会话，不要把开发主会话当成桌宠会话
- 删除会话前先确认它只属于桌宠，不要删除用户的原聊天会话
