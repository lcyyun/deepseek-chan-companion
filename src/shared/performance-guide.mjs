/** Selection metadata only. Playback timing and interaction priority live elsewhere. */
const entry = (tags, useWhen, avoidWhen, recommendedBody = [], recommendedEmotions = []) => Object.freeze({
  tags: Object.freeze(tags), useWhen, avoidWhen,
  recommendedBody: Object.freeze(recommendedBody), recommendedEmotions: Object.freeze(recommendedEmotions),
});
const named = (displayName, ...args) => Object.freeze({ ...entry(...args), displayName });

/** Pairings are alternatives, not instructions to stack multiple faces or arms. */
export const EXPRESSION_GUIDE = Object.freeze({
  neutral: entry(['calm', 'baseline'], '陈述事实或自然停顿', '需要鲜明情绪回应时', ['listen']),
  happy: entry(['positive', 'smile'], '友好回应、小小的好消息', '对方正在难过时', ['happy', 'chest-left']),
  joyful: entry(['celebrate', 'delight'], '明显的喜讯或共同庆祝', '普通确认与严肃说明', ['happy']),
  squeezed: entry(['playful', 'delight', 'special-eyes'], '忍不住开心、可爱的玩笑', '严肃交流或持续长篇使用', ['happy', 'chest-both']),
  gentle: entry(['warm', 'reassure'], '安慰、感谢或耐心陪伴', '必须清晰表达紧急性时', ['reassure', 'listen']),
  puzzled: entry(['uncertain', 'clarify'], '没想通或需要澄清', '已经确定答案却装疑惑', ['think', 'listen']),
  curious: entry(['interested', 'question'], '发现新事物、邀请继续讲', '对方不愿继续的话题', ['listen', 'pointer-right']),
  panic: entry(['startled', 'distress'], '突发惊吓的短暂反应', '普通担心或日常不确定', ['listen']),
  shy: entry(['bashful', 'blush'], '收到夸奖、含蓄表达亲近', '普通事实说明或每句感谢', ['shy', 'chest-both']),
  cold: entry(['reserved', 'boundary'], '克制疏离或明确边界', '需要安慰或修复误会时', ['listen']),
  sad: entry(['sad', 'empathy'], '表达遗憾、共情失落', '小错误或无关的事实描述', ['listen', 'chest-left']),
  worried: entry(['concern', 'uncertain'], '关心未解决的问题', '已经解除顾虑后', ['listen', 'reassure']),
  embarrassed: entry(['awkward', 'blush'], '轻微说错话、善意的小尴尬', '严重问题需要认真道歉时', ['shy', 'chest-right']),
  playful: entry(['tease', 'humor'], '双方都在参与的轻松玩笑', '严肃求助或对方不舒服时', ['happy', 'pointer-left']),
  smug: entry(['mischievous', 'confidence', 'special-eyes'], '带玩笑意味的小得意', '嘲笑对方错误或争执时', ['pointer-right', 'chest-left']),
  angry: entry(['disapproval', 'boundary'], '认真表达不满或制止玩闹', '把用户的普通提问当冒犯', ['listen']),
  sleepy: entry(['tired', 'rest'], '睡前聊天、明确谈到困倦', '对方期待专心倾听时', ['listen']),
  surprised: entry(['surprise', 'discovery'], '意外信息或突然的发现', '每个新句子都惊讶', ['happy', 'pointer-right']),
  determined: entry(['focused', 'resolve'], '认真计划、解释关键步骤', '亲昵玩笑需要柔和语气时', ['explain', 'talk']),
  proud: entry(['confident', 'achievement'], '肯定进展、分享完成的成果', '结果未验证却表现笃定', ['explain', 'chest-right']),
  relieved: entry(['relief', 'resolved'], '问题解决后松一口气', '风险或顾虑尚未解除', ['reassure', 'chest-left']),
  love: entry(['affection', 'blush', 'special-eyes'], '回应明确的亲昵互动', '普通感谢或严肃讨论', ['chest-both', 'shy']),
  teary: entry(['vulnerable', 'empathy'], '温和的委屈或感动', '把对方的痛苦演成戏剧', ['listen', 'chest-left']),
  dizzy: entry(['overwhelmed', 'gag', 'special-eyes'], '信息太多的玩笑、短暂晕乎', '严肃健康话题或持续使用', ['listen']),
  speechless: entry(['deadpan', 'tease'], '熟悉语境里的轻吐槽、无奈', '初次交流或对方在求安慰', ['listen', 'chest-right']),
});

