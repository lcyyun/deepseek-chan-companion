"""Append labeled floating-ball operation illustrations to the easter-egg cut.

Inputs: final-v2/edit.json, narration-menu/manifest.json and menu-ui captures.
Output: final-v3, retaining both earlier finished cuts.
"""
import copy
import importlib.util
import json
import math
from pathlib import Path
import shutil
import wave
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'output/video014'
spec = importlib.util.spec_from_file_location('promo', ROOT / 'scripts/assemble-promo.py')
promo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(promo)

def main():
    voice = json.loads((BASE / 'narration-menu/manifest.json').read_text(encoding='utf-8'))['segments'][0]
    original = json.loads((BASE / 'final-v2/edit.json').read_text(encoding='utf-8'))
    directory = BASE / 'final-v3'
    for folder in ['', 'audio', 'subtitles', 'clips']:
        (directory / folder).mkdir(parents=True, exist_ok=True)
    with wave.open(voice['wav'], 'rb') as source:
        assert source.getnchannels() == 1 and source.getsampwidth() == 2
        rate = source.getframerate()
        data = source.readframes(source.getnframes())
    lead = .22
    data = b'\0' * (round(lead * rate) * 2) + data
    boundaries = copy.deepcopy(voice['boundaries'])
    for boundary in boundaries:
        boundary['start'] += lead
    audio = directory / 'audio/09b-quick-menu.wav'
    with wave.open(str(audio), 'wb') as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(rate)
        target.writeframes(data)
    duration = len(data) / 2 / rate
    seconds = math.ceil((duration + .9) * 30) / 30
    at = lambda phrase, fallback: promo.spoken_at({'boundaries': boundaries}, phrase, fallback)
    opened = at('右键一下', 2.7)
    hidden = at('临时隐藏', 5)
    restored = at('再把她叫回来', 7)
    exit_menu = at('想彻底收工', 8.55)
    closed = at('角色、', 11.1)
    asset_dir = BASE / 'menu-ui'
    # Native popup capture was unreliable under desktop DPI. These menu panels
    # are explicitly labeled operation illustrations using the app's real labels.
    for name in ['menu-visible.png', 'menu-hidden.png', 'menu-chat.png', 'menu-exit.png', 'clean-panel.png', 'ball.png']:
        if not (asset_dir / name).exists():
            raise FileNotFoundError(asset_dir / name)
    panel = Image.open(asset_dir / 'clean-panel.png').convert('RGBA')
    ball = Image.open(asset_dir / 'ball.png').convert('RGBA')
    state = json.loads((asset_dir / 'state.json').read_text(encoding='utf-8'))
    bounds, ball_bounds = state['panelBounds'], state['ballBounds']
    still = panel.copy()
    # The initial floating-ball icon itself is captured from the production UI.
    still.alpha_composite(ball, (ball_bounds['x'] - bounds['x'], ball_bounds['y'] - bounds['y']))
    still.convert('RGB').save(directory / 'ball-only.png')
    closing = panel.copy()
    drawing = ImageDraw.Draw(closing)
    face = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 34)
    title = '已退出大肥鱼'
    box = drawing.textbbox((0, 0), title, font=face)
    drawing.text(((closing.width - box[2]) / 2, closing.height / 2 - 24), title, font=face, fill='#426f9f')
    closing.convert('RGB').save(directory / 'closed-card.png')
    frames = [directory / 'ball-only.png', asset_dir / 'menu-chat.png', asset_dir / 'menu-hidden.png',
              asset_dir / 'menu-visible.png', asset_dir / 'menu-exit.png', directory / 'closed-card.png']
    switches = [0, opened, hidden, restored, exit_menu, closed, seconds]
    raw_dir = BASE / 'capture/final-v3-09b-quick-menu'
    raw_dir.mkdir(parents=True, exist_ok=True)
    args = ['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-loop', '1', '-i', BASE / 'graphics/09b-quick-menu.background.png']
    filters = []
    previous = '0:v'
    for i, frame in enumerate(frames):
        args += ['-loop', '1', '-i', frame]
        filters.append(f'[{i+1}:v]scale=960:540:force_original_aspect_ratio=decrease,pad=960:540:(ow-iw)/2:(oh-ih)/2:color=0xf4f8f6[shot{i}]')
        filters.append(f"[{previous}][shot{i}]overlay=840:270:enable='between(t,{switches[i]},{switches[i+1]})'[v{i}]")
        previous = f'v{i}'
    args += ['-filter_complex_threads', '2', '-filter_complex', ';'.join(filters), '-map', f'[{previous}]', '-t', seconds,
             '-an', '-r', '30', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-threads', '4', '-pix_fmt', 'yuv420p', raw_dir / 'footage.mp4']
    promo.run(args)
    segment = {**voice, 'graphic': '09b-quick-menu', 'scene': 'menu', 'mouth': False,
               'chapterTitle': '悬浮球快捷菜单', 'wav': str(audio), 'duration': duration, 'seconds': seconds,
               'boundaries': boundaries, 'captureLabel': raw_dir.name, 'ass': str(directory / 'subtitles/09b-quick-menu.ass'),
               'stageOverlays': [{'file': f'09b-quick-menu.stage-{i+1}.overlay.png', 'start': start, 'end': end}
                                 for i, (start, end) in enumerate([(opened, hidden), (hidden, exit_menu), (exit_menu, seconds)])],
               'menuScreens': [{'file': str(frame), 'start': switches[i], 'end': switches[i+1]} for i, frame in enumerate(frames)]}
    # Keep the list of windows together instead of leaving a dangling "角色、"
    # at the end of the previous caption. Sentence timings remain measured;
    # these within-sentence splits use the same character-proportion estimate.
    caption_boundaries = []
    for boundary in boundaries:
        cut = next((boundary['text'].find(word) for word in ['临时隐藏', '角色、'] if word in boundary['text']), -1)
        if cut > 0:
            part = boundary['duration'] * cut / len(boundary['text'])
            caption_boundaries += [
                {**boundary, 'text': boundary['text'][:cut], 'duration': part},
                {**boundary, 'text': boundary['text'][cut:], 'start': boundary['start'] + part, 'duration': boundary['duration'] - part},
            ]
        else:
            caption_boundaries.append(boundary)
    segment['cues'] = promo.captions({**segment, 'boundaries': caption_boundaries})
    Path(segment['ass']).write_text(promo.ASS_HEAD + '\n'.join(
        f"Dialogue: 0,{promo.stamp(c['start'],True)},{promo.stamp(c['end'],True)},Default,,0,0,0,,{{\\fad(70,70)}}{c['text']}"
        for c in segment['cues']) + '\n', encoding='utf-8-sig')
    edit = copy.deepcopy(original)
    segment['menuRepresentation'] = 'Clearly labeled operation illustrations; production menu labels/callbacks verified; captured real floating-ball icon.'
    edit.update(tag='final-v3', revisionNote='Added labeled floating-ball menu operation illustrations and hide/show/exit explanation; retains easter-egg chapter.')
    index = next(i for i, item in enumerate(edit['segments']) if item['id'] == '09-desktop') + 1
    edit['segments'].insert(index, segment)
    cursor = 0
    global_cues = []
    for item in edit['segments']:
        item['offset'] = cursor
        global_cues += [{**cue, 'start': cue['start'] + cursor, 'end': cue['end'] + cursor} for cue in item['cues']]
        cursor += item['seconds']
        old = BASE / 'final-v2/clips' / (item['id'] + '.mp4')
        if old.exists():
            shutil.copy2(old, directory / 'clips' / old.name)
    edit['duration'] = cursor
    promo.save(directory / 'edit.json', edit)
    (directory / 'captions.srt').write_text('\n\n'.join(
        f"{i+1}\n{promo.stamp(c['start'])} --> {promo.stamp(c['end'])}\n{c['text']}"
        for i, c in enumerate(global_cues)) + '\n', encoding='utf-8-sig')
    print(json.dumps({'tag': 'final-v3', 'newChapterSeconds': seconds, 'start': segment['offset'],
                      'totalSecondsWithCredits': cursor + 3, 'screenSwitches': switches}, ensure_ascii=False), flush=True)

if __name__ == '__main__':
    main()
