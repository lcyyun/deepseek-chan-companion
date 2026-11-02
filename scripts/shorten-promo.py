"""Re-edit existing approved footage into a two-minute introduction.

Requires ffmpeg/ffprobe and Pillow. No model calls, live app changes, or new
voice inference. --project points to the original output/video014 directory.
The original final-v3 and all source media remain untouched.
"""
from __future__ import annotations
import argparse, concurrent.futures, importlib.util, json, math, shutil, subprocess, wave
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

FPS = 30
ROOT = Path(__file__).resolve().parents[1]
FONT = 'C:/Windows/Fonts/msyh.ttc'
BOLD = 'C:/Windows/Fonts/msyhbd.ttc'

def run(args):
    result = subprocess.run([str(a) for a in args], capture_output=True, text=True, encoding='utf-8', errors='replace')
    if result.returncode:
        raise RuntimeError(result.stderr[-6000:])
    return result.stdout

def stamp(seconds, ass=False):
    scale = 100 if ass else 1000
    tick = round(max(0, seconds) * scale)
    h, tick = divmod(tick, 3600 * scale)
    m, tick = divmod(tick, 60 * scale)
    s, tick = divmod(tick, scale)
    return f'{h}:{m:02}:{s:02}.{tick:02}' if ass else f'{h:02}:{m:02}:{s:02},{tick:03}'

def fpath(path):
    return str(path.resolve()).replace('\\', '/').replace(':', '\\:').replace("'", "\\'")

