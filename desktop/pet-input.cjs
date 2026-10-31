// Native window shape: protect the character plus a small margin; leave distant
// empty space usable. Keep the whole pointer gesture in this window once pressed.
function normalizeRegions(input, width, height, padding = 18) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 8).flatMap(r => {
    if (!r || !['x','y','width','height'].every(k => Number.isFinite(r[k])) || r.width <= 0 || r.height <= 0) return [];
    const x = Math.max(0, Math.floor(r.x-padding)), y = Math.max(0, Math.floor(r.y-padding));
    const right = Math.min(width, Math.ceil(r.x+r.width+padding)), bottom = Math.min(height, Math.ceil(r.y+r.height+padding));
    return right > x && bottom > y ? [{x,y,width:right-x,height:bottom-y}] : [];
  });
}
// Rectangles use desktop/client DIP, matching Electron setShape (including HiDPI).
function subtractRegions(regions, exclusions) {
  let result = regions.map(rect => ({ ...rect }));
  for (const hole of exclusions) {
    result = result.flatMap(rect => {
      const left = Math.max(rect.x, hole.x), top = Math.max(rect.y, hole.y);
      const right = Math.min(rect.x + rect.width, hole.x + hole.width);
      const bottom = Math.min(rect.y + rect.height, hole.y + hole.height);
      if (right <= left || bottom <= top) return [rect];
      return [
        { x: rect.x, y: rect.y, width: rect.width, height: top - rect.y },
        { x: rect.x, y: bottom, width: rect.width, height: rect.y + rect.height - bottom },
        { x: rect.x, y: top, width: left - rect.x, height: bottom - top },
        { x: right, y: top, width: rect.x + rect.width - right, height: bottom - top },
      ].filter(piece => piece.width > 0 && piece.height > 0);
    });
  }
  return result;
}

function buildInputShape({ regions, width, height, fullWindow = false, exclusions = [], padding = 18, fallbackRegions }) {
  const protectedRegions = fullWindow ? [{ x: 0, y: 0, width, height }] : normalizeRegions(regions, width, height, padding);
  if (!protectedRegions.length) protectedRegions.push(...(fallbackRegions ? normalizeRegions(fallbackRegions, width, height, padding) : [{ x: 0, y: 0, width, height }]));
  return subtractRegions(protectedRegions, normalizeRegions(exclusions, width, height, 0));
}

const REFERENCE_SIZE = Object.freeze({ width: 370, height: 575 });
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const validRect = rect => rect && ['x','y','width','height'].every(key => Number.isFinite(rect[key])) && rect.width > 0 && rect.height > 0;

function constrainPosition(position, area, scale, footprint) {
  const constrained = {};
  for (const [axis, dimension] of [['x','width'],['y','height']]) {
    const size=validRect(footprint)?footprint[dimension]:REFERENCE_SIZE[dimension]*scale;
    const offset=validRect(footprint)?footprint[axis]:-size/2;
    // Every size may sit partly offscreen (including half-body corner layouts).
    // Retain only a grab-sized strip; never pull a small character fully inside.
    const visible=Math.min(80,size/2,area[dimension]/2);
    const min = area[axis] + visible - offset - size;
    const max = area[axis] + area[dimension] - visible - offset;
    constrained[axis] = clamp(finite(position?.[axis], area[axis] + area[dimension]/2), min, max);
  }
  return constrained;
}

function createPetPlacement({ area, scale = 1, position }) {
  if (!validRect(area)) throw new TypeError('Invalid placement geometry');
  const actualScale = clamp(finite(scale, 1), .5, 4);
  const center = { x: finite(position?.x, area.x+area.width-220), y: finite(position?.y, area.y+area.height-REFERENCE_SIZE.height/2-25) };
  return { scale: actualScale, bounds: { ...area }, position: center, placement: {
    scale: actualScale, centerX: center.x-area.x, centerY: center.y-area.y,
    referenceWidth: REFERENCE_SIZE.width, referenceHeight: REFERENCE_SIZE.height,
  } };
}

function computePetZoom({ bounds, area = bounds, position, scale, currentScale = 1, anchor, fullBody }) {
  if (!validRect(bounds) || !validRect(area)) throw new TypeError('Invalid zoom geometry');
  const actualScale = clamp(finite(scale, currentScale), 0.5, 4);
  const previousScale = Math.max(0.001, finite(currentScale, 1));
  const ratio = actualScale / previousScale;
  const oldCenter = createPetPlacement({area:bounds,scale:previousScale,position}).position;
  const point = { x: bounds.x+finite(anchor?.x,oldCenter.x-bounds.x), y: bounds.y+finite(anchor?.y,oldCenter.y-bounds.y) };
  let center = { x: point.x+(oldCenter.x-point.x)*ratio, y: point.y+(oldCenter.y-point.y)*ratio };
  const footprint=validRect(fullBody)?{x:(bounds.x+fullBody.x-oldCenter.x)*ratio,y:(bounds.y+fullBody.y-oldCenter.y)*ratio,width:fullBody.width*ratio,height:fullBody.height*ratio}:undefined;
  center = constrainPosition(center, area, actualScale,footprint);
  return createPetPlacement({area,scale:actualScale,position:center});
}

