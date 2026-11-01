"""Prepare, subtitle and assemble real companion footage into an editable promo.

Run --prepare before record-promo.cjs, then --assemble after capture completes.
All media is written below output/video014; the application is not modified.
"""
from __future__ import annotations
import argparse, array, json, math, re, subprocess, sys, wave
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'output/video014'

def run(args):
    result = subprocess.run([str(x) for x in args], capture_output=True, text=True, encoding='utf-8', errors='replace')
    if result.returncode: raise RuntimeError(result.stderr[-5000:])
    return result.stdout

def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')

def stamp(seconds, ass=False):
    unit=100 if ass else 1000
    ticks=round(max(0,seconds)*unit)
    h,ticks=divmod(ticks,3600*unit);m,ticks=divmod(ticks,60*unit);s,ticks=divmod(ticks,unit)
    return f'{h}:{m:02}:{s:02}.{ticks:02}' if ass else f'{h:02}:{m:02}:{s:02},{ticks:03}'

def split_caption(text, limit=25):
    parts=re.findall(r'[^，。！？；：、,!?;:]+[，。！？；：、,!?;:]*',text)
    result=[];buf=''
    for part in parts:
        if len(buf)+len(part)>limit and buf: result.append(buf);buf=''
        while len(part)>limit: result.append(part[:limit]);part=part[limit:]
        buf+=part
    if buf: result.append(buf)
    return result or [text]