def json_write(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')

def narration_cues(segment, start, end, offset=0):
    return [dict(text=c['text'], start=max(c['start'], start)-start+offset,
                 end=min(c['end'], end)-start+offset)
            for c in segment['cues'] if c['end'] > start and c['start'] < end]

ASS_HEADER = '''[Script Info]
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

def ass_write(path, cues):
    path.write_text(ASS_HEADER + '\n'.join(
        f"Dialogue: 0,{stamp(c['start'], True)},{stamp(c['end'], True)},Default,,0,0,0,,{c['text']}"
        for c in cues) + '\n', encoding='utf-8-sig')

def credits_card(base, out):
    # Extend the existing code-native title-card style, with both sets of credits.
    card = Image.open(base/'graphics/10-outro.background.png').convert('RGB')
    d = ImageDraw.Draw(card)
    def text(x, y, value, size=30, bold=False, color='#c1d8e7'):
        d.text((x,y), value, font=ImageFont.truetype(BOLD if bold else FONT, size), fill=color)
    text(112, 62, '大肥鱼  /  DEEPSEEK-CHAN', 28, True, '#f1f8fc')
    text(112, 193, '回桌面，摸个头。', 91, True, '#f1f8fc')
    text(120, 328, '安装与详细用法，交给你的智能体按项目说明完成。', 32)
    d.line((112,414,1808,414), fill='#356581', width=2)
    text(120, 455, '模型与角色', 27, True, '#41c4d8')
    text(1000, 455, '视频配音', 27, True, '#41c4d8')
    for y, value in [(516,'原画及拆分：神宫凉子'),(577,'Live2D 建模：霓虹猫_NeonNeko'),(638,'来源：神宫凉子免费配布模型')]:
        text(120, y, value, 30)
    for y, value in [(516,'诗歌剧 / 曼波 · AI 合成配音'),(577,'模型分享：顾不快付通'),(638,'GPT-SoVITS · BV1fobL6nEjG')]:
        text(1000, y, value, 29)
    text(120, 757, '模型与程序分别获取 · 应用默认声音为晓伊', 29)
    d.line((112,985,1808,985), fill='#356581', width=1)
    text(112, 1005, '真实模型 · 脚本演示 · 菜单段为操作示意', 23)
    card.save(out/'credits.png')

def basin_assets(base, out):
    # Original local metal synthesis, rather than the old third-party pipe sample.
    module_path = ROOT/'src/shared/basin-sound.mjs'
    script = "import {writeFileSync} from 'node:fs'; import {synthesizeBasinTap} from " + json.dumps(module_path.as_uri()) + "; const a=synthesizeBasinTap(48000);writeFileSync(process.argv[1],Buffer.from(a.buffer));"
    run(['node', '--input-type=module', '-e', script, out/'basin.f32'])
    run(['ffmpeg','-y','-hide_banner','-loglevel','error','-f','f32le','-ar','48000','-ac','1','-i',out/'basin.f32',out/'basin.wav'])
    # Use the existing layout generator for this replacement feature card.
    helper = base.parents[1]/'scripts/video-graphics.py'
    spec = importlib.util.spec_from_file_location('promo_graphics', helper)
    graphics = importlib.util.module_from_spec(spec); spec.loader.exec_module(graphics)
    graphics.render(dict(id='basin',type='feature',kicker='DESKTOP PERCUSSION',
        title=['今天的乐器','是一只铁盆'],
        bullets=['点击与连击，即时响应','圈圈眼、耳朵弹动、身体轻颤','动作与声音，一起回应']),out)

def build(base, out, workers=2):
    if out.exists(): raise FileExistsError(f'Choose a fresh output directory: {out}')
    out.mkdir(parents=True)
    (out/'clips').mkdir(); (out/'subtitles').mkdir(); (out/'qa').mkdir()
    source = base/'final-v3'
    old = json.loads((source/'edit.json').read_text(encoding='utf-8-sig'))
    segments = {s['id']:s for s in old['segments']}
    # Times refer to individual source clips. Sentence boundaries were checked.
    cuts = [
        ('opener','02-agent',.12,9.15,'给智能体一个桌面身体','opener'),
        ('faces','03-faces',2.60,9.85,'表情有语气','normal'),
        ('arms','04-arms',5.40,10.90,'表情与肢体独立','normal'),
        ('thinking','05-thinking',.12,12.67,'思考与动作承接','normal'),
        ('speech','06-speech',.10,8.97,'听一段：语音、口型与手势','normal'),
        ('pet','07-pet',.10,9.60,'摸头与本地互动','normal'),
        ('easter','07b-easter-egg',.12,7.17,'轻点彩蛋','normal'),
        ('basin','08-basin',.10,5.70,'敲盆','basin'),
        ('desktop','09-desktop',.12,9.20,'悬浮球与摆放','normal'),
        ('menu','09b-quick-menu',2.64,14.16,'隐藏、显示与退出','normal'),
        ('tuning','10-tuning',.12,11.30,'调成喜欢的样子','normal'),
        ('watch','11-watch',.13,9.15,'浏览器一起看','normal'),
        ('install','12-install',.12,7.94,'安装交给自己的智能体','normal'),
        ('credits','13-outro',7.60,10.14,'回桌面，摸个头','credits'),
    ]
    timeline=[]; all_cues=[]; cursor=0
    for key, sid, start, end, title, kind in cuts:
        frames=round((6.8 if kind=='basin' else 6 if kind=='credits' else end-start)*FPS)
        duration=frames/FPS
        cues=narration_cues(segments[sid],start,end)
        ass=out/'subtitles'/f'{key}.ass'; ass_write(ass,cues)
        item=dict(id=key,sourceId=sid,sourceStart=start,sourceEnd=end,kind=kind,title=title,
                  offset=cursor,duration=duration,frames=frames,ass=str(ass),cues=cues)
        timeline.append(item)
        all_cues.extend({**c,'start':c['start']+cursor,'end':c['end']+cursor} for c in cues)
        cursor+=duration
    assert 115 <= cursor <= 125, cursor
    credits_card(base,out); basin_assets(base,out)
    json_write(out/'edit.json',dict(title='大肥鱼 · 两分钟介绍',source=str(source),
        duration=cursor,voice='Original Shigeju/Manbo narration; no speed changes',
        demonstration='Real model with scripted behavior; menu is labeled illustration',
        segments=timeline))
    (out/'captions.srt').write_text('\n\n'.join(
        f"{i+1}\n{stamp(c['start'])} --> {stamp(c['end'])}\n{c['text']}"
        for i,c in enumerate(all_cues))+'\n',encoding='utf-8-sig')
    (out/'script.txt').write_text('\n\n'.join(stamp(t['offset']).split(',')[0]+' '+t['title']+'\n'+'\n'.join(c['text'] for c in t['cues']) for t in timeline),encoding='utf-8')
    print(f'Timeline: {cursor:.3f}s, {len(timeline)} parts',flush=True)

    def render(t):
        s=segments[t['sourceId']]; start=t['sourceStart']; take=t['sourceEnd']-start
        args=['ffmpeg','-y','-hide_banner','-loglevel','error']
        filters=[]
        if t['kind']=='opener':
            raw=base/'capture'/segments['01-intro']['captureLabel']/'footage.mp4'
            args+=['-ss','1.90','-i',raw,'-loop','1','-i',base/'graphics/01-intro.overlay.png','-ss',start,'-i',s['wav']]
            filters += [f"[0:v][1:v]overlay=0:0:shortest=1,ass=filename='{fpath(Path(t['ass']))}'[v0]"]
            audio='2:a'
        elif t['kind']=='basin':
            raw=base/'capture'/s['captureLabel']/'footage.mp4'
            args+=['-i',raw,'-loop','1','-i',out/'basin.overlay.png','-ss',start,'-i',s['wav'],'-i',out/'basin.wav']
            filters += ['[0:v]split=2[hat][hit]',
                '[hat]trim=start=0.10:end=2.40,setpts=PTS-STARTPTS[h]',
                '[hit]trim=start=8.15:end=12.65,setpts=PTS-STARTPTS[k]',
                '[h][k]concat=n=2:v=1:a=0[b]',
                f"[b][1:v]overlay=0:0:shortest=1,ass=filename='{fpath(Path(t['ass']))}'[v0]",
                '[3:a]asplit=3[t0][t1][t2]']
            for i, delay in enumerate([2623,3273,3973]):
                filters.append(f'[t{i}]volume=0.30,adelay={delay}:all=1[tap{i}]')
            filters += [f'[2:a]atrim=duration={take},asetpts=PTS-STARTPTS,apad,atrim=duration={t["duration"]}[narration]',
                '[narration][tap0][tap1][tap2]amix=inputs=4:duration=first:normalize=0[metal]']
            audio='metal';take=t['duration']
        elif t['kind']=='credits':
            args+=['-loop','1','-i',out/'credits.png','-ss',start,'-i',s['wav']]
            filters += [f"[0:v]ass=filename='{fpath(Path(t['ass']))}'[v0]"]
            audio='1:a'
        else:
            args+=['-ss',start,'-i',source/'clips'/f"{s['id']}.mp4",'-ss',start,'-i',s['wav']]
            filters+=['[0:v]setpts=PTS-STARTPTS[v0]'];audio='1:a'
        filters += ['[v0]fps=30,format=yuv420p[v]',
            f'[{audio}]atrim=duration={take},asetpts=PTS-STARTPTS,afade=t=in:d=0.008,afade=t=out:st={max(0,take-.012)}:d=0.012,apad,atrim=duration={t["duration"]},aresample=48000[a]']
        output=out/'clips'/f"{t['id']}.mkv"
        args+=['-filter_complex_threads','1','-filter_complex',';'.join(filters),'-map','[v]','-map','[a]',
               '-t',t['duration'],'-c:v','libx264','-preset','fast','-crf','18','-threads','2',
               '-c:a','pcm_s16le','-ar','48000','-ac','2',output]
        run(args)
        print('Rendered '+t['id'],flush=True)
        return output

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        files=list(pool.map(render,timeline))
    concat=out/'concat.txt'
    concat.write_text('\n'.join("file '"+str(p.resolve()).replace('\\','/')+"'" for p in files)+'\n',encoding='utf-8')
    chapters=out/'chapters.ffmetadata'; lines=[';FFMETADATA1']; plain=[]
    chapter_keys={'opener','faces','pet','desktop','watch','install','credits'}
    chapter_items=[t for t in timeline if t['id'] in chapter_keys]
    for i,t in enumerate(chapter_items):
        stop=chapter_items[i+1]['offset'] if i+1<len(chapter_items) else cursor
        lines+=['[CHAPTER]','TIMEBASE=1/1000',f"START={round(t['offset']*1000)}",f'END={round(stop*1000)}','title='+t['title']]
        plain.append(stamp(t['offset']).split(',')[0]+' '+t['title'])
    chapters.write_text('\n'.join(lines)+'\n',encoding='utf-8')
    (out/'chapters.txt').write_text('\n'.join(plain)+'\n',encoding='utf-8')
    final=out/'大肥鱼_两分钟介绍.mp4'
    music=source/'original-mallet-score.wav'
    run(['ffmpeg','-y','-hide_banner','-loglevel','error','-f','concat','-safe','0','-i',concat,
        '-i',music,'-f','ffmetadata','-i',chapters,
        '-filter_complex',f'[0:a][1:a]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.84,afade=t=in:d=0.08,afade=t=out:st={cursor-1.4}:d=1.4[a]',
        '-map','0:v','-map','[a]','-map_metadata','2','-map_chapters','2','-t',cursor,
        '-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-movflags','+faststart',
        '-metadata','title=大肥鱼｜给智能体一个桌面身体',
        '-metadata','comment=Real Live2D runtime; scripted demo; AI synthesized narration; menu illustration labeled.',final])
    shutil.copy2(source/'cover.png',out/'cover.png')
    print(json.dumps(dict(video=str(final),seconds=cursor,subtitle=str(out/'captions.srt')),ensure_ascii=False),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--project',required=True,type=Path)
    parser.add_argument('--out',type=Path)
    parser.add_argument('--workers',type=int,default=2,choices=[1,2,3])
    args=parser.parse_args()
    base=args.project.resolve();out=args.out.resolve() if args.out else base/'final-v4-2min'
    build(base,out,args.workers)