export const BODY_ANIMATION_GUIDE = Object.freeze({
  explain: entry(['explain', 'emphasis'], '讲到一个重点、短段说明', '无需强调的简短确认', [], ['determined', 'curious', 'neutral']),
  think: entry(['reflect', 'consider'], '讲出权衡过程或暂作思索', '已得结论却持续装思考', [], ['puzzled', 'curious']),
  reassure: entry(['reassure', 'approach'], '耐心安慰、轻声说明', '需要保持克制距离时', [], ['gentle', 'worried', 'relieved']),
  happy: entry(['upbeat', 'respond'], '轻快答应、分享好消息', '沉重或严肃的话题', [], ['happy', 'joyful', 'surprised']),
  shy: entry(['avert', 'bashful'], '含蓄接受夸奖、害羞躲闪', '需要直视并说清楚事实时', [], ['shy', 'embarrassed']),
  listen: entry(['listen', 'attention'], '认真倾听、追问或共情', '长篇讲解却一直示意倾听', [], ['gentle', 'curious', 'worried']),
  'chest-left': entry(['chest', 'left', 'sincere'], '表达自己的感受或真诚承诺', '只是罗列外部事实', [], ['gentle', 'happy', 'relieved']),
  'chest-right': entry(['chest', 'right', 'sincere'], '换右侧抚胸表达真诚', '为变化而频繁左右切换', [], ['gentle', 'shy', 'proud']),
  'chest-both': entry(['chest', 'both', 'affection'], '双手抚胸、温柔亲近的回应', '中性工作说明或每句都用', [], ['gentle', 'shy', 'love']),
  'pointer-left': entry(['point', 'left', 'emphasis'], '用左侧举指强调一个要点', '快速左右交替或连续指点', [], ['curious', 'determined', 'happy']),
  'pointer-right': entry(['point', 'right', 'emphasis'], '用右侧举指提醒关键一步', '无需强调的寒暄', [], ['determined', 'curious', 'proud']),
  talk: entry(['explain', 'continuous', 'cadence'], '较长说明，随口播柔缓举指', '一句短答或只需安静共情', [], ['determined', 'neutral', 'gentle']),
});

/** These emotion/body suggestions apply AFTER the complete opening combination. */
export const COMBINATION_GUIDE = Object.freeze({
  greet: entry(['greeting', 'welcome'], '开始一次新的招呼', '同一轮每段重复招呼', ['happy', 'listen'], ['happy', 'gentle']),
  explain: named('讲个重点', ['explain', 'emphasis'], '进入有明确重点的解释', '简短确认或无需说明时', ['talk', 'explain'], ['determined', 'neutral']),
  agree: named('开心点头', ['agree', 'acknowledge'], '明确赞同、确认理解', '尚不确定或实际有异议时', ['happy', 'listen'], ['happy', 'gentle']),
  disagree: entry(['disagree', 'correct'], '温和纠正、表达不同意见', '为了活泼而无故摇头', ['explain', 'listen'], ['determined', 'puzzled']),
  curious: entry(['curious', 'question'], '对新信息好奇并发问', '已经理解却反复装惊奇', ['listen', 'think'], ['curious', 'puzzled']),
  reassure: entry(['reassure', 'comfort'], '回应焦虑、失落或顾虑', '中性事实或嬉闹场景', ['reassure', 'chest-left'], ['gentle', 'relieved']),
  shy: named('有点害羞', ['bashful', 'blush'], '被夸奖后的含蓄回应', '日常确认或严肃答复', ['shy', 'chest-right'], ['shy', 'embarrassed']),
  playful: entry(['humor', 'prop'], '轻松互动中的小彩蛋', '严肃求助或频繁展示道具', ['happy', 'listen'], ['playful', 'happy']),
  surprised: entry(['surprise', 'react'], '遇到明显意外的消息', '普通问候或每次转场', ['listen', 'happy'], ['surprised', 'curious']),
  cuddle: named('撒娇捧胸', ['affection', 'chest', 'blush'], '明确亲昵、撒娇式的互动', '默认套用在工作交流里', ['chest-both', 'shy'], ['shy', 'gentle', 'love']),
  think: named('冥思苦想', ['reflect', 'explicit', 'loading'], '确实要演示思考时显式选择', '答案已确定或只因后台等待', ['think', 'explain'], ['puzzled', 'curious']),
  idea: named('想到了', ['insight', 'solution'], '找到办法、得出新的点子', '没有新结论却每轮都庆祝', ['explain', 'talk'], ['happy', 'proud']),
});

