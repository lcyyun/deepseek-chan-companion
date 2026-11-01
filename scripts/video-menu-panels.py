"""Readable menu explanation panels; deliberately labelled as illustrations.

The ball is a capture of production UI. The enlarged menu cards are explanatory
graphics using the real production menu labels, never advertised as OS captures.
"""
from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output/video014/menu-ui'
REG='C:/Windows/Fonts/msyh.ttc'
BOLD='C:/Windows/Fonts/msyhbd.ttc'
def font(size,bold=False):return ImageFont.truetype(BOLD if bold else REG,size)
def panel():
    im=Image.new('RGBA',(960,540),'#f4f8f6');d=ImageDraw.Draw(im)
    d.text((50,44),'悬浮球 · 快捷功能',font=font(25,True),fill='#254769')
    d.text((50,89),'右键一下，常用操作就在这里。',font=font(18),fill='#7d93a6')
    d.text((50,482),'菜单操作示意 · 功能与程序一致',font=font(17),fill='#8b9dab')
    return im
base=panel();base.convert('RGB').save(OUT/'clean-panel.png')
ball=Image.open(OUT/'ball.png').convert('RGBA')
for name,hidden,active in [('menu-visible',False,None),('menu-hidden',True,1),('menu-chat',False,0),('menu-exit',False,2)]:
    im=panel();im.alpha_composite(ball,(330,200));d=ImageDraw.Draw(im)
    d.rounded_rectangle((438,183,836,420),radius=13,fill='#d9e3e3')
    d.rounded_rectangle((432,177,830,414),radius=13,fill='white',outline='#d2dfe6',width=2)
    labels=['打开聊天','显示桌宠' if hidden else '暂时隐藏桌宠','退出大肥鱼']
    rows=[190,256,338]
    for i,(label,y) in enumerate(zip(labels,rows)):
        if active==i:d.rounded_rectangle((443,y,819,y+61),radius=6,fill='#e4f2fa')
        d.text((470,y+12),label,font=font(27),fill='#254769')
    d.line((447,326,815,326),fill='#e0e8ed',width=2)
    im.convert('RGB').save(OUT/(name+'.png'))
closed=panel();d=ImageDraw.Draw(closed)
d.text((311,220),'大肥鱼已退出',font=font(44,True),fill='#315c7f')
d.text((249,294),'角色、悬浮球、聊天窗口一起关闭',font=font(24),fill='#7891a5')
closed.convert('RGB').save(OUT/'closed.png')
(OUT/'panels.json').write_text(json.dumps({'width':960,'height':540,'kind':'explicitly-labelled-menu-illustration','source':'production labels and callbacks, genuine production ball capture','panels':['clean-panel.png','ball.png','menu-visible.png','menu-hidden.png','menu-chat.png','menu-exit.png','closed.png'],'ballRect':[330,200,58,58],'menuRect':[432,177,398,237],'notNativeMenuScreenshot':True},ensure_ascii=False,indent=2),encoding='utf-8')
