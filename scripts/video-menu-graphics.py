"""1080p menu chapter graphics; insert UI captures or clearly labeled illustrations."""
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

STEM = '09b-quick-menu'
FOOTAGE = [840, 270, 960, 540]
CARDS = [
    ('打开聊天', '随时聊两句'),
    ('暂时隐藏 / 显示', '球还在，随时回来'),
    ('退出大肥鱼', '关闭整个程序'),
]


def overlay(active=None):
    layer = Image.new('RGBA', (g.W, g.H))
    d = ImageDraw.Draw(layer)
    g.header(d)
    d.text((119, 193), 'QUICK CONTROLS', font=g.font(25, True), fill=g.BLUE)
    d.line((119, 244, 193, 244), fill=g.CYAN, width=5)
    g.write_lines(d, ['右键悬浮球', '快捷操作'], (112, 268), 84, g.NAVY, True, 108)

    for i, (title, description) in enumerate(CARDS):
        y = 524 + i * 106
        highlighted = active == i + 1
        d.rounded_rectangle((112, y, 760, y + 92), radius=18,
                            fill=(231, 247, 249, 244) if highlighted else (255, 255, 255, 210),
                            outline=(*g.CYAN, 210) if highlighted else (216, 229, 234, 240),
                            width=3 if highlighted else 1)
        d.rounded_rectangle((130, y + 24, 174, y + 68), radius=14,
                            fill=(*g.CYAN, 215) if highlighted else (225, 236, 242, 255))
        d.text((141, y + 26), str(i + 1), font=g.font(25, True),
               fill='white' if highlighted else g.BLUE)
        d.text((194, y + 10), title, font=g.font(27, True), fill=g.BLUE)
        d.text((194, y + 48), description, font=g.font(27), fill=g.NAVY)

    d.text((120, 858), '收起窗口 ≠ 退出程序', font=g.font(27), fill=g.MUTED)
    # This is a presentation frame, not a drawn or simulated menu. Keep the
    # exact 16:9 slot transparent for separately captured application footage.
    d.rounded_rectangle((828, 258, 1812, 868), radius=23,
                        outline=(172, 204, 217, 220), width=2)
    d.line((852, 831, 894, 831), fill=g.CYAN, width=4)
    d.text((910, 816), '右键悬浮球，按需选择', font=g.font(25), fill=g.MUTED)
    g.footer(d, {'footer': '功能演示 · 脚本编排 · AI 合成配音'})
    return layer


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    background = g.decoration(g.gradient_background())
    d = ImageDraw.Draw(background)
    d.rounded_rectangle((828, 258, 1812, 868), radius=23, fill=(255, 255, 255, 230))
    background.save(OUT / f'{STEM}.background.png')
    layers = []
    for active in [None, 1, 2, 3]:
        layer = overlay(active)
        suffix = '' if active is None else f'.stage-{active}'
        filename = f'{STEM}{suffix}.overlay.png'
        layer.save(OUT / filename)
        layers.append({'stage': active, 'file': filename})
        if active is None:
            Image.alpha_composite(background, layer).convert('RGB').save(OUT / f'{STEM}.preview.png')
    manifest = {
        'id': STEM, 'width': g.W, 'height': g.H,
        'background': f'{STEM}.background.png', 'overlay': f'{STEM}.overlay.png',
        'preview': f'{STEM}.preview.png', 'footageRect': FOOTAGE,
        'textRect': [112, 193, 648, 700], 'subtitleRect': [270, 908, 1380, 65],
        'stageOverlays': layers,
        'cards': [{'stage': i + 1, 'title': title, 'description': description,
                   'rect': [112, 524 + i * 106, 648, 92]}
                  for i, (title, description) in enumerate(CARDS)],
        'note': 'The right area is an empty 16:9 presentation slot. Insert separately prepared UI captures or clearly labeled operation illustrations.',
    }
    (OUT / f'{STEM}.manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'graphics': str(OUT), 'id': STEM, 'footageRect': FOOTAGE}, ensure_ascii=False))


if __name__ == '__main__':
    main()
