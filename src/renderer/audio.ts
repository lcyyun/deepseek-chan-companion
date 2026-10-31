import { credentials } from './api';
export interface SpeechProgress { elapsed: number; duration: number; ratio: number }
export class SpeechPlayer {
  context?: AudioContext;
  analyser?: AnalyserNode;
  source?: AudioBufferSourceNode;
  controller?: AbortController;
  generation = 0;
  data?: Float32Array;
  resolvePlay?: () => void;
  progressFrame?: number;
  async speak(text: string, onStart?: () => void, onProgress?: (progress: SpeechProgress) => void) {
    this.stop();
    const generation=this.generation;
    this.controller=new AbortController();
    const {url,token}=credentials();
    const response=await fetch(url+'/api/tts',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({text}),signal:this.controller.signal});
    if(!response.ok){let error='语音暂时不可用';try{const e=await response.json();error=e.error?.message||e.error||e.message||error;}catch{};throw new Error(String(error));}
    const buffer=await response.arrayBuffer();
    if(generation!==this.generation)return;
    this.context ||= new AudioContext();
    await this.context.resume();
    const decoded=await this.context.decodeAudioData(buffer);
    if(generation!==this.generation)return;
    this.analyser=this.context.createAnalyser();this.analyser.fftSize=512;this.analyser.smoothingTimeConstant=.3;
    this.data=new Float32Array(this.analyser.fftSize);
    this.source=this.context.createBufferSource();this.source.buffer=decoded;
    this.source.connect(this.analyser);this.analyser.connect(this.context.destination);
    await new Promise<void>(resolve=>{
      this.resolvePlay=resolve;
      const started=this.context!.currentTime,duration=decoded.duration;
      const progress=(ended=false)=>{
        if(generation!==this.generation)return;
        const elapsed=ended?duration:Math.max(0,Math.min(duration,this.context!.currentTime-started));
        onProgress?.({elapsed,duration,ratio:duration>0?elapsed/duration:1});
      };
      const frame=()=>{if(generation!==this.generation||!this.source)return;progress();this.progressFrame=requestAnimationFrame(frame);};
      this.source!.onended=()=>{
        if(generation===this.generation){
          if(this.progressFrame!==undefined)cancelAnimationFrame(this.progressFrame);
          this.progressFrame=undefined;progress(true);this.source=undefined;this.resolvePlay=undefined;
        }
        resolve();
      };
      this.source!.start();onStart?.();progress();
      if(generation===this.generation)this.progressFrame=requestAnimationFrame(frame);
    });
  }
  level(){if(!this.source||!this.analyser||!this.data)return 0;this.analyser.getFloatTimeDomainData(this.data as any);let energy=0;for(const x of this.data)energy+=x*x;const rms=Math.sqrt(energy/this.data.length);return rms<.009?0:Math.min(1,Math.pow(rms*4.2,.65));}
  stop(){this.generation++;if(this.progressFrame!==undefined)cancelAnimationFrame(this.progressFrame);this.progressFrame=undefined;this.controller?.abort();try{this.source?.stop();}catch{}this.source?.disconnect();this.analyser?.disconnect();this.source=undefined;this.resolvePlay?.();this.resolvePlay=undefined;}
  destroy(){this.stop();this.context?.close();}
}
