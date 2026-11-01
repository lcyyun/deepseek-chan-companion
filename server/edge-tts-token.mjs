/* SPDX-License-Identifier: LGPL-3.0-only
 * Edge read-aloud v2 token algorithm adapted from edge-tts drm.py.
 * Copyright (c) edge-tts contributors; https://github.com/rany2/edge-tts
 * JavaScript port, 2026: standard SHA rounds replace Python's unrolled rounds;
 * Math.imul preserves the protocol's unsigned 32-bit products.
 * This module remains separately replaceable. See licenses/edge-tts-LICENSE.txt
 * and licenses/GPL-3.0.txt. The network adapter is independently implemented.
 */
export const EDGE_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const initial = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
const resumed = [0xfd9fbea2,0x91243ce7,0xbe499094,0xcd2e1e0a,0x6c006f49,0x04bd35ab,0xfeb0a7e4,0x03effbd2];
const schedule = [0xeb24bf9e,0x1558691f,0xa0c09ee2,0x0cfa32ba,0xa622ee8c,0xd1dd9491,0xc0dd25a0,0xf9e70ab6,0xf0c31573,0x7058ce4e,0x7188e606,0x00e5ab33,0xd258b060,0x72766564];
const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
const coefficients = [[0xe82e91b1,0xb32700d0],[0x44de24c6,0x88dff51d],[0x3beb65bc,0x29514038],[0xc89c5933,0xb328cbdf],[0x8d1ec211,0xd405b4d5],[0x314ef5d5,0x26e55f3c],[0xe92491b1,0x607801c6],[0xf0a5b9d5,0x82b2c1fb],[0x06064cf3,0xfa51a3da],[0xda79fa60,0x207cc464],[0xbed20560,0x3c3c74f3],[0x89f9c9f8,0xd2d14b61],[0x35fa38c6,0xbb04a2c1],[0xcb49e3c6,0xc5626167]];
const rotr = (x, n) => (x >>> n) | (x << (32 - n));
const rol16 = x => ((x << 16) | (x >>> 16)) >>> 0;
const s0 = x => (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
const s1 = x => (rotr(x, 17) ^ rotr(x, 19) ^ (x >>> 10)) >>> 0;
function expand(w, from = 16) {
  for (let i = from; i < 64; i++) w.push((s1(w[i-2]) + w[i-7] + s0(w[i-15]) + w[i-16]) >>> 0);
}
function rounds(state, w, first = 0) {
  let [a,b,c,d,e,f,g,h] = state;
  for (let i = first; i < 64; i++) {
    const t1 = (h + (rotr(e,6)^rotr(e,11)^rotr(e,25)) + (g^(e&(f^g))) + (first === 14 && i === 14 ? 0xc9dc06a7 : k[i]) + w[i]) >>> 0;
    const t2 = ((rotr(a,2)^rotr(a,13)^rotr(a,22)) + ((a&b)|(c&(a|b)))) >>> 0;
    [a,b,c,d,e,f,g,h] = [(t1+t2)>>>0,a,b,c,(d+t1)>>>0,e,f,g];
  }
  return [a,b,c,d,e,f,g,h];
}
function digest(data) {
  const w = Array(14).fill(0);
  w.push(data.readUIntBE(0,3), data.readUInt32BE(3));
  for (let i = 16; i < 30; i++) {
    let v = schedule[i-16];
    if (i-2 >= 14) v += i === 16 ? (s1(w[i-2]) ^ 0x000b92c0) >>> 0 : s1(w[i-2]);
    if (i-7 >= 14) v += w[i-7];
    if (i-15 >= 14) v += i === 29 ? (s0(w[i-15]) ^ 0x059c0b80) >>> 0 : s0(w[i-15]);
    w.push(v >>> 0);
  }
  w.push((s1(w[28])+w[23]+s0(w[15])+w[14]+0xc9dc06a7-k[14]) >>> 0);
  expand(w,31);
  let state = rounds(resumed,w,14).map((v,i)=>(v+initial[i])>>>0);
  const length = 57 + data.length;
  const padding = Buffer.alloc((55 - length % 64 + 64) % 64);
  const size = Buffer.alloc(8); size.writeBigUInt64BE(BigInt(length*8));
  const padded = Buffer.concat([data.subarray(7),Buffer.from([0x80]),padding,size]);
  for (let offset=0; offset<padded.length; offset+=64) {
    const block = Array.from({length:16},(_,i)=>padded.readUInt32BE(offset+i*4));
    expand(block); state = rounds(state,block).map((v,i)=>(v+state[i])>>>0);
  }
  const result = Buffer.alloc(32); state.forEach((v,i)=>result.writeUInt32BE(v,i*4));
  return result;
}
function cs64(data, hash) {
  const a = hash.readUInt32LE(0)|1, b = hash.readUInt32LE(4)|1;
  const factors = [Math.imul(a,0x82893933),Math.imul(b,0x82893933)];
  const terms = coefficients.map(([v],i)=>Math.imul(v,factors[i%2])>>>0);
  const offsets = coefficients.map(([,v])=>v);
  const input = Buffer.alloc(Math.ceil((data.length+1)/8)*8); data.copy(input,1);
  for (let i=0;i<input.length/4;i++) {
    const word = input.readUInt32LE(i*4);
    let term = Math.imul(word,i%2===0?a:b);
    let off = Math.imul(rol16(word),i%2===0?0xef0569fb:0xc31713db);
    if (i===0) {term+=Math.imul(0xf2f90b1a,factors[0]);off+=0x0b1a0000;}
    terms.push(term>>>0); offsets.push(off>>>0);
  }
  let swapAcc=0,swapLast=0,state=0,acc=0;
  for(let i=0;i<terms.length;i+=2) {
    const x=terms[i],y=terms[i+1];
    let q=Math.imul(rol16((offsets[i]+x)>>>0),0x76f50f34)>>>0;
    swapAcc=(swapAcc+Math.imul(rol16(q),0xc3efea97)+q)>>>0;
    q=Math.imul(rol16((offsets[i+1]+y)>>>0),0x1881ce3c)>>>0;
    swapLast=(Math.imul(rol16(q),0x35bd1ec9)+q)>>>0;
    swapAcc=(swapAcc+swapLast)>>>0;
    state=(Math.imul(state,a)+x)>>>0;
    for(const factor of [0xcf98b111,0x87085b9f,0x12ceb96d,0x257e1d83]) state=Math.imul(rol16(state),factor)>>>0;
    acc=(acc+state)>>>0;
    let t=(Math.imul(state,b)+y)>>>0;
    for(const factor of [0xa27416f5,0xd38396ff,0x7c932b89,0xbfa49f69]) t=Math.imul(rol16(t),factor)>>>0;
    state=t; acc=(acc+state)>>>0;
  }
  const result=Buffer.alloc(8);result.writeUInt32LE((swapLast^state)>>>0,0);result.writeUInt32LE((swapAcc^acc)>>>0,4);return result;
}
export function edgeToken(unixSeconds = Date.now()/1000) {
  const bucket = Math.floor((unixSeconds + 11644473600)/300)*300;
  const data = Buffer.from(`${BigInt(bucket)*10000000n}${EDGE_CLIENT_TOKEN}`,'ascii');
  const hash=digest(data);
  return `${cs64(data,hash).toString('hex')}-${hash.toString('hex')}`.toUpperCase();
}
