"""Home's icon in the apps' style (public/apps/home.png): a cream house with a coral roof, a wooden door and a lit window
on an indigo gradient tile, soft shadows as the other art has. Drawn at 4x, then scaled down: python3 scripts/home-icon.py"""
from PIL import Image, ImageDraw, ImageFilter
import os

S = 768  # drawn at 4x of 192


def gradient(size, top, bottom):
    g = Image.new('RGBA', (1, size[1]))
    for y in range(size[1]):
        t = y / max(1, size[1] - 1)
        g.putpixel((0, y), tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)) + (255,))
    return g.resize(size)


def rounded_mask(size, box, r):
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).rounded_rectangle(box, r, fill=255)
    return m


def shadow(size, shape, offset, blur, alpha):
    sh = Image.new('RGBA', size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).polygon([(x + offset[0], y + offset[1]) for x, y in shape], fill=(10, 14, 60, alpha))
    return sh.filter(ImageFilter.GaussianBlur(blur))


img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
# the tile: an indigo-blue gradient, rounded as the others, a soft light at its top
tile = gradient((S, S), (110, 128, 255), (52, 70, 214))
img.paste(tile, (0, 0), rounded_mask((S, S), (0, 0, S - 1, S - 1), int(S * 0.225)))
glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
ImageDraw.Draw(glow).ellipse((-S * 0.2, -S * 0.55, S * 1.2, S * 0.45), fill=(255, 255, 255, 46))
glow = glow.filter(ImageFilter.GaussianBlur(40))
img.alpha_composite(Image.composite(glow, Image.new('RGBA', (S, S)), rounded_mask((S, S), (0, 0, S - 1, S - 1), int(S * 0.225))))

u = S / 100  # a hundredth of the tile
body = [(26 * u, 47 * u), (74 * u, 47 * u), (74 * u, 80 * u), (26 * u, 80 * u)]
roof = [(50 * u, 17 * u), (85 * u, 50 * u), (79 * u, 55 * u), (50 * u, 28 * u), (21 * u, 55 * u), (15 * u, 50 * u)]
# shadows under the house and the roof
img.alpha_composite(shadow((S, S), body, (0, 4 * u), 3.5 * u, 120))
img.alpha_composite(shadow((S, S), roof, (0, 3 * u), 3 * u, 110))

d = ImageDraw.Draw(img)
# the chimney, behind the roof
d.rounded_rectangle((63 * u, 24 * u, 71 * u, 40 * u), int(1.5 * u), fill=(214, 79, 64, 255))
# the walls: cream, lighter at the top
walls = gradient((int(48 * u), int(36 * u)), (255, 248, 230), (240, 223, 190))
rm = Image.new('L', walls.size, 0)
ImageDraw.Draw(rm).rounded_rectangle((0, 0, walls.size[0] - 1, walls.size[1] - 1), int(3 * u), fill=255)
img.paste(walls, (int(26 * u), int(44 * u)), rm)
# the roof: coral, a lighter top edge
d.polygon(roof, fill=(255, 104, 86, 255))
d.line([(17 * u, 49 * u), (50 * u, 19 * u), (83 * u, 49 * u)], fill=(255, 150, 130, 255), width=int(1.6 * u), joint='curve')
# the door: wood, rounded at its top, a brass knob
d.rounded_rectangle((44 * u, 60 * u, 56 * u, 80 * u), int(5 * u), fill=(196, 132, 86, 255))
d.rectangle((44 * u, 72 * u, 56 * u, 80 * u), fill=(196, 132, 86, 255))
d.rounded_rectangle((45.5 * u, 61.5 * u, 54.5 * u, 80 * u), int(4 * u), outline=(170, 108, 66, 255), width=int(0.8 * u))
d.ellipse((52 * u, 70 * u, 54 * u, 72 * u), fill=(255, 214, 102, 255))
# the window: lit, warm yellow, with its cross
d.rounded_rectangle((31 * u, 55 * u, 40 * u, 64 * u), int(1.5 * u), fill=(255, 212, 84, 255))
d.line([(35.5 * u, 55 * u), (35.5 * u, 64 * u)], fill=(240, 223, 190, 255), width=int(1 * u))
d.line([(31 * u, 59.5 * u), (40 * u, 59.5 * u)], fill=(240, 223, 190, 255), width=int(1 * u))
d.rounded_rectangle((60 * u, 55 * u, 69 * u, 64 * u), int(1.5 * u), fill=(255, 212, 84, 255))
d.line([(64.5 * u, 55 * u), (64.5 * u, 64 * u)], fill=(240, 223, 190, 255), width=int(1 * u))
d.line([(60 * u, 59.5 * u), (69 * u, 59.5 * u)], fill=(240, 223, 190, 255), width=int(1 * u))

out = os.path.join(os.path.dirname(__file__), '..', 'public', 'apps', 'home.png')
img.resize((192, 192), Image.LANCZOS).save(out, optimize=True)
if os.environ.get('PREVIEW'): img.resize((384, 384), Image.LANCZOS).save(os.environ['PREVIEW'])
print('home.png', os.path.getsize(out))
