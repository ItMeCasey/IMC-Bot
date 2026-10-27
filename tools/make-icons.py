"""
Builds the app icons in desktop/build from the master art in C:\\Users\\casey\\dev\\IMC-Icons (bot.png and bot.ico):
  icon.png, icon.ico  the installer, the app and the shortcut (the robot)
  window.png          the window icon
  tray-<state>.png    the tray icon: the robot with a small status dot (green = connected to Discord, amber = starting or not connected,
                      red = stopped or a problem, grey = starting)
Needs Pillow (pip install pillow). Run from the repository folder:  python tools/make-icons.py [path to the IMC-Icons folder]
"""
import os
import shutil
import sys

from PIL import Image, ImageDraw

SRC = sys.argv[1] if len(sys.argv) > 1 else r'C:\Users\casey\dev\IMC-Icons'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'desktop', 'build')
DOT = {'green': '#5BD07A', 'amber': '#F39120', 'red': '#EC4624', 'grey': '#8A9490'}

master = Image.open(os.path.join(SRC, 'bot.png')).convert('RGBA')
shutil.copyfile(os.path.join(SRC, 'bot.ico'), os.path.join(OUT, 'icon.ico'))
master.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, 'icon.png'))
master.resize((256, 256), Image.LANCZOS).save(os.path.join(OUT, 'window.png'))
shutil.copyfile(os.path.join(SRC, 'bot.ico'), os.path.join(OUT, 'window.ico'))

S = 4   # draw large and shrink, so the dot is smooth
for name, color in DOT.items():
    base = master.resize((64 * S, 64 * S), Image.LANCZOS)
    d = ImageDraw.Draw(base)
    r, cx, cy = 10 * S, 64 * S - 12 * S, 64 * S - 12 * S
    d.ellipse([cx - r - 3 * S, cy - r - 3 * S, cx + r + 3 * S, cy + r + 3 * S], fill='#1A2020')   # a dark ring so the dot stands out
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)
    base.resize((64, 64), Image.LANCZOS).save(os.path.join(OUT, 'tray-' + name + '.png'))
print('icons written to', os.path.normpath(OUT))
