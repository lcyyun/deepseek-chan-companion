"""Rebuild the approved two-minute promo from fresh native-resolution footage.

--prepare writes capture jobs and clean, code-native cards. --assemble consumes
the new lossless captures and UI assets, then encodes video exactly once. The
approved Shigeju/Manbo + pipe soundtrack is stream-copied and hash-checked.
Original project files are read-only; all outputs live in the chosen fresh root.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import copy
import importlib.util
import json
import math
import re
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
FPS, WIDTH, HEIGHT = 30, 1920, 1080
FONT = 'C:/Windows/Fonts/msyh.ttc'
BOLD = 'C:/Windows/Fonts/msyhbd.ttc'
FINAL_NAME = '大肥鱼_两分钟介绍_1080p高清版.mp4'
OLD_NAME = '大肥鱼_两分钟介绍_钢管音效版.mp4'
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


def run(args):
    result = subprocess.run([str(value) for value in args], capture_output=True,
                            text=True, encoding='utf-8', errors='replace')
    if result.returncode:
        raise RuntimeError(result.stderr[-8000:])
    return result.stdout


def load(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')


def filter_path(path):
    return str(path.resolve()).replace('\\', '/').replace(':', '\\:').replace("'", "\\'")


def ass_stamp(seconds):
    ticks = round(seconds * 100)
    h, ticks = divmod(ticks, 360000)
    m, ticks = divmod(ticks, 6000)
    s, ticks = divmod(ticks, 100)
    return f'{h}:{m:02}:{s:02}.{ticks:02}'


def parse_srt(path):
    result = []
    def seconds(value):
        h, m, s, ms = map(int, re.split('[:,]', value))
        return h * 3600 + m * 60 + s + ms / 1000
    for block in re.split(r'\r?\n\s*\r?\n', path.read_text(encoding='utf-8-sig').strip()):
        lines = block.splitlines()
        if len(lines) < 3:
            continue
        start, end = lines[1].split(' --> ')
        result.append(dict(start=seconds(start), end=seconds(end), text='\n'.join(lines[2:])))
    return result


def create_cards(out):
    """Render new typography on a clean generated background, not over old text."""
    spec = importlib.util.spec_from_file_location('promo_hd_graphics', ROOT / 'scripts/video-graphics.py')
    graphics = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(graphics)
    target = out / 'graphics'
    target.mkdir(parents=True, exist_ok=True)

    def blank():
        image = graphics.decoration(graphics.gradient_background(True), True)
        return image, ImageDraw.Draw(image)

    def text(draw, xy, value, size, bold=False, color='#d0e3ee'):
        draw.text(xy, value, font=ImageFont.truetype(BOLD if bold else FONT, size), fill=color)

    image, draw = blank()
    text(draw, (112, 61), '大肥鱼  /  DEEPSEEK-CHAN', 28, True, '#f1f8fc')
    text(draw, (112, 168), '先选版本，再交给你的智能体', 66, True, '#f1f8fc')
    text(draw, (117, 265), 'GitHub Releases  ·  v0.24.0', 32, False, '#53c4d5')
    for x, title, file_tag, line1, line2 in [
        (112, '日常使用', 'user  ·  用户纯净版', '固定高清，保留完整日常功能', '完整解压后，选择本地模型'),
        (992, '想让智能体魔改', 'developer  ·  开发版', '附源码、测试与调试工具', '和日常版本分开使用'),
    ]:
        draw.rounded_rectangle((x, 350, x + 816, 708), radius=28,
                               fill=(30, 56, 78, 255), outline=(68, 125, 151, 255), width=2)
        text(draw, (x + 36, 390), title, 35, True, '#53c4d5')
        text(draw, (x + 36, 459), file_tag, 48, True, '#f1f8fc')
        text(draw, (x + 36, 556), line1, 32)
        text(draw, (x + 36, 615), line2, 30)
    text(draw, (120, 767), '模型单独获取  ·  再连接对话与语音服务', 36, True)
    text(draw, (120, 828), 'github.com/lcyyun/deepseek-chan-companion', 31)
    draw.line((112, 985, 1808, 985), fill='#356581', width=1)
    text(draw, (112, 1005), '项目说明与安装指南  /  两版均可连接自己的智能体', 23)
    image.convert('RGB').save(target / 'install.png')

    image, draw = blank()
    text(draw, (112, 61), '大肥鱼  /  DEEPSEEK-CHAN', 28, True, '#f1f8fc')
    text(draw, (112, 193), '回桌面，摸个头。', 91, True, '#f1f8fc')
    text(draw, (120, 328), '使用说明与开发源码，交给你的智能体继续探索。', 32)
    draw.line((112, 414, 1808, 414), fill='#356581', width=2)
    text(draw, (120, 455), '模型与角色', 27, True, '#41c4d8')
    text(draw, (1000, 455), '视频配音', 27, True, '#41c4d8')
    for y, value in [(516, '原画及拆分：神宫凉子'), (577, 'Live2D 建模：霓虹猫_NeonNeko'),
                     (638, '来源：神宫凉子免费配布模型')]:
        text(draw, (120, y), value, 30)
    for y, value in [(516, '诗歌剧 / 曼波 · AI 合成配音'), (577, '模型分享：顾不快付通'),
                     (638, 'GPT-SoVITS · BV1fobL6nEjG')]:
        text(draw, (1000, y), value, 29)
    text(draw, (120, 757), '模型与程序分别获取 · 应用默认声音为晓伊', 29)
    draw.line((112, 985, 1808, 985), fill='#356581', width=1)
    text(draw, (112, 1005), '真实模型 · 脚本演示 · 菜单段为操作示意', 23)
    image.convert('RGB').save(target / 'credits.png')


def prepare(base, out):
    if base == out or base in out.parents:
        raise ValueError('Choose a separate output root; original project is read-only.')
    for name in ['capture', 'ui', 'graphics', 'final/clips', 'final/qa']:
        (out / name).mkdir(parents=True, exist_ok=True)
    original = load(base / 'final-v3/edit.json')
    short = load(base / 'final-v4-2min-pipe/edit.json')
    old_by_id = {s['id']: s for s in original['segments']}
    source_jobs = {j['label']: j for p in ['capture-jobs-final.json', 'capture-jobs-easter.json']
                   for j in load(base / p)}
    overrides = {'thinking': '05-thinking', 'speech': '06-speech'}
    timeline, required = [], {}
    cursor = 0
    for source in short['segments']:
        item = copy.deepcopy(source)
        old = old_by_id[item['sourceId']]
        item['offsetFrames'] = cursor
        item['offset'] = cursor / FPS
        item['frames'] = round(item['duration'] * FPS)
        item['duration'] = item['frames'] / FPS
        item['sourceSeconds'] = old['seconds']
        item['captureLabel'] = old['captureLabel']
        item['overlay'] = str(base / 'graphics' / (overrides.get(item['id'], old['graphic']) + '.overlay.png'))
        item['stageOverlays'] = old.get('stageOverlays', [])
        if item['id'] == 'opener':
            item['captureLabel'] = old_by_id['01-intro']['captureLabel']
            item['videoStart'] = 1.9
            item['overlay'] = str(base / 'graphics/01-intro.overlay.png')
        else:
            item['videoStart'] = item['sourceStart']
        if item['id'] == 'basin':
            item['videoSlices'] = [[.1, 2.4], [8.15, 12.65]]
            item['overlay'] = str(base / 'final-v4-2min/basin.overlay.png')
        if item['id'] == 'pet':
            item['captureFile'] = str(out / 'capture-pet-sync' / item['captureLabel'] / 'footage.mkv')
            item['petEnd'] = next(c['start'] for c in old['cues'] if '松手以后' in c['text'])
            item['visualTimingNote'] = 'Release the held petting contact at the approved narration cue; preserve old audio and edit duration.'
        if item['id'] == 'menu':
            item['menuScreens'] = [{**s, 'file': str(out / 'ui' / Path(s['file']).name)} for s in old['menuScreens']]
        if item['id'] not in ['menu', 'tuning', 'install', 'credits']:
            item['sourceSeconds'] = source_jobs[item['captureLabel']]['seconds']
            end = max(p[1] for p in item['videoSlices']) if item.get('videoSlices') else item['videoStart'] + item['duration']
            required[item['captureLabel']] = max(required.get(item['captureLabel'], 0), end + .2)
        timeline.append(item)
        cursor += item['frames']
    assert cursor == 3636, cursor
    jobs, pet_jobs = [], []
    for label, end in required.items():
        job = copy.deepcopy(source_jobs[label])
        job['sceneSeconds'] = job['seconds']
        job['seconds'] = math.ceil(end * FPS) / FPS
        if job['scene'] == 'pet' and 'events' not in job:
            job['events'] = [[0, 'pet-start'], [max(5, job['sceneSeconds'] - 2.5), 'pet-end']]
        if job['scene'] == 'pet':
            pet_item = next(t for t in timeline if t['id'] == 'pet')
            job['petEnd'] = pet_item['petEnd']
            job['sceneSeconds'] = job['petEnd'] + 2.5
            job['events'] = [[0, 'pet-start'], [job['petEnd'], 'pet-end']]
            pet_jobs.append(job)
        else:
            jobs.append(job)
    save(out / 'capture-jobs.json', jobs)
    save(out / 'capture-jobs-pet-sync.json', pet_jobs)
    save(out / 'edit.json', dict(title='大肥鱼 · 两分钟介绍 · 1080p 高清版',
        width=WIDTH, height=HEIGHT, fps=FPS, frames=cursor, duration=cursor / FPS,
        sourceProject=str(base), sourceAudio=str(base / 'final-v4-2min-pipe' / OLD_NAME),
        visualPolicy='Fresh high-resolution model/UI captures; no old encoded video clips; subtitles burned once.',
        audioPolicy='Stream-copy the approved AAC soundtrack, including narration, music, and pipe effects.',
        segments=timeline))
    final = out / 'final'
    for name in ['captions.srt', 'chapters.txt', 'chapters.ffmetadata', 'script.txt']:
        shutil.copy2(base / 'final-v4-2min-pipe' / name, final / name)
    cues = parse_srt(final / 'captions.srt')
    assert len(cues) == 37 and all(0 <= c['start'] < c['end'] <= cursor / FPS for c in cues)
    final.joinpath('captions.ass').write_text(ASS_HEADER + '\n'.join(
        f"Dialogue: 0,{ass_stamp(c['start'])},{ass_stamp(c['end'])},Default,,0,0,0,,"
        + c['text'].replace('\n', r'\N') for c in cues) + '\n', encoding='utf-8-sig')
    create_cards(out)
    print(json.dumps(dict(jobs=str(out / 'capture-jobs.json'), count=len(jobs),
                          petSyncJobs=str(out / 'capture-jobs-pet-sync.json'),
                          sourceSeconds=sum(j['seconds'] for j in jobs + pet_jobs), frames=cursor, duration=cursor / FPS), ensure_ascii=False), flush=True)


def image_input(args, path, expected=None):
    if not path.is_file():
        raise FileNotFoundError(path)
    if expected:
        with Image.open(path) as im:
            if im.size != expected:
                raise ValueError(f'{path.name}: expected {expected}, got {im.size}; render at target size instead of enlarging.')
    args.extend(['-loop', '1', '-framerate', str(FPS), '-i', path])


def assemble(base, out, workers=2):
    edit = load(out / 'edit.json')
    final = out / 'final'
    destination = final / FINAL_NAME
    if destination.exists():
        raise FileExistsError(f'Finished output already exists; retain it and choose a fresh output root: {destination}')
    source_audio = Path(edit['sourceAudio'])
    if not source_audio.is_file():
        raise FileNotFoundError(source_audio)

    def render(item):
        key, count = item['id'], item['frames']
        args = ['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error']
        filters = []
        if key in ['install', 'credits']:
            image_input(args, out / 'graphics' / f'{key}.png', (WIDTH, HEIGHT))
            video = '0:v'
        elif key == 'tuning':
            image_input(args, base / 'graphics/09-screen.background.png', (WIDTH, HEIGHT))
            footage = out / 'ui/tuning.mkv'
            if not footage.is_file():
                raise FileNotFoundError(footage)
            args += ['-i', footage]
            image_input(args, base / 'graphics/09-screen.overlay.png', (WIDTH, HEIGHT))
            filters += ['[1:v]setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=1[ui]',
                        '[0:v][ui]overlay=208:152:shortest=1:format=rgb[screen]',
                        '[screen][2:v]overlay=0:0:shortest=1:format=rgb[composed]']
            video = 'composed'
        elif key == 'menu':
            image_input(args, base / 'graphics/09b-quick-menu.background.png', (WIDTH, HEIGHT))
            video, n = '0:v', 1
            for panel in item['menuScreens']:
                image_input(args, Path(panel['file']), (960, 540))
                start, end = max(0, panel['start'] - item['sourceStart']), min(item['duration'], panel['end'] - item['sourceStart'])
                filters.append(f"[{video}][{n}:v]overlay=840:270:format=rgb:enable='gte(t,{start})*lt(t,{end})'[menu{n}]")
                video = f'menu{n}'
                n += 1
            image_input(args, Path(item['overlay']), (WIDTH, HEIGHT))
            filters.append(f'[{video}][{n}:v]overlay=0:0:shortest=1:format=rgb[menuover]')
            video, n = 'menuover', n + 1
            for stage in item['stageOverlays']:
                image_input(args, base / 'graphics' / stage['file'], (WIDTH, HEIGHT))
                start, end = max(0, stage['start'] - item['sourceStart']), min(item['duration'], stage['end'] - item['sourceStart'])
                filters.append(f"[{video}][{n}:v]overlay=0:0:format=rgb:enable='between(t,{start},{end})'[stage{n}]")
                video = f'stage{n}'
                n += 1
        else:
            footage = Path(item['captureFile']) if item.get('captureFile') else out / 'capture' / item['captureLabel'] / 'footage.mkv'
            if not footage.is_file():
                raise FileNotFoundError(footage)
            args += ['-i', footage]
            if key == 'basin':
                filters += ['[0:v]split=2[hat][hit]', '[hat]trim=start=0.1:end=2.4,setpts=PTS-STARTPTS[h]',
                            '[hit]trim=start=8.15:end=12.65,setpts=PTS-STARTPTS[k]', '[h][k]concat=n=2:v=1:a=0[raw]']
            else:
                filters.append(f"[0:v]trim=start={item['videoStart']}:duration={item['duration']},setpts=PTS-STARTPTS[raw]")
            image_input(args, Path(item['overlay']), (WIDTH, HEIGHT))
            filters.append('[raw][1:v]overlay=0:0:shortest=1:format=rgb[composed]')
            video, n = 'composed', 2
            if key == 'desktop':
                image_input(args, base / 'graphics/09-screen.background.png', (WIDTH, HEIGHT))
                image_input(args, out / 'ui/chat.png', (1504, 846))
                image_input(args, base / 'graphics/09-screen.overlay.png', (WIDTH, HEIGHT))
                filters += ['[2:v][3:v]overlay=208:152:shortest=1:format=rgb[chatbg]',
                            '[chatbg][4:v]overlay=0:0:shortest=1:format=rgb[chatcard]',
                            f"[{video}][chatcard]overlay=0:0:format=rgb:enable='lt(t,{4.5-item['sourceStart']})'[desktop]"]
                video, n = 'desktop', 5
            for stage in item['stageOverlays']:
                start, end = max(0, stage['start'] - item['sourceStart']), min(item['duration'], stage['end'] - item['sourceStart'])
                if end <= start:
                    continue
                image_input(args, base / 'graphics' / stage['file'], (WIDTH, HEIGHT))
                filters.append(f"[{video}][{n}:v]overlay=0:0:format=rgb:enable='between(t,{start},{end})'[stage{n}]")
                video = f'stage{n}'
                n += 1
        filters.append(f'[{video}]fps={FPS},tpad=stop_mode=clone:stop_duration=1,setsar=1,format=bgr0[v]')
        clip = final / 'clips' / f'{key}.mkv'
        args += ['-filter_complex_threads', '1', '-filter_complex', ';'.join(filters), '-map', '[v]', '-an',
                 '-frames:v', str(count), '-c:v', 'ffv1', '-level', '3', '-threads', '2', '-pix_fmt', 'bgr0', clip]
        run(args)
        print(f'Rendered lossless {key}: {count} frames', flush=True)
        return clip

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        clips = list(pool.map(render, edit['segments']))
    concat = final / 'concat.txt'
    concat.write_text('\n'.join("file '" + str(p.resolve()).replace('\\', '/') + "'" for p in clips) + '\n', encoding='utf-8')
    ass = filter_path(final / 'captions.ass')
    run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', concat,
         '-i', source_audio, '-f', 'ffmetadata', '-i', final / 'chapters.ffmetadata',
         '-map', '0:v:0', '-map', '1:a:0', '-map_metadata', '2', '-map_chapters', '2',
         '-vf', f"settb=1/30000,setpts=N*1000,ass=filename='{ass}',scale=iw:ih:in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p",
         '-frames:v', str(edit['frames']), '-r', str(FPS), '-fps_mode', 'cfr', '-t', str(edit['duration']),
         '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-profile:v', 'high', '-level:v', '4.1',
         '-threads', '4', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709',
         '-color_trc', 'bt709', '-color_primaries', 'bt709', '-video_track_timescale', '30000', '-c:a', 'copy',
         '-bsf:v', 'h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0', '-movflags', '+faststart',
         '-metadata', 'title=大肥鱼｜两分钟介绍 · 1080p 高清版',
         '-metadata', 'comment=Native high-resolution Live2D and UI captures; scripted demonstration; original approved AI narration and pipe soundtrack retained.', destination])
    probe = json.loads(run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-show_chapters', '-of', 'json', destination]))
    video = next(s for s in probe['streams'] if s['codec_type'] == 'video')
    audio_hash = lambda p: run(['ffmpeg', '-v', 'error', '-i', p, '-map', '0:a:0', '-c', 'copy', '-f', 'streamhash', '-hash', 'SHA256', '-']).strip()
    old_hash, new_hash = audio_hash(source_audio), audio_hash(destination)
    run(['ffmpeg', '-v', 'error', '-i', destination, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-'])
    cues = parse_srt(final / 'captions.srt')
    validation = dict(width=video['width'], height=video['height'], fps=video['avg_frame_rate'],
        frames=int(video['nb_frames']), duration=float(probe['format']['duration']),
        colorSpace=video.get('color_space'), colorPrimaries=video.get('color_primaries'),
        colorTransfer=video.get('color_transfer'), colorRange=video.get('color_range'),
        audioStreamCopied=old_hash == new_hash, originalAudioHash=old_hash, outputAudioHash=new_hash,
        subtitleCues=len(cues), subtitleEnd=max(c['end'] for c in cues), chapters=len(probe['chapters']),
        subtitlesBurnedOnce=True, fullDecodePassed=True, intermediates='FFV1 lossless; no previous finished-video picture reused',
        output=str(destination))
    save(final / 'qa/validation.json', validation)
    assert (video['width'], video['height'], video['avg_frame_rate'], int(video['nb_frames'])) == (1920, 1080, '30/1', 3636), validation
    assert abs(float(probe['format']['duration']) - 121.2) < .035, validation
    assert (video.get('color_space'), video.get('color_primaries'), video.get('color_transfer'), video.get('color_range')) == ('bt709', 'bt709', 'bt709', 'tv'), validation
    assert old_hash == new_hash and len(cues) == 37 and len(probe['chapters']) == 7, validation
    assert max(c['end'] for c in cues) <= 121.2, validation
    # This is a newly rendered frame from the new master, not the old cover.
    run(['ffmpeg', '-y', '-v', 'error', '-ss', '4', '-i', destination, '-frames:v', '1', final / 'cover.png'])
    shutil.copy2(out / 'edit.json', final / 'edit.json')
    print(json.dumps(validation, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--project', type=Path, required=True)
    parser.add_argument('--out', type=Path, default=ROOT / 'output/video1080')
    parser.add_argument('--prepare', action='store_true')
    parser.add_argument('--assemble', action='store_true')
    parser.add_argument('--workers', type=int, default=2, choices=[1, 2, 3])
    args = parser.parse_args()
    if not args.prepare and not args.assemble:
        parser.error('Choose --prepare and/or --assemble')
    base, out = args.project.resolve(), args.out.resolve()
    if args.prepare:
        prepare(base, out)
    if args.assemble:
        assemble(base, out, args.workers)
