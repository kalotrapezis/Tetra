"""Home's icon in the dock (public/apps/home.png): the logo's cube read as a house, a blue roof over green and orange walls,
rounded, on the logo's dark tile (the user, 11 Nov: "an abstract home icon in Tetra's colours … just the walls"). Run from
desktop/: python3 scripts/home-icon.py"""
from PIL import Image, ImageDraw, ImageFilter

S = 1024
BLUE, GREEN, ORANGE = (28, 159, 253), (29, 199, 138), (254, 168, 32)


def rounded(shape_draw, r):
    """A shape's mask with every corner rounded by r: drawn, blurred, cut again at the middle."""
    m = Image.new('L', (S, S), 0)
    shape_draw(ImageDraw.Draw(m))
    return m.filter(ImageFilter.GaussianBlur(r)).point(lambda v: 255 if v > 128 else 0)


def tile(top, bottom):
    g = Image.new('RGBA', (1, S))
    for y in range(S):
        t = y / (S - 1)
        g.putpixel((0, y), tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)) + (255,))
    g = g.resize((S, S))
    m = Image.new('L', (S, S), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, S - 1, S - 1), int(S * 0.225), fill=255)
    out = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    out.paste(g, (0, 0), m)
    return out


def house(img, shadow_alpha):
    u = S / 100
    roof = rounded(lambda d: d.polygon([(50 * u, 16 * u), (84 * u, 46 * u), (16 * u, 46 * u)], fill=255), 2.6 * u)
    left = rounded(lambda d: d.rectangle((23 * u, 50 * u, 48.5 * u, 82 * u), fill=255), 2.2 * u)
    right = rounded(lambda d: d.rectangle((51.5 * u, 50 * u, 77 * u, 82 * u), fill=255), 2.2 * u)
    # a soft shadow under it all, as the apps' art has
    sh = Image.new('L', (S, S), 0)
    for m in (roof, left, right):
        sh.paste(255, (0, 0), m)
    shadow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    shadow.putalpha(sh.filter(ImageFilter.GaussianBlur(3 * u)).point(lambda v: v * shadow_alpha // 255))
    img.alpha_composite(shadow, (0, int(2.5 * u)))
    for m, c in ((roof, BLUE), (left, GREEN), (right, ORANGE)):
        layer = Image.new('RGBA', (S, S), c + (255,))
        img.paste(layer, (0, 0), m)


dark = tile((34, 38, 48), (16, 19, 26))
house(dark, 150)
dark.resize((192, 192), Image.LANCZOS).save('public/apps/home.png', optimize=True)
print('public/apps/home.png')
