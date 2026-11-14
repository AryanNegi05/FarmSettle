"""The shared land patch (Stage 13).

Every farmer registers their farm on the SAME bundled example farmland image
(frontend/public/example-farmland.jpg), so the whole "district" the insurer monitors is
this one geo-referenced patch. The corner coordinates below are the image's geo-reference
and must match frontend/src/features/map/exampleFarmland.ts.

Everything else (sensor positions, storm centres, occupied-land share) is derived from this
patch and from the registered farms; nothing else is hard-coded to a place.
"""
from __future__ import annotations

import math

# Image corners, [lng, lat]: top-left, top-right, bottom-right, bottom-left.
LAND_COORDS: list[list[float]] = [
    [79.1455078125, 21.03195543704973],
    [79.15374755859375, 21.03195543704973],
    [79.15374755859375, 21.024264421016003],
    [79.1455078125, 21.024264421016003],
]


def bounds() -> tuple[float, float, float, float]:
    """(min_lng, min_lat, max_lng, max_lat)."""
    lngs = [p[0] for p in LAND_COORDS]
    lats = [p[1] for p in LAND_COORDS]
    return min(lngs), min(lats), max(lngs), max(lats)


def centre() -> tuple[float, float]:
    """(lng, lat)."""
    a, b, c, d = bounds()
    return (a + c) / 2, (b + d) / 2


def metres_per_degree(lat: float) -> tuple[float, float]:
    return 111_320.0 * math.cos(math.radians(lat)), 110_574.0


def size_m() -> tuple[float, float]:
    """(width_m, height_m) of the patch."""
    min_lng, min_lat, max_lng, max_lat = bounds()
    kx, ky = metres_per_degree((min_lat + max_lat) / 2)
    return (max_lng - min_lng) * kx, (max_lat - min_lat) * ky


def span_m() -> float:
    return max(size_m())


def area_ha() -> float:
    w, h = size_m()
    return w * h / 10_000.0


def ring() -> list[list[float]]:
    return LAND_COORDS + [LAND_COORDS[0]]


def contains(lng: float, lat: float, margin_frac: float = 0.0) -> bool:
    min_lng, min_lat, max_lng, max_lat = bounds()
    mx, my = (max_lng - min_lng) * margin_frac, (max_lat - min_lat) * margin_frac
    return (min_lng - mx) <= lng <= (max_lng + mx) and (min_lat - my) <= lat <= (max_lat + my)


def to_unit(lng: float, lat: float) -> tuple[float, float]:
    """Local coordinates in units of the patch's longer side, origin at the south-west corner.

    Gives the Gaussian Process a scale that matches the land (its length-scale prior is ~0.1).
    """
    min_lng, min_lat, _, _ = bounds()
    kx, ky = metres_per_degree(min_lat)
    s = span_m()
    return (lng - min_lng) * kx / s, (lat - min_lat) * ky / s


def halton(index: int, base: int) -> float:
    f, r = 1.0, 0.0
    i = index
    while i > 0:
        f /= base
        r += f * (i % base)
        i //= base
    return r


def spread_points(n: int, seed: int, inset: float = 0.06, bases: tuple[int, int] = (2, 3),
                  start: int = 1) -> list[tuple[float, float]]:
    """n well-spread, reproducible 'random' points inside the patch as (lng, lat).

    A Halton sequence gives even coverage for every prefix (so changing the sensor count keeps the
    earlier sensors where they were); a seeded rotation makes the layout differ per seed.
    """
    import random
    rng = random.Random(seed)
    ox, oy = rng.random(), rng.random()
    min_lng, min_lat, max_lng, max_lat = bounds()
    pts = []
    for k in range(n):
        u = (halton(start + k, bases[0]) + ox) % 1.0
        v = (halton(start + k, bases[1]) + oy) % 1.0
        u = inset + (1 - 2 * inset) * u
        v = inset + (1 - 2 * inset) * v
        pts.append((min_lng + u * (max_lng - min_lng), min_lat + v * (max_lat - min_lat)))
    return pts