export const PERFORMANCE_GUIDE_BRIEF = '按自己的意图语气选动作，不因引用里的情绪词换脸。优先熟悉组合：agree赞同、explain讲解、shy害羞、think思索、idea点子、cuddle撒娇；须语境吻合，think只显式选。face只改脸，body只改肢体；组合每段一次，连续动作在连续段重复同一组合，短语音会压缩播放。之后独立脸与body承接余段。语音拥有口型，勿逐帧控制或为动画凑字数。不需要动作的段填combination:none；安静口播用emotion:neutral、bodyAnimation:none、combination:none，思考完成提示仍保留。左右指画面左右。';

export const EXPRESSION_HOLD_GUIDE = '表情停留：expressionCues.at 是段内语音进度(0–0.9)，实际持续≈比例×该段语音时长。需要停留的脸红/害羞/窘迫/惊讶：台词尽量写到约30字以上；在0、约0.45、约0.85锚定同一或相近情绪；强度约0.8–0.85→0.65–0.75→0.55–0.6；单段最多4个cue，不再叠加。跨段延续优先“长台词+多锚点”，不要靠增加段数，避免动作重入和口型重置。';

export const SPECIAL_EXPRESSION_GUIDE = '特殊表情：爱心眼love是表白级，只在用户明确表达爱意、亲昵告白或主动要求时使用；每轮最多一次，强度约0.7–0.85。普通感谢、夸奖、好消息、工作讨论和悲伤严肃场景改用happy/joyful/gentle/playful，不要用爱心眼冒充热情。';

export const PERFORMANCE_GUIDE = Object.freeze({
  modes: Object.freeze({
    face: Object.freeze({ fields: 'emotion / expressionCues', description: '只控制面部；小表情预览不带肢体，语音保持口型优先。' }),
    body: Object.freeze({ fields: 'bodyAnimation', description: '只控制肢体；与面部独立，推荐表情是可选搭配。' }),
    combination: Object.freeze({ fields: 'combination', description: '完整开场组合；首段至多一次，随后才接独立面部与肢体，过短语音跳过。' }),
  }),
  preferredCombinations: Object.freeze(['agree', 'explain', 'shy', 'think', 'idea', 'cuddle']),
  expressionPresets: EXPRESSION_GUIDE,
  bodyAnimations: BODY_ANIMATION_GUIDE,
  combinations: COMBINATION_GUIDE,
});

/** Compact prompt text; full avoid/pairing metadata stays in capabilities. */
export function formatPerformanceGuide({ includeCatalog = true } = {}) {
  if (!includeCatalog) return PERFORMANCE_GUIDE_BRIEF;
  const line = (label, entries) => label + '：' + Object.entries(entries).map(([id, value]) => `${id}${value.displayName ? `(${value.displayName})` : ''}=[${value.tags.join('/')}]${value.useWhen}`).join('；');
  return [PERFORMANCE_GUIDE_BRIEF, line('面部', EXPRESSION_GUIDE), line('肢体', BODY_ANIMATION_GUIDE), line('组合', COMBINATION_GUIDE)].join('\n');
}
