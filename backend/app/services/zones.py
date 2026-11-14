"""Farm rainfall coverage zones (Stage 13): fitted circles around farm polygons.

A zone is a *monitoring and evidence* area, not a claim that rain is uniform inside it.
Pure geometry, no I/O. Rings are [lng, lat] pairs.
"""
from __future__ import annotations

import math

DEFAULT_BUFFER = 0.15      # 15 % margin beyond the farthest boundary point
MIN_RADIUS_M = 40.0        # keep tiny farms visible
CIRCLE_POINTS = 48


def _scale(lat: float) -> tuple[float, float]:
    """Metres per degree (lng, lat) near this latitude."""
    return 111_320.0 * math.cos(math.radians(lat)), 110_574.0


def open_ring(ring: list[list[float]]) -> list[list[float]]:
    return ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else list(ring)


def polygon_centre(ring: list[list[float]]) -> tuple[float, float]:
    """Area-weighted centroid as (lng, lat). Falls back to the vertex mean for degenerate rings."""
    pts = open_ring(ring)
    lat0 = sum(p[1] for p in pts) / len(pts)
    lng0 = sum(p[0] for p in pts) / len(pts)
    kx, ky = _scale(lat0)
    # Work relative to the polygon's own origin: absolute metres are ~1e7, which loses
    # precision (catastrophic cancellation) for small farms.
    m = [((p[0] - lng0) * kx, (p[1] - lat0) * ky) for p in pts]
    a = cx = cy = 0.0
    for i in range(len(m)):
        x1, y1 = m[i]
        x2, y2 = m[(i + 1) % len(m)]
        cross = x1 * y2 - x2 * y1
        a += cross
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    if abs(a) < 1e-9:
        return lng0, lat0
    a *= 0.5
    return lng0 + cx / (6 * a) / kx, lat0 + cy / (6 * a) / ky


def fitted_circle(ring: list[list[float]], buffer: float = DEFAULT_BUFFER) -> dict:
    """Smallest centroid-centred circle covering every boundary point, plus a margin.

    Returns {centre: [lng, lat], radius_m, polygon: closed GeoJSON ring}.
    """
    pts = open_ring(ring)
    clng, clat = polygon_centre(ring)
    kx, ky = _scale(clat)
    farthest = max(math.hypot((p[0] - clng) * kx, (p[1] - clat) * ky) for p in pts)
    radius = max(MIN_RADIUS_M, farthest * (1.0 + buffer))
    poly = []
    for i in range(CIRCLE_POINTS):
        ang = 2 * math.pi * i / CIRCLE_POINTS
        poly.append([clng + radius * math.cos(ang) / kx, clat + radius * math.sin(ang) / ky])
    poly.append(poly[0])
    return {"centre": [clng, clat], "radius_m": round(radius, 1), "polygon": poly}


def area_hectares(ring: list[list[float]]) -> float:
    pts = open_ring(ring)
    lat0 = sum(p[1] for p in pts) / len(pts)
    lng0 = sum(p[0] for p in pts) / len(pts)
    kx, ky = _scale(lat0)
    m = [((p[0] - lng0) * kx, (p[1] - lat0) * ky) for p in pts]
    a = sum(m[i][0] * m[(i + 1) % len(m)][1] - m[(i + 1) % len(m)][0] * m[i][1] for i in range(len(m)))
    return abs(a) / 2 / 10_000


def distance_m(lng1: float, lat1: float, lng2: float, lat2: float) -> float:
    kx, ky = _scale((lat1 + lat2) / 2)
    return math.hypot((lng1 - lng2) * kx, (lat1 - lat2) * ky)
