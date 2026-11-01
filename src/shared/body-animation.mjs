/** Model-specific body scores. Left/right always refer to the viewer's screen. */
const entries = [
  ['explain','讲到重点','抬手示意，稍稍前倾，再从容收势',5600,'pointer','right',false],
  ['think','侧头琢磨','指尖靠近嘴边，抬头想一会儿',6200,'pointer','right',false],
  ['reassure','轻声安慰','慢慢抚胸，轻轻靠近',6000,'chest','left',false],
  ['happy','轻快回应','抬手回应，身体轻轻上提',4800,'pointer','right',false],
  ['shy','含蓄躲闪','侧身低头躲一下，再悄悄看回来',6600,'chest','left',false],
  ['listen','认真听你','靠近侧耳听，停一会儿，再认真点头',6600,'none','right',false],
  ['chest-left','左侧抚胸','一手轻抚胸前，温柔地倾身',6000,'chest','left',false],
  ['chest-right','右侧抚胸','换一侧轻抚胸前，缓缓回应',6000,'chest','right',false],
  ['chest-both','双手抚胸','双手靠在胸前，轻轻靠近你',6500,'chest','both',false],
  ['pointer-left','左侧举指','抬起左侧食指，柔缓地点出重点',6500,'pointer','left',false],
  ['pointer-right','右侧举指','抬起右侧食指，柔缓地点出重点',6500,'pointer','right',false],
  ['talk','娓娓道来','边讲边轻晃指尖，停顿后再强调',10000,'pointer','right',true],
];
export const BODY_ANIMATION_PRESETS = Object.freeze(entries.map(([id,title,description,durationMs,gesture,handSide,continuous]) => Object.freeze({id,title,description,durationMs,gesture,handSide,continuous})));
const presets = Object.fromEntries(BODY_ANIMATION_PRESETS.map(row => [row.id,row]));
const clamp = (x, low = 0, high = 1) => Math.max(low, Math.min(high, Number.isFinite(x) ? x : 0));
const ease = x => { const t = clamp(x); return t * t * (3 - 2 * t); };
const keys = ['headX','headY','headZ','gazeX','gazeY','bodyX','bodyY','bodyZ','lean','lift','turn'];
const neutral = Object.freeze(Object.fromEntries(keys.map(key => [key,0])));
// Repeated keyframes are deliberate rests, not a continuously looping sway.
const sequences = {
  explain: {pose:'idea',frames:[
    [0,{}],[.18,{headX:-3,headY:2,gazeX:-.18,bodyX:-1,lean:-2,lift:-.5}],
    [.38,{headY:4,gazeY:.05,bodyY:1,lean:-4,lift:1}],
    [.54,{headY:3,gazeY:.05,bodyY:.6,lean:-4,lift:.7}],
    [.7,{headY:1,headZ:-2,bodyZ:-.8,lean:-2,lift:.2}],[1,{}],
  ]},
  think: {pose:'think',frames:[
    [0,{}],[.22,{headX:17,headY:8,headZ:2,gazeX:.24,gazeY:.6,bodyX:1,bodyZ:.7,lift:-.3}],
    [.43,{headX:17,headY:8,headZ:2,gazeX:.24,gazeY:.6,bodyX:1,bodyZ:.7,lift:-.3}],
    [.62,{headX:18,headY:9,headZ:3,gazeX:.32,gazeY:.65,bodyX:1.6,bodyZ:1,lift:.4}],
    [.78,{headX:17,headY:8,headZ:2,gazeX:.24,gazeY:.6,bodyX:1,bodyZ:.7,lift:-.1}],[1,{}],
  ]},
  reassure: {pose:'chest',frames:[
    [0,{}],[.25,{headZ:-4,headY:-1,gazeY:-.05,bodyZ:-1,lean:-5,lift:.3}],
    [.5,{headZ:-4,headY:-1,gazeY:-.05,bodyZ:-1,lean:-5,lift:.3}],
    [.67,{headZ:-3,headY:1,gazeY:0,bodyZ:-.7,lean:-4,lift:.7}],[1,{}],
  ]},
  happy: {pose:'idea',frames:[
    [0,{}],[.24,{headY:3,headZ:2,gazeY:.05,bodyY:1.4,bodyZ:.8,lean:-2,lift:1}],
    [.43,{headY:1,headZ:1,gazeY:0,bodyY:.5,bodyZ:.5,lean:-1,lift:.4}],
    [.6,{headY:2,headZ:2,gazeY:0,bodyY:.7,bodyZ:.5,lean:-1,lift:.55}],[1,{}],
  ]},
  shy: {pose:'chest',frames:[
    [0,{}],[.24,{headX:16,headY:-10,headZ:-8,gazeX:.68,gazeY:-.55,bodyX:3,bodyZ:-2.6,lean:4,lift:-.7}],
    [.45,{headX:16,headY:-10,headZ:-8,gazeX:.68,gazeY:-.55,bodyX:3,bodyZ:-2.6,lean:4,lift:-.7}],
    [.64,{headX:10,headY:-6,headZ:-5,gazeX:-.1,gazeY:-.05,bodyX:2,bodyZ:-1.6,lean:2,lift:-.3}],
    [.8,{headX:4,headY:-2,headZ:-2,gazeX:0,gazeY:0,bodyX:.5,bodyZ:-.5,lean:0,lift:0}],[1,{}],
  ]},
  listen: {pose:null,frames:[
    [0,{}],[.2,{headX:-4,headZ:9,headY:-2,gazeX:0,bodyX:-1.8,bodyZ:3,lean:-8}],
    [.43,{headX:-4,headZ:9,headY:-2,gazeX:0,bodyX:-1.8,bodyZ:3,lean:-8}],
    [.58,{headX:-2,headZ:6,headY:-6,gazeX:0,bodyZ:2,lean:-8}],
    [.69,{headX:-1,headZ:4,headY:4,gazeX:0,bodyZ:1.5,lean:-6}],
    [.79,{headX:0,headZ:2,headY:-1,gazeX:0,bodyZ:.6,lean:-3}],[1,{}],
  ]},
};
const sequenceFor = id => sequences[id] ?? sequences[id.startsWith('chest-') ? 'reassure' : 'explain'];
export function bodyAnimationId(value) {
  const aliases={greet:'happy',agree:'happy',idea:'happy',curious:'think',disagree:'explain',playful:'happy',cuddle:'reassure'};
  const id=(Object.hasOwn(aliases,value) ? aliases[value] : value);
  return Object.hasOwn(presets,id) ? id : null;
}
function sampleFrames(frames,p,amount) {
  const next=frames.findIndex(([at])=>at>=p);
  const right=frames[next<0?frames.length-1:next];
  const left=frames[Math.max(0,(next<0?frames.length-1:next)-1)];
  const weight=right[0]===left[0]?0:ease((p-left[0])/(right[0]-left[0]));
  return Object.fromEntries(keys.map(key=>[key,((left[1][key]??0)+((right[1][key]??0)-(left[1][key]??0))*weight)*amount]));
}
const pulse=(time,start,length)=>time>start&&time<start+length?Math.sin((time-start)/length*Math.PI)**2:0;
/** Progress owns entrance/exit; elapsed seconds own cadence, and may span sentences. */
export function sampleBodyAnimation(id,progress,intensity=1,options={}) {
  if(!Object.hasOwn(presets,id))return null;
  const preset=presets[id], sequence=sequenceFor(id), p=clamp(progress), amount=clamp(intensity);
  const duration=Number.isFinite(options.durationSeconds)?Math.max(.1,options.durationSeconds):preset.durationMs/1000;
  const elapsed=Number.isFinite(options.elapsedSeconds)?Math.max(0,options.elapsedSeconds):p*duration;
  const continuous=preset.continuous;
  const entrance=options.continuing?1:ease(p*duration/.9);
  const exit=options.hold?1:1-ease((p*duration-duration+.95)/.95);
  let values=sampleFrames(sequence.frames,p,amount);
  if(continuous){
    const phase=elapsed%3.5, delayed=(elapsed+.0-.18+3.5)%3.5;
    const main=pulse(phase,.35,1.45), second=pulse(phase,1.95,.65)*.35;
    const follow=pulse(delayed,.35,1.45)+pulse(delayed,1.95,.65)*.35;
    const envelope=entrance*exit*amount;
    // Two soft beats, then a genuine pause; the wrist trails the upper arm.
    const side=-.18;
    values={...neutral,headX:side*8*envelope,headY:(1+main*2.4)*envelope,headZ:side*3*envelope,
      gazeX:side*.42*envelope,gazeY:.04*envelope,bodyX:side*1.2*envelope,bodyY:main*.65*envelope,
      bodyZ:side*.9*envelope,lean:(-2.8-main*1.6)*envelope,lift:(main+second)*envelope,turn:(follow-.35*main)*envelope};
  }
  if(preset.handSide==='right'&&preset.gesture==='chest'||preset.handSide==='left'&&preset.gesture==='pointer'){
    for(const key of ['headX','headZ','gazeX','bodyX','bodyZ'])values[key]*=-1;
  }
  if(preset.handSide==='both'&&!continuous){
    for(const key of ['headX','headZ','gazeX','bodyX','bodyZ'])values[key]*=.3;
    values.lean-=entrance*exit*amount;
  }
  // Only continuous authored inputs: hand selectors and finger deformation are
  // intentionally untouched. A delayed wrist arc makes the extended finger soft.
  const armOffsets=sequence.pose==='think'?{Param39:values.lift*.012,Param41:values.lift*.014}
    :sequence.pose==='idea'?{Param36:values.lift*(continuous?.05:.024),Param39:values.turn*.02,Param41:values.lift*(continuous?.065:.045),Param42:values.turn*.026}
    :sequence.pose==='chest'?{Param59:values.lift*.016,Param60:values.lift*.032}:{};
  return {...values,gesture:preset.gesture,pose:sequence.pose,handSide:preset.handSide,continuous,armOffsets};
}
