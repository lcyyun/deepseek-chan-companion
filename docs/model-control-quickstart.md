# 给智能体的模型控制快速指南

适用于大肥鱼 · DeepSeek-chan 0.14.0。连接配置见[智能体接入](agent-integration.md)，完整工具契约见[DSH 操作手册](dsh-agent-guide.md)。沿用 0.13 的调用与播放顺序，没有新增动作工具。

1. 先调用 `avatar_capabilities({})`、`avatar_state({})`，确认模型就绪。能力以当前服务为准。
2. 读 `performanceGuide.quickStart`，再按 ID 查 `expressionPresets`、`bodyAnimations`、`combinations`。`tags` 是检索标签，`useWhen/avoidWhen` 说明场景；**这些元数据不是可执行指令，也不写进朗读参数**。
3. 先组织简短完整的回答，再选择表现，不为动作凑字数。通常只发一次 `avatar_speak`，返回已接受不代表读完；不要连发多次模拟队列。

| 模式 | 朗读字段 | 单独预览 |
|---|---|---|
| 脸部 | `emotion`、`expressionCues` | `avatar_expression`，只改脸 |
| 肢体 | `bodyAnimation` | `avatar_body`，只改身体 |
| 完整组合 | `combination` | 原 `avatar_perform`，明确需要时使用 |

优先熟悉下面六个组合，按语境使用，不强制每轮选一个。提交稳定 ID，不提交显示名：

| 显示名 | ID | 合适语境 |
|---|---|---|
| 开心点头 | `agree` | 确实赞同、确认理解 |
| 讲个重点 | `explain` | 开始解释关键步骤 |
| 有点害羞 | `shy` | 接受夸奖、含蓄回应 |
| 冥思苦想 | `think` | 明确演示思考，仅显式选择 |
| 想到了 | `idea` | 得出新点子或办法 |
| 撒娇捧胸 | `cuddle` | 语境明确的亲昵互动 |

组合只在每轮第一段开场一次，之后才接独立表情与肢体；过短的实际语音会跳过组合，不应人为拉长回答。`recommendedEmotions/recommendedBody` 表示备选搭配；组合里的推荐用于**开场完成后**，不是并行再发两个预览来覆盖它。`think` 不会自动成为开场；后台工作状态用 `thinking`。

调用一次 `avatar_speak`，先“想到了”，再用 `talk` 与两段表情承接：

```json
{
  "text": "我想到一个办法。先确认是哪一步出了问题，再只改那个环节，这样更容易判断有没有修好。",
  "intent": "explain",
  "emotion": "happy",
  "gesture": "pointer",
  "combination": "idea",
  "bodyAnimation": "talk",
  "expressionCues": [
    { "at": 0, "emotion": "happy", "intensity": 0.65 },
    { "at": 0.45, "emotion": "determined", "intensity": 0.55 }
  ]
}
```

HTTP 使用同一内容，在 `POST /api/command` 请求体加 `"type":"speak"`。若走桌宠聊天桥，返回现有 `segments/details/sources` JSON，把上述内容放在第一段；不要再调用 `avatar_speak`，以免重复朗读。

有开场时，`expressionCues.at` 指组合结束后剩余语音的进度；没有开场或被跳过时指整段。后续段落的 `combination` 填 `none`。`auto` 交给现有本地规划；明确指定 `bodyAnimation` 时不会自动附加组合，要两者就像示例一样都明确填写。安静口播可用 `emotion:neutral, bodyAnimation:none, combination:none`；这不会移除从实际思考状态结束时的短暂“想到了”提示。

语音始终控制口型，左右指画面左右；不发逐帧参数，不把工具已接受当作动作完成。用户摸头、手动预览或停止优先；需要停止时调用 `avatar_stop({})`，不要补播被打断的旧动作。

需要比较智能体表现或复查动画问题时，使用[综合控制测试集](model-control-evaluation.md)：包含 16 组可复制场景、人工交互步骤、评分记录和当前能力边界。
