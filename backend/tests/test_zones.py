"""Stage 13: fitted rainfall coverage circles."""
from app.services.zones import fitted_circle, polygon_centre, area_hectares, distance_m, MIN_RADIUS_M


def square(lng, lat, half_m):
    dx = half_m / 111_320.0 / 0.93      # ~cos(21deg)
    dy = half_m / 110_574.0
    return [[lng - dx, lat - dy], [lng + dx, lat - dy], [lng + dx, lat + dy], [lng - dx, lat + dy], [lng - dx, lat - dy]]


def test_centre_of_square_is_its_middle():
    clng, clat = polygon_centre(square(79.15, 21.03, 100))
    assert abs(clng - 79.15) < 1e-4 and abs(clat - 21.03) < 1e-4


def test_circle_covers_every_vertex_with_margin():
    ring = square(79.15, 21.03, 100)
    c = fitted_circle(ring, buffer=0.15)
    for lng, lat in ring:
        assert distance_m(c["centre"][0], c["centre"][1], lng, lat) <= c["radius_m"]
    # square half-diagonal = 100*sqrt(2) ~ 141 m; with 15 % buffer ~ 163 m
    assert 150 < c["radius_m"] < 175


def test_similar_farms_get_similar_circles_and_bigger_farms_bigger():
    a = fitted_circle(square(79.1, 21.0, 100))["radius_m"]
    b = fitted_circle(square(79.2, 21.1, 100))["radius_m"]
    big = fitted_circle(square(79.1, 21.0, 300))["radius_m"]
    assert abs(a - b) < 5 and big > 2.5 * a


def test_tiny_farm_has_minimum_radius():
    assert fitted_circle(square(79.1, 21.0, 2))["radius_m"] == MIN_RADIUS_M


def test_circle_polygon_is_closed_and_adapts_to_edits():
    c1 = fitted_circle(square(79.15, 21.03, 100))
    c2 = fitted_circle(square(79.15, 21.03, 200))          # boundary edited larger
    assert c1["polygon"][0] == c1["polygon"][-1]
    assert c2["radius_m"] > c1["radius_m"]


def test_irregular_polygon_uses_farthest_point():
    ring = [[79.15, 21.03], [79.152, 21.03], [79.152, 21.0305], [79.15, 21.0305], [79.15, 21.03]]
    ring2 = ring[:2] + [[79.156, 21.0302]] + ring[2:]       # one far corner
    assert fitted_circle(ring2)["radius_m"] > fitted_circle(ring)["radius_m"]


def test_area_hectares_reasonable():
    assert 3.5 < area_hectares(square(79.15, 21.03, 100)) < 4.5   # 200 m x 200 m = 4 ha
