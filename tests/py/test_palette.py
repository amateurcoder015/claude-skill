import json

from conftest import run_script

import palette


def hex_to_rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def test_dominant_colors_finds_distinct_colors():
    pixels = bytes([250, 10, 10] * 60 + [10, 10, 250] * 30 + [245, 12, 12] * 10)
    colors = palette.dominant_colors(pixels, k=5)
    assert len(colors) == 2
    assert colors[0][0] > 200 and colors[1][2] > 200


def test_assign_roles_contrast_rules():
    roles = palette.assign_roles([(200, 200, 200), (40, 120, 220), (90, 90, 90)])
    assert palette.luminance(hex_to_rgb(roles["bg"])) <= 0.08
    assert palette.luminance(hex_to_rgb(roles["fg"])) >= 0.75
    assert roles["accent"] == "#2878dc"


def test_assign_roles_grey_video_gets_default_accent():
    roles = palette.assign_roles([(30, 30, 30), (128, 128, 128)])
    assert roles["accent"] == "#e8c37a"


def test_assign_roles_empty():
    assert palette.assign_roles([]) == {"bg": "#0b0b0f", "accent": "#e8c37a", "fg": "#f5f3ee", "colors": []}


def test_palette_sample(workdir):
    proc = run_script("palette.py", workdir)
    assert proc.returncode == 0, proc.stderr
    roles = json.loads((workdir / "palette.json").read_text())
    assert roles["accent"] == "#f80808"
    assert palette.luminance(hex_to_rgb(roles["bg"])) <= 0.08
    assert palette.luminance(hex_to_rgb(roles["fg"])) >= 0.75