function restorePetPlacement(config, area) {
  let scale = clamp(finite(config.petScale, 1), .5, 4);
  let position = config.petLayoutVersion === 2 ? config.petPosition : null;
  if (!position && validRect(config.petBounds)) {
    // Migrate the old small-window center, deliberately discarding accumulated
    // NDC offsets that could leave the character far below its visible frame.
    position = { x: config.petBounds.x+config.petBounds.width/2, y: config.petBounds.y+105+Math.max(1,config.petBounds.height-105)/2 };
  }
  const base=createPetPlacement({area,scale,position});
  // The last real body can be asymmetric or wider than the reference fit.
  // Reuse it before the first renderer frame so a valid corner does not jump.
  const saved=config.petFootprint;
  const footprint=validRect(saved)&&saved.scale===scale&&saved.modelRoot===(config.modelRoot||null)?saved:undefined;
  return createPetPlacement({area,scale,position:constrainPosition(base.position,area,scale,footprint)});
}

function referenceBody(state) {
  const width=REFERENCE_SIZE.width*state.scale,height=REFERENCE_SIZE.height*state.scale;
  return{x:state.position.x-state.bounds.x-width/2,y:state.position.y-state.bounds.y-height/2,width,height};
}
function transformRegion(rect, before, after) {
  const ratio=after.scale/before.scale;
  return{x:after.position.x+(before.bounds.x+rect.x-before.position.x)*ratio-after.bounds.x,y:after.position.y+(before.bounds.y+rect.y-before.position.y)*ratio-after.bounds.y,width:rect.width*ratio,height:rect.height*ratio};
}
function clipRegion(rect, width, height) { return normalizeRegions([rect],width,height,0)[0] || null; }

// Preserve an independently placed control on its monitor. If that monitor is
// removed, recover onto the nearest remaining work area rather than offscreen.
function constrainToolBounds(bounds, workAreas) {
  if (!validRect(bounds) || !Array.isArray(workAreas)) throw new TypeError('Invalid control geometry');
  const areas=workAreas.filter(validRect);
  if (!areas.length) throw new TypeError('No available work area');
  const overlap=area=>Math.max(0,Math.min(bounds.x+bounds.width,area.x+area.width)-Math.max(bounds.x,area.x))*Math.max(0,Math.min(bounds.y+bounds.height,area.y+area.height)-Math.max(bounds.y,area.y));
  const distance=area=>Math.hypot(bounds.x+bounds.width/2-clamp(bounds.x+bounds.width/2,area.x,area.x+area.width),bounds.y+bounds.height/2-clamp(bounds.y+bounds.height/2,area.y,area.y+area.height));
  const area=areas.reduce((best,next)=>overlap(next)>overlap(best)||overlap(next)===overlap(best)&&distance(next)<distance(best)?next:best);
  const width=Math.min(bounds.width,area.width),height=Math.min(bounds.height,area.height);
  return {x:Math.round(clamp(bounds.x,area.x,area.x+area.width-width)),y:Math.round(clamp(bounds.y,area.y,area.y+area.height-height)),width,height};
}

function layoutToolBounds(body, area) {
  const clampRect=rect=>{const width=Math.min(rect.width,area.width),height=Math.min(rect.height,area.height);return{width,height,x:Math.round(clamp(rect.x,area.x,area.x+area.width-width)),y:Math.round(clamp(rect.y,area.y,area.y+area.height-height))};};
  const toggle=clampRect({x:body.x+body.width-40,y:body.y+body.height-30,width:58,height:58});
  const width=Math.min(420,area.width),height=Math.min(560,area.height-24);
  const x=body.x>=area.x+width+12?body.x-width-12:body.x+body.width+12;
  return{toggle,chat:clampRect({x,y:body.y+body.height-height,width,height})};
}

function createToolAnchor() {
  let body=null,revision=-1;
  return {
    get body(){return body;},
    update(nextBody,nextRevision){
      if(validRect(nextBody)&&(revision!==nextRevision||!body)){body={...nextBody};revision=nextRevision;}
      return body;
    },
    predict(before,after){body=body?clipRegion(transformRegion(body,before,after),after.bounds.width,after.bounds.height):null;revision=-1;return body;},
    clear(){body=null;revision=-1;},
  };
}

module.exports = { normalizeRegions, subtractRegions, buildInputShape, computePetZoom, createPetPlacement, restorePetPlacement, constrainPosition, referenceBody, transformRegion, clipRegion, constrainToolBounds, layoutToolBounds, createToolAnchor, validRect, REFERENCE_SIZE };
