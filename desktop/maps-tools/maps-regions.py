#!/usr/bin/env python3
"""A country's regions for Tetra Maps' search (the user, 11 Nov: "Google has it when you search Βοιωτία shows the borders of
that state … every country has them … they don't change"): OSM's administrative boundaries of LEVELS, one line each:

    name <TAB> name:en <TAB> its other names ("el=…|de=…", as maps-places.py) <TAB> admin_level <TAB> label lat <TAB> label lng
         <TAB> w,s,e,n <TAB> its outline: each outer ring Google-polyline encoded (lat, lng, 5 decimals), rings apart by a space

The phone finds a region by name and draws its border, and a search that names one ("σχολείο Άγιος Θωμάς Βοιωτίας") looks
inside it. Outlines are simplified to about SIMPLIFY degrees (~100 m), holes left out: what a border on the map and an
"is it inside" need. A boundary the extract cuts (a neighbour's, half in) does not close and is left out.
Usage: maps-regions.py greece-latest.osm.pbf greece-regions.tsv   (needs pyosmium 3.6 or newer)
"""
import importlib.util
import os
import sys

import osmium

_spec = importlib.util.spec_from_file_location("places", os.path.join(os.path.dirname(os.path.abspath(__file__)), "maps-places.py"))
places = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(places)

# 3 to 6: in Greece the decentralized administrations, the 13 regions (Στερεά Ελλάδα), the 74 regional units (Βοιωτία) and
# the municipalities (Δήμος Τανάγρας); elsewhere states, provinces and counties. 7 and 8 are villages' own, already places.
LEVELS = {"3", "4", "5", "6"}
SIMPLIFY = 0.001


def simplify(pts, tol):
    """Douglas-Peucker: the points that keep the line within [tol] of [pts]."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (ay, ax), (by, bx) = pts[a], pts[b]
        dy, dx = by - ay, bx - ax
        norm = (dx * dx + dy * dy) ** 0.5
        best, at = -1.0, -1
        for i in range(a + 1, b):
            y, x = pts[i]
            d = abs(dx * (ay - y) - dy * (ax - x)) / norm if norm else ((y - ay) ** 2 + (x - ax) ** 2) ** 0.5
            if d > best:
                best, at = d, i
        if best > tol:
            keep[at] = True
            stack += [(a, at), (at, b)]
    return [p for p, k in zip(pts, keep) if k]


def encode(pts):
    """Google's polyline encoding of [(lat, lng)]."""
    out, py, px = [], 0, 0
    for lat, lng in pts:
        y, x = round(lat * 1e5), round(lng * 1e5)
        for v in (y - py, x - px):
            v = ~(v << 1) if v < 0 else v << 1
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1f)) + 63))
                v >>= 5
            out.append(chr(v + 63))
        py, px = y, x
    return "".join(out)


def centroid(ring):
    """The middle of a ring by its area (shoelace), and that area; the mean of its points when it has none."""
    a = cy = cx = 0.0
    for (y0, x0), (y1, x1) in zip(ring, ring[1:] + ring[:1]):
        f = x0 * y1 - x1 * y0
        a += f
        cy += (y0 + y1) * f
        cx += (x0 + x1) * f
    if not a:
        return sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring), 0.0
    return cy / (3 * a), cx / (3 * a), abs(a / 2)


def regions(pbf):
    """Each region of LEVELS in [pbf]: (tags as a dict, its outer rings as [(lat, lng)])."""
    fp = osmium.FileProcessor(pbf).with_areas(osmium.filter.TagFilter(("boundary", "administrative"))) \
        .with_filter(osmium.filter.EntityFilter(osmium.osm.AREA))
    for o in fp:
        t = o.tags
        if t.get("boundary") != "administrative" or t.get("admin_level") not in LEVELS or "name" not in t:
            continue
        rings = [[(n.lat, n.lon) for n in ring if n.location.valid()] for ring in o.outer_rings()]
        rings = [r for r in rings if len(r) >= 4]
        if rings:
            yield dict(t), rings


def line(tags, rings):
    lat, lng, _ = max((centroid(r) for r in rings), key=lambda c: c[2])  # the biggest piece's middle (an island's own is small)
    w, e = min(p[1] for r in rings for p in r), max(p[1] for r in rings for p in r)
    s, n = min(p[0] for r in rings for p in r), max(p[0] for r in rings for p in r)
    outline = " ".join(encode(simplify(r, SIMPLIFY)) for r in rings)
    return (f"{places.clean(tags['name'])}\t{places.clean(tags.get('name:en'))}\t{places.names(tags)}\t{tags['admin_level']}"
            f"\t{lat:.6f}\t{lng:.6f}\t{w:.5f},{s:.5f},{e:.5f},{n:.5f}\t{outline}\n")


if __name__ == "__main__":
    count = 0
    with open(sys.argv[2] + ".part", "w", encoding="utf-8") as out:
        for tags, rings in regions(sys.argv[1]):
            out.write(line(tags, rings))
            count += 1
    os.replace(sys.argv[2] + ".part", sys.argv[2])
    print(f"{count} regions")
