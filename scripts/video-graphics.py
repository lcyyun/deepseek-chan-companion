"""Editable, code-native 1080p graphics for the companion introduction video.

Usage:
  python scripts/video-graphics.py
  python scripts/video-graphics.py --scenes path/to/scenes.json --out output/path

Each scene creates a background, transparent overlay, and composed preview PNG.
Put real character footage between the background and overlay. These are graphic
cards, not simulated application screens. A manifest records the safe rectangles.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
W, H = 1920, 1080
NAVY = (18, 39, 69)
BLUE = (65, 111, 167)
CYAN = (49, 191, 215)
CREAM = (247, 248, 243)
MUTED = (98, 122, 148)
FONT_REGULAR = Path('C:/Windows/Fonts/msyh.ttc')
FONT_BOLD = Path('C:/Windows/Fonts/msyhbd.ttc')

DEFAULT_SCENES = [
    dict(id='01-intro', type='title', kicker='DESKTOP COMPANION',
         title=['给智能体', '一个桌面身体'],
         subtitle='大肥鱼\n会聊天，也会边说边比划。',
         metrics=[['25', '种表情'], ['12', '组肢体'], ['12', '个组合']]),
    dict(id='02-expression', type='feature', kicker='01 / EXPRESSION',
         title=['表情有语气', '动作有分寸'],
         bullets=['开心、疑惑、害羞，各有表现', '脸部与肢体，可以分别控制', '按语境选择，顺着语音衔接']),
    dict(id='03-speaking', type='feature', kicker='02 / SPEAKING',
         title=['讲得明白', '比划得自然'],
         bullets=['开场组合 → 持续讲述', '手臂轻晃，指尖柔缓跟随', '口型随实际语音开合']),
    dict(id='04-touch', type='feature', kicker='03 / INTERACTION',
         title=['可以摸头', '也可以敲盆'],
         bullets=['长摸头：闭眼、脸红、双手抚胸', '戴上铁盆：圈圈眼与惊吓轻颤', '本地响应，不必次次请求模型']),
    dict(id='05-desktop', type='feature', kicker='04 / DESKTOP',
         title=['住在桌面', '摆到顺手处'],
         bullets=['悬浮球打开聊天，也能单独拖动', '移动模式：拖动位置、滚轮缩放', '按住左键，视线随光标移动']),
    dict(id='06-tuning', type='feature', kicker='05 / PERSONALIZE',
         title=['活跃一点', '还是安静一点'],
         bullets=['调节身体、手势与待机幅度', '微调眉毛、嘴角和脸红', '设置自动保存，下次继续用']),
    dict(id='07-watch', type='feature', kicker='06 / BROWSE TOGETHER',
         title=['分享一段网页', '一起聊聊'],
         bullets=['支持 Chrome / Edge 页面分享', '围绕选中的文字展开对话', '进一步搜索取决于智能体能力']),
    dict(id='08-install', type='feature', kicker='07 / GET STARTED',
         title=['把 README', '交给你的 Agent'],
         bullets=['准备完整的本地模型', '连接智能体与语音服务', '先试摸头，再聊第一句']),
    dict(id='09-screen', type='screen', title=['桌面操作 · 实际界面'],
         subtitle='打开聊天 / 预览动作 / 调节表现'),
    dict(id='10-outro', type='outro', title=['回桌面，', '摸个头。'],
         subtitle='大肥鱼 · DeepSeek-chan 桌面伙伴',
         credits=['模型原画及拆分：神宫凉子', 'Live2D 建模：霓虹猫_NeonNeko',
                  '模型来源：神宫凉子免费配布模型']),
]


def font(size: int, bold: bool = False):
    return ImageFont.truetype(str(FONT_BOLD if bold else FONT_REGULAR), size)


def wrapped(text: str, face, width: int, draw):
    lines = []
    for paragraph in text.split('\n'):
        current = ''
        for character in paragraph:
            candidate = current + character
            if current and draw.textlength(candidate, font=face) > width:
                lines.append(current)
                current = character
            else:
                current = candidate
        lines.append(current)
    return lines


def write_lines(draw, lines, xy, size, color=NAVY, bold=False, line_height=None, width=None):
    face = font(size, bold)
    if isinstance(lines, str):
        lines = wrapped(lines, face, width, draw) if width else lines.split('\n')
    x, y = xy
    for line in lines:
        draw.text((x, y), line, font=face, fill=color)
        y += line_height or round(size * 1.45)
    return y


def pill(draw, xy, text, *, dark=False, size=23):
    face = font(size)
    x, y = xy
    width = int(draw.textlength(text, font=face)) + 42
    draw.rounded_rectangle((x, y, x + width, y + 48), radius=24,
                           fill=(255, 255, 255, 22) if dark else (226, 236, 241, 230))
    draw.text((x + 21, y + 8), text, font=face,
              fill=(211, 230, 240) if dark else MUTED)


def gradient_background(dark=False):
    image = Image.new('RGB', (W, H))
    pixels = image.load()
    base = (15, 33, 59) if dark else CREAM
    glow = (31, 75, 108) if dark else (219, 239, 242)
    for y in range(H):
        for x in range(W):
            distance = math.hypot((x - 1430) / 1350, (y - 490) / 1120)
            amount = max(0.0, 1.0 - distance) * (.9 if dark else .72)
            pixels[x, y] = tuple(round(a * (1 - amount) + b * amount)
                                 for a, b in zip(base, glow))
    return image.convert('RGBA')


def decoration(image, dark=False):
    layer = Image.new('RGBA', image.size)
    d = ImageDraw.Draw(layer)
    if dark:
        d.ellipse((965, 132, 1855, 1022), outline=(108, 213, 227, 34), width=2)
        d.ellipse((1020, 187, 1800, 967), outline=(108, 213, 227, 20), width=2)
    else:
        d.ellipse((874, 78, 1850, 1054), fill=(255, 255, 255, 104))
        d.arc((854, 58, 1870, 1074), start=204, end=339,
              fill=(83, 160, 185, 43), width=3)
        d.ellipse((1656, 165, 1680, 189), fill=(*CYAN, 95))
        d.ellipse((1007, 910, 1021, 924), fill=(*BLUE, 65))
    return Image.alpha_composite(image, layer)


def header(draw, dark=False):
    ink = (235, 245, 250) if dark else NAVY
    draw.ellipse((114, 82, 128, 96), fill=CYAN)
    draw.text((147, 66), '大肥鱼  /  DEEPSEEK-CHAN', font=font(25, True), fill=ink)
    pill(draw, (1571, 61), 'WINDOWS · LIVE2D', dark=dark, size=20)


def footer(draw, scene, dark=False):
    ink = (164, 190, 210) if dark else MUTED
    draw.line((112, 985, 1808, 985), fill=(*ink, 55), width=1)
    draw.text((112, 1004), scene.get('footer', '功能演示 · 脚本编排 · AI 合成配音'), font=font(23), fill=ink)
    label = scene.get('corner', '大肥鱼 · 桌面伙伴')
    face = font(23)
    draw.text((1808 - draw.textlength(label, font=face), 1004), label, font=face, fill=ink)


def render(scene, out):
    kind = scene.get('type', 'feature')
    dark = kind in ('screen', 'outro', 'voice-credit') or scene.get('dark', False)
    background = decoration(gradient_background(dark), dark)
    overlay = Image.new('RGBA', (W, H))
    draw = ImageDraw.Draw(overlay)
    header(draw, dark)
    ink = (243, 249, 253) if dark else NAVY
    muted = (176, 203, 222) if dark else MUTED
    title = scene.get('title', [])
    if isinstance(title, str):
        title = title.split('\n')
    manifest = dict(id=scene['id'], type=kind, width=W, height=H,
                    subjectRect=[800, 115, 1030, 850], subtitleRect=[270, 908, 1380, 65])
    if kind == 'screen':
        # A true 16:9 opening; no UI is drawn into this area.
        rect = (208, 152, 1712, 998)
        draw.rounded_rectangle((rect[0]-4, rect[1]-4, rect[2]+4, rect[3]+4), radius=17,
                               outline=(110, 192, 210, 155), width=2)
        manifest['footageRect'] = [208, 152, 1504, 846]
        write_lines(draw, scene.get('subtitle', ''), (112, 1020), 23, muted)
        screen_note = scene.get('footer', '功能演示 · 脚本编排 · AI 合成配音')
        note_font = font(23)
        draw.text((1808-draw.textlength(screen_note,font=note_font),1020),screen_note,font=note_font,fill=muted)
        # Header title sits above the footage, aligned right of the brand.
        draw.text((695, 68), title[0] if title else '实际界面', font=font(27), fill=ink)
    elif kind == 'outro':
        write_lines(draw, title, (112, 230), 124, ink, True, 159)
        write_lines(draw, scene.get('subtitle', ''), (120, 596), 37, muted)
        credits = scene.get('credits', [])
        write_lines(draw, credits, (120, 755), 28, muted, line_height=48)
        manifest['subjectRect'] = [1000, 175, 790, 760]
        footer(draw, {**scene, 'footer': scene.get('footer', '角色素材与桌宠程序分别提供 · AI 合成配音')}, True)
    elif kind == 'voice-credit':
        draw.text((120, 200), 'VOICE CREDITS', font=font(26, True), fill=CYAN)
        write_lines(draw, title or ['声音，也有出处。'], (112, 270), 86, ink, True, 112)
        draw.rounded_rectangle((112, 422, 1808, 840), radius=32, fill=(255,255,255,9), outline=(111,181,205,45), width=1)
        entries = scene.get('entries', [])
        for index, entry in enumerate(entries):
            x = 160 + (index % 2) * 860
            y = 465 + (index // 2) * 170
            draw.text((x,y), entry['label'], font=font(28), fill=muted)
            draw.text((x,y+49), entry['value'], font=font(44,True), fill=ink)
        manifest.update(subjectRect=None, standalone=True, usage='final voice only; do not append to Xiaoyi draft')
        footer(draw, {**scene, 'footer': '声音来源标注 · AI 合成配音'}, True)
    else:
        kicker = scene.get('kicker', '')
        draw.text((119, 193), kicker, font=font(25, True), fill=BLUE)
        draw.line((119, 244, 193, 244), fill=CYAN, width=5)
        size = 101 if kind == 'title' else 88
        max_title_width = 650
        while size > 64 and any(draw.textlength(line, font=font(size, True)) > max_title_width for line in title):
            size -= 1
        title_end = write_lines(draw, title, (112, 270), size, ink, True, round(size*1.37))
        if scene.get('subtitle'):
            write_lines(draw, scene['subtitle'], (120, title_end+26), 36, muted, width=635, line_height=58)
        bullets = scene.get('bullets', [])
        y = max(title_end + 46, 577)
        for index, text in enumerate(bullets):
            draw.rounded_rectangle((120, y+9, 153, y+42), radius=10, fill=(225, 236, 242))
            draw.text((129, y+6), str(index+1), font=font(20, True), fill=BLUE)
            lines = wrapped(text, font(33), 565, draw)
            write_lines(draw, lines, (173, y), 33, muted, line_height=47)
            y += max(78, len(lines)*47+24)
        for index, (number, label) in enumerate(scene.get('metrics', [])):
            x = 120 + index * 206
            draw.rounded_rectangle((x, 797, x+183, 924), radius=22, fill=(255,255,255,200),
                                   outline=(216,229,234), width=1)
            draw.text((x+23, 808), number, font=font(46,True), fill=BLUE)
            draw.text((x+25, 870), label, font=font(24), fill=MUTED)
        footer(draw, scene, dark)
    stem = scene['id']
    paths = dict(background=f'{stem}.background.png', overlay=f'{stem}.overlay.png', preview=f'{stem}.preview.png')
    background.save(out/paths['background'])
    overlay.save(out/paths['overlay'])
    Image.alpha_composite(background, overlay).convert('RGB').save(out/paths['preview'])
    return {**manifest, **paths}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--scenes', type=Path)
    parser.add_argument('--out', type=Path, default=ROOT/'output/video014/graphics')
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    scenes = json.loads(args.scenes.read_text(encoding='utf-8-sig')) if args.scenes else DEFAULT_SCENES
    if isinstance(scenes, dict):
        scenes = scenes['scenes']
    manifest = [render(scene, args.out) for scene in scenes]
    (args.out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    if not args.scenes:
        (args.out/'scenes.json').write_text(json.dumps(DEFAULT_SCENES,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(dict(output=str(args.out),scenes=len(manifest)),ensure_ascii=False))


if __name__ == '__main__':
    main()
