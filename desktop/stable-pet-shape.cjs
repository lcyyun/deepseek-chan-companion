'use strict';
// Native-shape hysteresis. This never supplies head/chest hit tests.
// Returned rectangles already include padding: feed them to buildInputShape
// with padding:0 and CURRENT exclusions. Never cache the resulting exclusions.
const valid = rect => rect && ['x','y','width','height'].every(key=>Number.isFinite(rect[key])) && rect.width>0 && rect.height>0;
const right = rect => rect.x+rect.width, bottom = rect => rect.y+rect.height;
const contains = (outer,inner) => !inner || outer.x<=inner.x&&outer.y<=inner.y&&right(outer)>=right(inner)&&bottom(outer)>=bottom(inner);
const same = (a,b) => !!a&&!!b&&a.x===b.x&&a.y===b.y&&a.width===b.width&&a.height===b.height;
const union = (a,b) => {
  const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);
  return {x,y,width:Math.max(right(a),right(b))-x,height:Math.max(bottom(a),bottom(b))-y};
};
function padded(rect,width,height,padding) {
  const x=Math.max(0,Math.floor(rect.x-padding)),y=Math.max(0,Math.floor(rect.y-padding));
  const r=Math.min(width,Math.ceil(right(rect)+padding)),b=Math.min(height,Math.ceil(bottom(rect)+padding));
  return r>x&&b>y?{x,y,width:r-x,height:b-y}:null;
}

/** Stable, bounded native protection envelopes for separately keyed rectangles.
 * Preserve the caller's entire existing padding P: native setShape also clips
 * drawing, so that margin protects motion between geometry samples. Start with
 * 1.5P; cached envelopes MUST contain the current rectangle plus P and MUST fit
 * inside its 2P budget. Added transparent protection is at most the original P
 * per edge, never accumulated across old poses or movements.
 *
 * Call clear() on reload/reset; revision, contextKey (display/model), viewport,
 * scale and padding changes also invalidate automatically. Capture mode clears
 * all state. Caption/loading keys are independent and disappear immediately.
 */
function createStablePetShape({stableMs=600,maxHoldMs=1000}={}) {
  const settle=Number.isFinite(stableMs)?Math.max(0,Math.min(1000,stableMs)):600;
  const hold=Number.isFinite(maxHoldMs)?Math.max(settle,Math.min(1000,maxHoldMs)):1000;
  let identity=null,previousTime=null,entries=new Map();
  function clear(){identity=null;previousTime=null;entries.clear();}
  return {
    clear,
    update({regions=[],width,height,padding=18,revision=0,scale=1,contextKey='',fullWindow=false,now=0}={}) {
      if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0){clear();return [];}
      width=Math.floor(width);height=Math.floor(height);
      if(width<1||height<1){clear();return [];}
      const pad=Number.isFinite(padding)?Math.max(0,Math.min(256,padding)):18;
      const time=Number.isFinite(now)?now:0;
      const nextIdentity=JSON.stringify([width,height,pad,revision,scale,contextKey]);
      if(identity!==nextIdentity||previousTime!==null&&time<previousTime)clear();
      identity=nextIdentity;previousTime=time;
      if(fullWindow){clear();return [{x:0,y:0,width,height}];}
      const nextEntries=new Map(),output=[];
      for(const item of (Array.isArray(regions)?regions:[]).slice(0,8)) {
        if(!item||typeof item.key!=='string'||!item.key||item.key.length>80||nextEntries.has(item.key)||!valid(item.rect))continue;
        const rect=item.rect,budget=padded(rect,width,height,pad*2);
        if(!budget)continue;
        const required=padded(rect,width,height,pad),target=padded(rect,width,height,pad*1.5)||budget;
        const old=entries.get(item.key);
        let entry;
        const jumped=old&&Math.hypot(rect.x+rect.width/2-old.rect.x-old.rect.width/2,
          rect.y+rect.height/2-old.rect.y-old.rect.height/2)>Math.max(4,pad);
        if(!old||jumped||!contains(budget,old.envelope)) {
          entry={rect:{...rect},envelope:target,changedAt:time,expandedAt:null};
        } else {
          entry={...old,rect:{...rect}};
          if(!same(old.rect,rect))entry.changedAt=time;
          if(!contains(old.envelope,required)) {
            // Expand immediately; never wait through a frame with unprotected
            // model pixels. A whole-region jump was handled above.
            const enlarged=union(old.envelope,target);
            entry.envelope=contains(budget,enlarged)?enlarged:target;
            entry.expandedAt??=time;
          }
          const oversized=entry.envelope.width>target.width||entry.envelope.height>target.height;
          if(oversized&&entry.expandedAt===null)entry.expandedAt=time;
          if(oversized&&(time-entry.changedAt>=settle||time-entry.expandedAt>=hold)) {
            entry.envelope=target;entry.expandedAt=null;
          }
        }
        nextEntries.set(item.key,entry);output.push({...entry.envelope});
      }
      entries=nextEntries;
      return output;
    },
  };
}
module.exports={createStablePetShape};
