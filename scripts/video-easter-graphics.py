"""Add the interaction chapter's native graphics without touching prior scenes."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/video014/graphics'
spec = importlib.util.spec_from_file_location('promo_graphics', ROOT / 'scripts/video-graphics.py')
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)

STEM = '07b-easter-egg'
CARDS = [
    ('第一轮', '吓一跳 → 慌张 → 害羞'),
    ('第二轮', '红脸嗔怒 · 别过头去'),
    ('第三轮', '认真责怪 · 不许再闹啦'),
    ('摸头哄好后，再轻点', '短暂心动 · 呼吸轻轻起伏'),
]


def overlay(active=None):
    layer = Image.new('RGBA', (g.W, g.H))
    d = ImageDraw.Draw(layer)
    g.header(d)
    d.text((119, 193), 'ONE MORE LITTLE SECRET', font=g.font(25, True), fill=g.BLUE)
    d.line((119, 244, 193, 244), fill=g.CYAN, width=5)
    d.text((112, 266), '轻点彩蛋', font=g.font(88, True), fill=g.NAVY)
    d.text((120, 383), '轻点胸前 · 每轮结束后再点', font=g.font(33), fill=g.MUTED)

    for i, (title, description) in enumerate(CARDS):
        y = 456 + i * 96
        highlighted = active == i + 1
        d.rounded_rectangle((112, y, 761, y + 85), radius=18,
                            fill=(231, 247, 249, 240) if highlighted else (255, 255, 255, 205),
                            outline=(*g.CYAN, 210) if highlighted else (216, 229, 234, 240),
                            width=3 if highlighted else 1)
        d.rounded_rectangle((129, y + 20, 172, y + 63), radius=14,
                            fill=(*g.CYAN, 215) if highlighted else (225, 236, 242, 255))
        d.text((141, y + 23), str(i + 1), font=g.font(25, True),
               fill=(255, 255, 255) if highlighted else g.BLUE)
        d.text((193, y + 9), title, font=g.font(24, True), fill=g.BLUE)
        d.text((193, y + 42), description, font=g.font(29), fill=g.NAVY)

    d.text((120, 858), '播放中连点不叠加 · 心动结束后重置', font=g.font(25), fill=g.MUTED)
    g.footer(d, {'footer': '功能演示 · 脚本编排 · AI 合成配音'})
    return layer


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    background = g.decoration(g.gradient_background())
    background.save(OUT / f'{STEM}.background.png')
    layers = []
    for active in [None, 1, 2, 3, 4]:
        layer = overlay(active)
        suffix = '' if active is None else f'.stage-{active}'
        name = f'{STEM}{suffix}.overlay.png'
        layer.save(OUT / name)
        layers.append({'stage': active, 'file': name})
        if active is None:
            Image.alpha_composite(background, layer).convert('RGB').save(OUT / f'{STEM}.preview.png')

    # Actual model footage may be inserted between these layers. It is absent
    # from the preview; the entire right area stays available for the character.
    manifest = {
        'id': STEM, 'width': g.W, 'height': g.H,
        'background': f'{STEM}.background.png', 'overlay': f'{STEM}.overlay.png',
        'preview': f'{STEM}.preview.png', 'stageOverlays': layers,
        'textRect': [112, 193, 650, 700],
        'subjectRect': [800, 115, 1030, 790],
        'subtitleRect': [270, 908, 1380, 65],
        'cards': [{'stage': i+1, 'title': title, 'description': description,
                   'rect': [112, 456+i*96, 649, 85]} for i, (title, description) in enumerate(CARDS)],
        'note': 'All step labels describe actual local interaction states. Use neutral overlay, or replace it with one stage overlay at a time.',
    }
    (OUT / f'{STEM}.manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'graphics': str(OUT), 'id': STEM, 'stageOverlays': 4}, ensure_ascii=False))


if __name__ == '__main__':
    main()
