"""Add the local tap/comfort easter egg without changing the first finished cut.

Run after narration-easter/manifest.json is available, record the one generated
capture job, then run assemble-promo.py --assemble --tag final-v2 --reuse.
"""
import copy
import importlib.util
import json
import math
from pathlib import Path
import shutil
import wave

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'output/video014'
spec = importlib.util.spec_from_file_location('promo', ROOT / 'scripts/assemble-promo.py')
promo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(promo)
original = json.loads((BASE / 'final/edit.json').read_text(encoding='utf-8'))
voice = json.loads((BASE / 'narration-easter/manifest.json').read_text(encoding='utf-8'))['segments'][0]
directory = BASE / 'final-v2'
for folder in ['', 'audio', 'subtitles', 'clips']:
    (directory / folder).mkdir(parents=True, exist_ok=True)

with wave.open(voice['wav'], 'rb') as source:
    assert source.getnchannels() == 1 and source.getsampwidth() == 2
    rate = source.getframerate()
    data = source.readframes(source.getnframes())
boundaries = copy.deepcopy(voice['boundaries'])
gaps = []

def at(phrase):
    if not any(phrase in item['text'] for item in boundaries):
        raise ValueError('Missing narration anchor: ' + phrase)
    return promo.spoken_at({'boundaries': boundaries}, phrase, -1)

def allow_round(phrase, minimum):
    global data
    delta = max(0, minimum - at(phrase))
    if delta:
        boundary = next(item for item in boundaries if phrase in item['text'])
        position = boundary['start']
        frames = math.ceil(delta * rate)
        delta = frames / rate
        index = round(position * rate) * 2
        data = data[:index] + b'\0' * (frames * 2) + data[index:]
        for item in boundaries:
            if item['start'] >= position - .001:
                item['start'] += delta
        gaps.append({'before': phrase, 'seconds': delta})
    return at(phrase)

# Actual reactions last 4.8 / 4.4 / 4.4 / 5 seconds. Do not restart or speed up
# their animations to squeeze them into the narration; leave display pauses.
first = at('轻点胸前')
second = allow_round('再点一次', first + 5.25)
third = allow_round('第三次', second + 4.85)
allow_round('别急', third + 4.85)
pet_start = at('先摸摸头')
pet_end = pet_start + .6
heart = max(at('再轻点一次') + .15, pet_end + 1.35)
allow_round('等她缓过来', heart + 5.4)
lead = .22
data = b'\0' * (round(lead * rate) * 2) + data
for item in boundaries:
    item['start'] += lead
first, second, third, pet_start, pet_end, heart = [x + lead for x in [first, second, third, pet_start, pet_end, heart]]
output_audio = directory / 'audio/07b-easter-egg.wav'
with wave.open(str(output_audio), 'wb') as target:
    target.setnchannels(1)
    target.setsampwidth(2)
    target.setframerate(rate)
    target.writeframes(data)
duration = len(data) / 2 / rate
seconds = math.ceil((duration + .9) * 30) / 30
events = [[first, 'chest-tap'], [first + .23, 'chest-tap'], [first + .46, 'chest-tap'],
          [second, 'chest-tap'], [third, 'chest-tap'], [pet_start, 'pet-start'],
          [pet_end, 'pet-end'], [heart, 'chest-tap']]
segment = {**voice, 'graphic': '07b-easter-egg', 'scene': 'easter', 'framing': 'right', 'mouth': False,
           'chapterTitle': '轻点彩蛋与摸头安抚', 'wav': str(output_audio), 'duration': duration,
           'seconds': seconds, 'boundaries': boundaries, 'captureLabel': 'final-v2-07b-easter-egg',
           'ass': str(directory / 'subtitles/07b-easter-egg.ass'), 'events': events, 'displayPauses': gaps,
           'stageOverlays': [{'file': f'07b-easter-egg.stage-{i+1}.overlay.png', 'start': start, 'end': end}
                             for i, (start, end) in enumerate([(first, second), (second, third),
                                                               (third, pet_start), (pet_start, heart + 5.4)])]}
segment['cues'] = promo.captions(segment)
Path(segment['ass']).write_text(promo.ASS_HEAD + '\n'.join(
    f"Dialogue: 0,{promo.stamp(c['start'],True)},{promo.stamp(c['end'],True)},Default,,0,0,0,,{{\\fad(70,70)}}{c['text']}"
    for c in segment['cues']) + '\n', encoding='utf-8-sig')

edit = copy.deepcopy(original)
edit.update(tag='final-v2', revisionNote='Added local chest-tap/comfort easter egg after petting; original shots retained.')
edit['segments'].insert(next(i for i, item in enumerate(edit['segments']) if item['id'] == '07-pet') + 1, segment)
cursor = 0
global_cues = []
for item in edit['segments']:
    item['offset'] = cursor
    global_cues += [{**cue, 'start': cue['start'] + cursor, 'end': cue['end'] + cursor} for cue in item['cues']]
    cursor += item['seconds']
    old_clip = BASE / 'final/clips' / (item['id'] + '.mp4')
    if old_clip.exists():
        shutil.copy2(old_clip, directory / 'clips' / old_clip.name)
edit['duration'] = cursor
promo.save(directory / 'edit.json', edit)
(directory / 'captions.srt').write_text('\n\n'.join(
    f"{i+1}\n{promo.stamp(c['start'])} --> {promo.stamp(c['end'])}\n{c['text']}"
    for i, c in enumerate(global_cues)) + '\n', encoding='utf-8-sig')
job = {key: segment[key] for key in ['scene', 'seconds', 'framing', 'mouth', 'events']}
job.update(label=segment['captureLabel'], audio=str(output_audio),
           backgroundImage=str(BASE / 'graphics/07b-easter-egg.background.png'))
promo.save(BASE / 'capture-jobs-easter.json', [job])
print(json.dumps({'tag': 'final-v2', 'newChapterSeconds': seconds, 'totalSecondsWithCredits': cursor + 3,
                  'events': events, 'displayPauses': gaps}, ensure_ascii=False), flush=True)
