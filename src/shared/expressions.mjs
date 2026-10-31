/** Calibrated face inputs for this model; apply before Cubism physics.
 * Mouth opening remains owned by audio while speech is active.
 * key7 is face.blush; key8 (thinking), key10 (basin), and eyewear stay independent.
 */
export const EXPRESSION_PARAMETER_DEFAULTS = Object.freeze({
  key1: 0, key2: 0, key3: 0, key4: 0, key5: 0, key6: 0, key9: 0, key13: 0,
  MouthPuckerWiden: 0,
});

const BASE_FACE = Object.freeze({
  smile: 0, eyeSmile: 0, browL: 0, browR: 0, eye: 1, open: 0, blush: 0,
  pucker: 0, funnel: 0, cheek: 0, innerBrow: 0, pupil: 1,
});
const preset = (id, title, icon, description, group, face = {}, parameters = {}, specialEyes = false) => Object.freeze({
  id, title, icon, description, group,
  face: Object.freeze({ ...BASE_FACE, ...face }),
  parameters: Object.freeze({ ...EXPRESSION_PARAMETER_DEFAULTS, ...parameters }),
  specialEyes,
});

export const EXPRESSION_PRESETS = Object.freeze([
  preset('neutral', '平静', '🙂', '放松眉眼，恢复自然神态。', '日常'),
  preset('happy', '开心', '😊', '眼角带笑，嘴角轻轻上扬。', '积极',
    { smile: 0.62, eyeSmile: 0.55, browL: 0.18, browR: 0.18, eye: 0.9, open: 0.08, blush: 0.08 }),
  preset('joyful', '雀跃', '😆', '笑着眯起眼睛，开心地张嘴大笑。', '积极',
    { smile: 0.95, eyeSmile: 1, browL: 0.45, browR: 0.45, eye: 0.08, open: 0.42, blush: 0.18 }),
  preset('squeezed', '>< 开心眼', '😆', '开心得眯成 >< 眼，笑意藏不住。', '特殊',
    { smile: 0.85, eyeSmile: 0.8, browL: 0.3, browR: 0.3, eye: 1, open: 0.25, blush: 0.2 }, { key5: 1 }, true),
  preset('gentle', '温柔', '☺️', '柔和半眯眼，安静地微笑。', '日常',
    { smile: 0.35, eyeSmile: 0.35, browL: 0.1, browR: 0.1, eye: 0.8, blush: 0.07 }),
  preset('puzzled', '疑惑', '🤔', '两边眉毛一高一低，轻轻噘嘴。', '思考',
    { smile: -0.28, browL: 0.35, browR: -0.22, eye: 1.03, open: 0.04, pucker: 0.55, funnel: 0.12, cheek: 0.12 }, { MouthPuckerWiden: -0.3 }),
  preset('curious', '好奇', '🧐', '抬眉睁眼，像在等下一句话。', '思考',
    { smile: 0.06, browL: 0.42, browR: 0.18, eye: 1.16, open: 0.16, innerBrow: 0.12, pupil: 1.04 }),
  preset('panic', '慌张', '😰', '睁大眼睛、张嘴冒汗。', '低落',
    { smile: -0.5, browL: 0.85, browR: 0.85, eye: 1.3, open: 0.65, innerBrow: 0.3, pupil: 0.94 }, { key13: 1 }),
  preset('shy', '害羞', '😳', '脸颊泛红，收起目光和笑意。', '日常',
    { smile: 0.32, eyeSmile: 0.35, browL: -0.08, browR: -0.08, eye: 0.64, blush: 0.85, pucker: 0.1 }),
  preset('cold', '冷淡', '😒', '低眉半睁眼，嘴角微微下压。', '思考',
    { smile: -0.35, browL: -0.5, browR: -0.5, eye: 0.6 }),
  preset('sad', '难过', '😔', '眉心上挑，嘴角下垂。', '低落',
    { smile: -0.62, browL: -0.35, browR: -0.35, eye: 0.68, open: 0.03, innerBrow: 0.65 }),
  preset('worried', '担心', '😟', '紧张地皱眉，嘴巴略微张开。', '低落',
    { smile: -0.32, browL: 0.15, browR: -0.2, eye: 0.94, open: 0.1, pucker: 0.2, innerBrow: 0.5 }, { key13: 0.4 }),
  preset('embarrassed', '尴尬', '😅', '不太自然的浅笑，带一点脸红和冷汗。', '低落',
    { smile: 0.05, eyeSmile: 0.08, browL: 0.2, browR: -0.28, eye: 0.82, blush: 0.5, innerBrow: 0.18 }, { key13: 0.8 }),
  preset('playful', '俏皮', '😜', '露出小兔牙，顽皮地笑。', '俏皮',
    { smile: 0.7, eyeSmile: 0.45, browL: 0.2, browR: 0.2, eye: 0.82, open: 0.32, blush: 0.12 }, { key9: 1 }),
  preset('smug', '得意', '😏', '屑屑眼搭配收着的笑，眉毛略带挑衅。', '俏皮',
    { smile: 0.38, browL: -0.18, browR: 0.32, eye: 1, pucker: 0.22 }, { key6: 1, MouthPuckerWiden: -0.18 }, true),
  preset('angry', '生气', '😠', '压低眉毛，鼓起脸颊、噘起嘴。', '低落',
    { smile: -0.75, browL: -0.72, browR: -0.72, eye: 0.9, pucker: 0.42, cheek: 0.65 }, { MouthPuckerWiden: -0.25 }),
  preset('sleepy', '困倦', '🥱', '眼皮下垂，嘴巴微张。', '日常',
    { smile: -0.08, browL: -0.25, browR: -0.25, eye: 0.24, open: 0.22, funnel: 0.18, pupil: 0.98 }),
  preset('surprised', '惊讶', '😮', '眼睛圆睁，嘴巴张成小小的 O。', '思考',
    { smile: -0.18, browL: 0.65, browR: 0.65, eye: 1.28, open: 0.48, funnel: 0.45, pupil: 0.94 }, { MouthPuckerWiden: -0.3 }),
  preset('determined', '认真', '😤', '眉眼收紧，抿嘴集中精神。', '思考',
    { smile: -0.05, browL: -0.38, browR: -0.38, eye: 0.84, pucker: 0.12 }),
  preset('proud', '自信', '😎', '眼尾带笑，抬起一侧眉毛。', '积极',
    { smile: 0.72, eyeSmile: 0.25, browL: 0.38, browR: 0.12, eye: 0.74, open: 0.03, blush: 0.06 }),
  preset('relieved', '松口气', '😌', '闭上双眼，露出安心的笑。', '日常',
    { smile: 0.4, eyeSmile: 0.6, browL: 0.04, browR: 0.04, eye: 0, open: 0.07, blush: 0.08 }),
  preset('love', '心动', '😍', '亮起爱心眼，带着红晕微笑。', '特殊',
    { smile: 0.68, eyeSmile: 0.35, browL: 0.2, browR: 0.2, eye: 1, open: 0.12, blush: 0.65 }, { key4: 1 }, true),
  preset('teary', '委屈', '🥺', '眼里泛起泪光，委屈地抿起嘴。', '特殊',
    { smile: -0.52, browL: -0.28, browR: -0.28, eye: 0.92, open: 0.12, blush: 0.2, innerBrow: 0.8 }, { key2: 1 }),
  preset('dizzy', '晕乎乎', '😵', '睁着白色圈圈眼，有点晕乎乎。', '特殊',
    { smile: -0.12, browL: 0.3, browR: 0.3, eye: 1, open: 0.28, funnel: 0.25 }, { key3: 1 }, true),
  preset('speechless', '无语', '😑', '半睁眼带着低气压，安静地停住。', '俏皮',
    { smile: -0.22, browL: -0.15, browR: -0.15, eye: 0.48, pucker: 0.1 }, { key1: 1 }),
]);

export const EXPRESSION_IDS = Object.freeze(EXPRESSION_PRESETS.map(item => item.id));
const BY_ID = new Map(EXPRESSION_PRESETS.map(item => [item.id, item]));
/** Unknown IDs resolve to neutral; validate against EXPRESSION_IDS for strict APIs. */
export function getExpressionPreset(id) { return BY_ID.get(id) ?? EXPRESSION_PRESETS[0]; }
