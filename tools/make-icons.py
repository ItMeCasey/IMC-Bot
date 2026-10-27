"""
Builds the app icons in desktop/build.

  The detailed robot (the master art in C:\\Users\\casey\\dev\\IMC-Icons, bot.png and bot.ico) is used as it is for the big places:
    icon.png, icon.ico   the desktop shortcut, the installer, the app file
  A simplified robot is drawn here for the small places, where fine stripes turn to mush at 16 to 32 pixels:
    window.png, window.ico   the title bar and the taskbar button
    tray-<state>.png         the system tray: the simplified robot with a status dot
                             (green = connected to Discord, amber = starting or not connected, red = stopped or a problem, grey = starting)

Needs Pillow (pip install pillow). Run from the repository folder:  python tools/make-icons.py [path to the IMC-Icons folder]
"""
import os
import shutil
import sys

from PIL import Image, ImageDraw

SRC = sys.argv[1] if len(sys.argv) > 1 else r'C:\Users\casey\dev\IMC-Icons'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'desktop', 'build')
AQUA, HEAT, CREAM, IRON = '#4FBBBC', '#F39120', '#E2DAC2', '#1A2020'
DOT = {'green': '#5BD07A', 'amber': '#F39120', 'red': '#EC4624', 'grey': '#8A9490'}


def simple_robot(size=512, ss=4):
    """The small-size robot: a bold aqua outline, one orange ring, two big eyes and an antenna, on a transparent background."""
    k = size * ss / 512.0
    img = Image.new('RGBA', (size * ss, size * ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    box = lambda x0, y0, x1, y1: [x0 * k, y0 * k, x1 * k, y1 * k]
    # antenna: a stem and a ring with a dot
    d.rounded_rectangle(box(238, 70, 274, 170), radius=18 * k, fill=AQUA)
    d.ellipse(box(204, 14, 308, 118), fill=AQUA)
    d.ellipse(box(226, 36, 286, 96), fill=IRON)
    d.ellipse(box(240, 50, 272, 82), fill=HEAT)
    # the head: aqua outline, dark inside, one orange ring, two eyes
    d.rounded_rectangle(box(30, 150, 482, 466), radius=120 * k, fill=AQUA)
    d.rounded_rectangle(box(72, 192, 440, 424), radius=82 * k, fill=IRON)
    d.rounded_rectangle(box(100, 220, 412, 396), radius=62 * k, outline=HEAT, width=int(26 * k))
    d.ellipse(box(150, 262, 232, 344), fill=CREAM)
    d.ellipse(box(280, 262, 362, 344), fill=CREAM)
    return img.resize((size, size), Image.LANCZOS)


master = Image.open(os.path.join(SRC, 'bot.png')).convert('RGBA')
# the big icon: the detailed robot, untouched
shutil.copyfile(os.path.join(SRC, 'bot.ico'), os.path.join(OUT, 'icon.ico'))
master.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, 'icon.png'))

# the title bar and taskbar: the simplified robot
simple = simple_robot(512)
simple.resize((256, 256), Image.LANCZOS).save(os.path.join(OUT, 'window.png'))
simple.save(os.path.join(OUT, 'window.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

# the tray: the simplified robot, a little smaller to leave room, with a status dot in the corner
S = 4
for name, color in DOT.items():
    big = simple_robot(64 * S, 1)   # drawn at 4x and shrunk, so the edges are smooth
    d = ImageDraw.Draw(big)
    r, cx, cy = 10 * S, 64 * S - 13 * S, 64 * S - 13 * S   # the dark ring ends exactly at the edge of the picture, so nothing is cut off
    d.ellipse([cx - r - 3 * S, cy - r - 3 * S, cx + r + 3 * S, cy + r + 3 * S], fill=IRON)   # a dark ring so the dot stands out on any taskbar
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)
    big.resize((64, 64), Image.LANCZOS).save(os.path.join(OUT, 'tray-' + name + '.png'))
print('icons written to', os.path.normpath(OUT))