ASS_HEAD='''[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Microsoft YaHei,42,&H00FFFFFF,&H00FFFFFF,&H00452712,&H6014263B,-1,0,0,0,100,100,1,0,1,3,1,2,100,100,115,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''

def captions(segment):
    boundaries=segment.get('boundaries') or [{'text':segment['text'],'start':0,'duration':segment['duration']}]
    cues=[]
    for boundary in boundaries:
        pieces=split_caption(boundary['text']);weight=sum(len(p) for p in pieces);start=boundary['start']
        for text in pieces:
            duration=boundary['duration']*len(text)/max(1,weight)
            cues.append({'start':start,'end':min(segment['duration'],start+duration),'text':text.strip('，。')})
            start+=duration
    for current, following in zip(cues,cues[1:]):
        current['end']=min(current['end'],following['start']-.015)
    return cues

def spoken_at(segment, phrase, fallback):
    # Sentence timing is measured; a keyword's position within it is approximate.
    for boundary in segment.get('boundaries',[]):
        index=boundary['text'].find(phrase)
        if index>=0:return boundary['start']+boundary['duration']*index/max(1,len(boundary['text']))
    return fallback

def prepare(tag, voice_manifest):
    source=json.loads(voice_manifest.read_text(encoding='utf-8-sig'))
    project=json.loads((BASE/'project.json').read_text(encoding='utf-8'))
    specifications={s['id']:s for s in project['segments']}
    if len(source['segments'])!=len(specifications): raise ValueError('Voice generation is incomplete')
    directory=BASE/tag;directory.mkdir(exist_ok=True)
    audio_dir=directory/'audio';audio_dir.mkdir(exist_ok=True)
    subtitle_dir=directory/'subtitles';subtitle_dir.mkdir(exist_ok=True)
    segments=[];jobs=[];global_cues=[];cursor=0
    for voice in source['segments']:
        segment={**specifications[voice['id']],**voice}
        with wave.open(segment['wav'],'rb') as wav:
            assert wav.getnchannels()==1 and wav.getsampwidth()==2
            rate=wav.getframerate();data=wav.readframes(wav.getnframes())
        boundaries=[dict(b) for b in segment.get('boundaries',[])]
        gap=0;cut=None
        if segment['id']=='08-basin':
            listened=next((b for b in boundaries if '注意听' in b['text']),None)
            cut=(listened['start']+listened['duration']) if listened else segment['duration']*.6
            gap=2.15;index=round(cut*rate)*2
            data=data[:index]+b'\0'*(round(gap*rate)*2)+data[index:]
            for boundary in boundaries:
                if boundary['start']>=cut-.03:boundary['start']+=gap
        lead=.22
        data=b'\0'*(round(lead*rate)*2)+data
        for boundary in boundaries:boundary['start']+=lead
        output=audio_dir/(segment['id']+'.wav')
        with wave.open(str(output),'wb') as wav:
            wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(rate);wav.writeframes(data)
        segment.update(wav=str(output),duration=len(data)/2/rate,boundaries=boundaries,offset=cursor)
        segment['seconds']=math.ceil((segment['duration']+segment.get('tail',.6))*30)/30
        segment['captureLabel']=tag+'-'+segment['id'];segment['cues']=captions(segment)
        segment['ass']=str(subtitle_dir/(segment['id']+'.ass'))
        Path(segment['ass']).write_text(ASS_HEAD+'\n'.join(
            f"Dialogue: 0,{stamp(c['start'],True)},{stamp(c['end'],True)},Default,,0,0,0,,{{\\fad(70,70)}}{c['text']}"
            for c in segment['cues'])+'\n',encoding='utf-8-sig')
        for cue in segment['cues']:global_cues.append({**cue,'start':cue['start']+cursor,'end':cue['end']+cursor})
        job={'label':segment['captureLabel'],'scene':segment['scene'],'seconds':segment['seconds'],'framing':segment['framing'],
             'backgroundImage':str(BASE/'graphics'/(segment['graphic']+'.background.png')),'audio':str(output),'mouth':segment['mouth']}
        if segment['id']=='03-faces':
            job['events']=[[0,'expression:happy'],[spoken_at(segment,'疑惑',4),'expression:puzzled'],
                           [spoken_at(segment,'害羞',6.2),'expression:shy'],[spoken_at(segment,'圈圈眼',8.7),'expression:dizzy'],
                           [max(spoken_at(segment,'你说的话',11.8),spoken_at(segment,'圈圈眼',8.7)+1.4),'expression:squeezed']]
        if segment['id']=='04-arms':job['events']=[[0,'pointer-left'],[segment['seconds']/3,'pointer-right'],[segment['seconds']*2/3,'chest-both']]
        if segment['id']=='05-thinking':
            idea_at=spoken_at(segment,'答案来了',6.8)
            job['events']=[[0,'think'],[idea_at,'idea'],[idea_at+2,'talk']]
        if segment['id']=='06-speech':job['events']=[[0,'idea'],[1.9,'talk'],[2,'expression:determined'],[12,'expression:gentle']]
        if cut is not None:
            segment['pipeAt']=cut+lead+.1
            job['events']=[[0,'basin-start'],[segment['pipeAt'],'knock'],[segment['pipeAt']+.65,'knock'],[segment['pipeAt']+1.35,'knock']]
        jobs.append(job);segments.append(segment);cursor+=segment['seconds']
    document={'title':project['title'],'tag':tag,'voiceEngine':source.get('engine'),'segments':segments,'duration':cursor}
    save(directory/'edit.json',document);save(BASE/('capture-jobs-'+tag+'.json'),jobs)
    (directory/'captions.srt').write_text('\n\n'.join(f"{i+1}\n{stamp(c['start'])} --> {stamp(c['end'])}\n{c['text']}" for i,c in enumerate(global_cues))+'\n',encoding='utf-8-sig')
    print(json.dumps({'edit':str(directory/'edit.json'),'captureJobs':str(BASE/('capture-jobs-'+tag+'.json')),'duration':cursor,'segments':len(segments)},ensure_ascii=False),flush=True)

def score(path, duration):
    # Original sparse mallet accompaniment; no third-party music samples.
    import numpy as np
    rate=48000;samples=int((duration+1)*rate);song=np.zeros(samples,dtype=np.float32)
    beat=60/92;chords=[[50,57,62,66],[47,54,59,62],[43,50,55,59],[45,52,57,61]]
    for n in range(int(duration/beat)):
        if n%8 in (3,7):continue
        midi=chords[(n//8)%4][n%4]+12;frequency=440*2**((midi-69)/12)
        size=int(rate*1.25);t=np.arange(size)/rate
        envelope=(1-np.exp(-t*180))*np.exp(-t*4.2)
        wavelet=(np.sin(2*np.pi*frequency*t)+.22*np.sin(2*np.pi*frequency*2*t))*envelope*.019
        at=int(n*beat*rate);end=min(samples,at+size);song[at:end]+=wavelet[:end-at]
    fade=np.minimum(1,np.arange(samples)/(rate*2))*np.minimum(1,(samples-np.arange(samples))/(rate*2))
    stereo=np.column_stack([song*fade,song*fade*.94]);pcm=(np.clip(stereo,-1,1)*32767).astype('<i2')
    with wave.open(str(path),'wb') as wav:wav.setnchannels(2);wav.setsampwidth(2);wav.setframerate(rate);wav.writeframes(pcm.tobytes())

def filter_path(path): return str(path.resolve()).replace('\\','/').replace(':','\\:').replace("'","\\'")

def ui_card(source, target):
    background=Image.open(BASE/'graphics/09-screen.background.png').convert('RGBA')
    background.alpha_composite(Image.open(source).convert('RGBA').resize((1504,846),Image.Resampling.LANCZOS),(208,152))
    background.alpha_composite(Image.open(BASE/'graphics/09-screen.overlay.png').convert('RGBA'))
    background.save(target)

def assemble(tag, only=None, reuse=False):
    directory=BASE/tag;edit=json.loads((directory/'edit.json').read_text(encoding='utf-8'))
    clips=directory/'clips';clips.mkdir(exist_ok=True);files=[]
    for segment in edit['segments']:
        name=segment['id'];duration=segment['seconds'];raw=BASE/'capture'/segment['captureLabel']/'footage.mp4'
        if only and name not in only:continue
        overlay=BASE/'graphics'/(segment['graphic']+'.overlay.png')
        if name in ['02-agent','05-thinking','06-speech','08-basin']:
            overlay=BASE/'graphics'/(name+'.overlay.png')
        if not raw.exists():raise FileNotFoundError(raw)
        output=clips/(name+'.mp4')
        if reuse and output.exists() and output.stat().st_size>10000:
            files.append(output);print('Reused '+name,flush=True);continue
        args=['ffmpeg','-y','-hide_banner','-loglevel','error','-i',raw,'-loop','1','-i',overlay,'-i',segment['wav']]
        filters=['[0:v][1:v]overlay=0:0:shortest=1[v0]'];v='v0';a='2:a';next_input=3
        for stage in segment.get('stageOverlays',[]):
            args+=['-loop','1','-i',BASE/'graphics'/stage['file']]
            out=f'vstage{next_input}'
            filters.append(f"[{v}][{next_input}:v]overlay=0:0:enable='between(t,{stage['start']},{stage['end']})'[{out}]")
            v=out;next_input+=1
        if name=='09-desktop':
            card=directory/'chat-ui.png';ui_card(BASE/'ui/01-chat.png',card)
            args+=['-loop','1','-i',card]
            filters.append(f"[{v}][{next_input}:v]overlay=0:0:enable='between(t,0,4.5)'[vui]");v='vui';next_input+=1
        if name=='10-tuning':
            card=directory/'tuning-ui.png';ui_card(BASE/'ui/04-expression-tuning.png',card)
            args+=['-loop','1','-i',card]
            filters.append(f'[{v}][{next_input}:v]overlay=0:0:shortest=1[vbaseui]');v='vbaseui';next_input+=1
            face_at=next((c['start'] for c in segment['cues'] if '眉毛' in c['text']),duration*.48)
            ordered=directory/'tuning-ordered.mp4'
            reorder=(f'[0:v]trim=start=15:end=21,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=20,trim=duration={face_at},fps=30[body];'
                     f'[0:v]trim=start=10:end=15,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=20,trim=duration={duration-face_at},fps=30[face];'
                     '[body][face]concat=n=2:v=1:a=0[v]')
            run(['ffmpeg','-y','-hide_banner','-loglevel','error','-i',BASE/'ui/ui-walkthrough.mp4','-filter_complex',reorder,
                 '-map','[v]','-an','-c:v','libx264','-crf','18','-preset','fast','-threads','4',ordered])
            args+=['-i',ordered]
            filters.append(f'[{next_input}:v]setpts=PTS-STARTPTS,scale=1504:846,tpad=stop_mode=clone:stop_duration=10[ui]')
            filters.append(f'[{v}][ui]overlay=208:152:shortest=1[vui]');v='vui';next_input+=1
            args+=['-loop','1','-i',BASE/'graphics/09-screen.overlay.png']
            filters.append(f'[{v}][{next_input}:v]overlay=0:0:shortest=1[vframe]');v='vframe';next_input+=1
        if 'pipeAt' in segment:
            args+=['-i',ROOT/'public/audio/metal-pipe-falling.mp3']
            filters.append(f'[{next_input}:a]asplit=3[p0][p1][p2]')
            for n,offset in enumerate([0,.65,1.35]):
                delay=round((segment['pipeAt']+offset)*1000)
                trim='atrim=duration=0.62,afade=t=out:st=0.42:d=0.2,' if n<2 else ''
                filters.append(f'[p{n}]{trim}volume=.22,adelay={delay}|{delay}[pipe{n}]')
            filters.append('[2:a][pipe0][pipe1][pipe2]amix=inputs=4:duration=longest:normalize=0[voice]');a='voice'
        filters.append(f"[{v}]ass=filename='{filter_path(Path(segment['ass']))}',fps=30,format=yuv420p[vout]")
        filters.append(f'[{a}]apad,atrim=duration={duration},aresample=48000[aout]')
        args+=['-filter_complex_threads','2','-filter_complex',';'.join(filters),'-map','[vout]','-map','[aout]','-t',duration,
               '-c:v','libx264','-preset','fast','-crf','19','-threads','4','-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-movflags','+faststart',output]
        run(args);files.append(output);print('Rendered '+name,flush=True)
    if only:return
    final_duration=edit['duration']
    if tag!='draft':
        credit=BASE/'graphics/voice-final/voice-credits-final-3s.mp4'
        if not credit.exists():raise FileNotFoundError(credit)
        files.append(credit);final_duration+=3
    concat=directory/'concat.txt';concat.write_text('\n'.join("file '"+str(p.resolve()).replace('\\','/')+"'" for p in files),encoding='utf-8')
    clean=directory/'narration-cut.mp4'
    run(['ffmpeg','-y','-hide_banner','-loglevel','error','-f','concat','-safe','0','-i',concat,'-c','copy',clean])
    music=directory/'original-mallet-score.wav';score(music,final_duration)
    output=directory/('大肥鱼_介绍视频_'+('初剪' if tag=='draft' else '成片')+'.mp4')
    titles=dict(zip(['01-intro','02-agent','03-faces','04-arms','05-thinking','06-speech','07-pet','08-basin','09-desktop','10-tuning','11-watch','12-install','13-outro'],
                    ['认识大肥鱼','连接智能体','表情与语气','左右手势','思考与衔接','实际语音口型','持续摸头','敲盆与钢管音效','日常桌面操作','客制化调节','浏览器一起看','安装与开始使用','角色与模型署名']))
    metadata=directory/'chapters.ffmetadata';chapter_lines=[';FFMETADATA1'];plain=[]
    for i,segment in enumerate(edit['segments']):
        start=round(segment['offset']*1000);end=round((segment['offset']+segment['seconds'])*1000)
        title=segment.get('chapterTitle',titles.get(segment['id'],segment['id']))
        chapter_lines+=['[CHAPTER]','TIMEBASE=1/1000',f'START={start}',f'END={end}','title='+title]
        plain.append(stamp(segment['offset']).split(',')[0]+' '+title)
    if tag!='draft':
        chapter_lines+=['[CHAPTER]','TIMEBASE=1/1000',f"START={round(edit['duration']*1000)}",f'END={round(final_duration*1000)}','title=AI配音模型来源']
    metadata.write_text('\n'.join(chapter_lines)+'\n',encoding='utf-8');(directory/'chapters.txt').write_text('\n'.join(plain)+'\n',encoding='utf-8')
    run(['ffmpeg','-y','-hide_banner','-loglevel','error','-i',clean,'-i',music,'-f','ffmetadata','-i',metadata,'-filter_complex',
         '[0:a][1:a]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.89,afade=t=out:st='+str(final_duration-1.5)+':d=1.5[a]',
         '-map','0:v','-map','[a]','-map_metadata','2','-map_chapters','2','-c:v','copy','-c:a','aac','-b:a','192k','-movflags','+faststart',
         '-metadata','title='+edit['title'],'-metadata','comment=AI synthetic narration; scripted demonstration of the real Live2D runtime.',output])
    first=edit['segments'][0]
    run(['ffmpeg','-y','-hide_banner','-loglevel','error','-ss',str(min(8,first['seconds']*.65)),
         '-i',BASE/'capture'/first['captureLabel']/'footage.mp4','-i',BASE/'graphics/01-intro.overlay.png',
         '-filter_complex','[0:v][1:v]overlay=0:0','-frames:v','1',directory/'cover.png'])
    print(json.dumps({'video':str(output),'subtitles':str(directory/'captions.srt'),'seconds':final_duration},ensure_ascii=False),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--tag',default='draft');parser.add_argument('--prepare',action='store_true');parser.add_argument('--assemble',action='store_true')
    parser.add_argument('--voice-manifest',type=Path,default=BASE/'narration-draft/manifest.json');parser.add_argument('--only',nargs='+');parser.add_argument('--reuse',action='store_true');args=parser.parse_args()
    if not re.fullmatch('[a-z0-9-]+',args.tag):raise ValueError('Invalid output tag')
    if args.prepare:prepare(args.tag,args.voice_manifest.resolve())
    if args.assemble:assemble(args.tag,args.only,args.reuse)
