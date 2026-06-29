#!/usr/bin/env python3
from __future__ import annotations

import math
import random
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1920, 1080
FPS = 30
DURATION = 35.0
ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
FRAMES = OUT / "frames"
QC = OUT / "qc"

FONT_REG = "/System/Library/Fonts/STHeiti Light.ttc"
FONT_BOLD = "/System/Library/Fonts/STHeiti Medium.ttc"
LOGO = ROOT / "apps/web/public/fareast-logo.png"
SHOTS = [
    ROOT / "design/moxj6cs4-image.png",
    ROOT / "design/mp21gpr4-image.png",
    ROOT / "design/mp21s2po-image.png",
    ROOT / "design/mp21rxwq-image.png",
    ROOT / "design/mp21wis5-image.png",
]


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    path = FONT_BOLD if bold else FONT_REG
    return ImageFont.truetype(path, size=size)


F = {
    "hero": font(90, True),
    "big": font(68, True),
    "mid": font(42, True),
    "body": font(28),
    "small": font(21),
    "mono": font(18),
}


def clamp(v: float, lo: float = 0, hi: float = 1) -> float:
    return max(lo, min(hi, v))


def seg(t: float, a: float, b: float) -> float:
    return clamp((t - a) / (b - a))


def ease(p: float) -> float:
    p = clamp(p)
    return 1 - pow(1 - p, 3)


def rgba_layer() -> Image.Image:
    return Image.new("RGBA", (W, H), (0, 0, 0, 0))


def paste_alpha(base: Image.Image, layer: Image.Image) -> None:
    base.alpha_composite(layer)


def text_size(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.FreeTypeFont) -> tuple[int, int]:
    box = draw.textbbox((0, 0), text, font=fnt)
    return box[2] - box[0], box[3] - box[1]


def draw_center(draw: ImageDraw.ImageDraw, y: int, text: str, fnt: ImageFont.FreeTypeFont, fill=(255, 255, 255, 255), x=W // 2) -> None:
    tw, th = text_size(draw, text, fnt)
    draw.text((x - tw // 2, y - th // 2), text, font=fnt, fill=fill)


def rounded_shadow(canvas: Image.Image, box: tuple[int, int, int, int], radius: int = 28, blur: int = 24) -> ImageDraw.ImageDraw:
    shadow = rgba_layer()
    d = ImageDraw.Draw(shadow)
    x1, y1, x2, y2 = box
    d.rounded_rectangle((x1, y1 + 18, x2, y2 + 18), radius=radius, fill=(0, 0, 0, 170))
    shadow = shadow.filter(ImageFilter.GaussianBlur(blur))
    paste_alpha(canvas, shadow)
    return ImageDraw.Draw(canvas)


def gradient_button(canvas: Image.Image, box: tuple[int, int, int, int], label: str, pulse: float = 0) -> None:
    x1, y1, x2, y2 = box
    w, h = x2 - x1, y2 - y1
    grad = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    for x in range(w):
        r = x / max(1, w - 1)
        if r < 0.55:
            q = r / 0.55
            col = (22, int(220 - 50 * q), int(230 + 25 * q), 255)
        else:
            q = (r - 0.55) / 0.45
            col = (int(42 + 205 * q), int(170 - 110 * q), 255, 255)
        gd.line((x, 0, x, h), fill=col)
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w, h), radius=h // 2, fill=255)
    glow = Image.new("RGBA", (w + 80, h + 80), (0, 0, 0, 0))
    ImageDraw.Draw(glow).rounded_rectangle((40, 40, w + 40, h + 40), radius=h // 2, fill=(95, 80, 255, int(80 + 80 * pulse)))
    glow = glow.filter(ImageFilter.GaussianBlur(24))
    canvas.alpha_composite(glow, (x1 - 40, y1 - 40))
    canvas.paste(grad, (x1, y1), mask)
    d = ImageDraw.Draw(canvas)
    draw_center(d, y1 + h // 2 - 2, label, F["small"], (255, 255, 255, 255), x=x1 + w // 2)


def fit_image(path: Path, size: tuple[int, int]) -> Image.Image:
    img = Image.open(path).convert("RGB")
    img.thumbnail(size, Image.Resampling.LANCZOS)
    out = Image.new("RGB", size, (238, 242, 246))
    out.paste(img, ((size[0] - img.width) // 2, (size[1] - img.height) // 2))
    return out


SCREENSHOTS = [fit_image(p, (680, 390)) for p in SHOTS]
LOGO_IMG = Image.open(LOGO).convert("RGBA")
LOGO_IMG.thumbnail((410, 90), Image.Resampling.LANCZOS)

random.seed(42)
STARS = [(random.randrange(W), random.randrange(H), random.random(), random.random()) for _ in range(560)]


def background(t: float) -> Image.Image:
    img = Image.new("RGBA", (W, H), (4, 4, 8, 255))
    d = ImageDraw.Draw(img)
    for y in range(H):
        k = y / H
        d.line((0, y, W, y), fill=(int(2 + 6 * k), int(2 + 4 * k), int(6 + 11 * k), 255))
    for x, y, s, phase in STARS:
        twinkle = 0.35 + 0.65 * abs(math.sin(t * 0.7 + phase * 6.28))
        alpha = int((36 + 110 * s) * twinkle)
        yy = int((y + t * (6 + s * 9)) % H)
        r = 1 if s < 0.9 else 2
        d.ellipse((x - r, yy - r, x + r, yy + r), fill=(255, 255, 255, alpha))
    glow = rgba_layer()
    gd = ImageDraw.Draw(glow)
    for i in range(16):
        a = int(36 * (1 - i / 16))
        gd.ellipse((-120 + i * 8, H - 210 - i * 9, W + 120 - i * 8, H + 110 + i * 5), fill=(76, 25, 255, a))
    paste_alpha(img, glow.filter(ImageFilter.GaussianBlur(18)))
    return img


def logo_lockup(canvas: Image.Image, x: int, y: int, scale: float = 1.0) -> None:
    w, h = int(LOGO_IMG.width * scale), int(LOGO_IMG.height * scale)
    logo = LOGO_IMG.resize((w, h), Image.Resampling.LANCZOS)
    box = (x - 18, y - 14, x + w + 18, y + h + 14)
    d = rounded_shadow(canvas, box, 10, 14)
    d.rounded_rectangle(box, radius=10, fill=(255, 255, 255, 236), outline=(255, 255, 255, 80), width=1)
    canvas.alpha_composite(logo, (x, y))


def draw_prompt(canvas: Image.Image, t: float) -> None:
    p = ease(seg(t, 5.5, 7.0))
    x = int(250 + (1 - p) * -220)
    y = int(345 + (1 - p) * 80)
    box = (x, y, x + 1420, y + 250)
    d = rounded_shadow(canvas, box, 24, 24)
    d.rounded_rectangle(box, radius=24, fill=(18, 18, 22, 238), outline=(255, 255, 255, 45), width=2)
    d.text((x + 44, y + 34), "输入监测任务", font=F["small"], fill=(220, 226, 236, 230))
    full = "持续监测电线电缆、储能、铜锂行情与竞品风险"
    typed = full[: int(len(full) * ease(seg(t, 6.1, 7.8)))]
    d.text((x + 44, y + 86), typed, font=F["mid"], fill=(255, 255, 255, 255))
    d.text((x + 46, y + 160), "T1/T2/T3 信源 · C1/C2/C3 关注圈 · 6 小时自动抓取", font=F["small"], fill=(180, 188, 202, 220))
    gradient_button(canvas, (x + 1125, y + 142, x + 1358, y + 205), "启动雷达", pulse=seg(t, 8.0, 8.8))
    if t > 8.0:
        d.polygon([(x + 1266, y + 218), (x + 1296, y + 252), (x + 1270, y + 258)], fill=(255, 255, 255, 245))


def card(canvas: Image.Image, img: Image.Image, x: int, y: int, w: int, h: int, title: str, alpha: int = 255) -> None:
    layer = Image.new("RGBA", (w + 44, h + 76), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle((22, 20, w + 22, h + 52), radius=18, fill=(16, 17, 22, alpha), outline=(255, 255, 255, min(alpha, 52)), width=2)
    shot = img.resize((w - 32, h - 84), Image.Resampling.LANCZOS).convert("RGBA")
    layer.alpha_composite(shot, (38, 64))
    d.text((42, 34), title, font=F["mono"], fill=(255, 255, 255, alpha))
    shadow = layer.filter(ImageFilter.GaussianBlur(12))
    canvas.alpha_composite(shadow, (x - 6, y + 12))
    canvas.alpha_composite(layer, (x, y))


def scene_cards(canvas: Image.Image, t: float) -> None:
    p = ease(seg(t, 9.5, 14.5))
    specs = [
        (SCREENSHOTS[0], 110, 550 - int(90 * p), 560, 340, "Dashboard"),
        (SCREENSHOTS[1], 620, 265 - int(25 * p), 680, 400, "Timeline"),
        (SCREENSHOTS[2], 1280, 500 - int(120 * p), 520, 320, "Item Detail"),
        (SCREENSHOTS[3], 360, 190 + int(70 * p), 440, 300, "Daily Digest"),
        (SCREENSHOTS[4], 1050, 150 + int(50 * p), 550, 300, "Search"),
    ]
    for i, spec in enumerate(specs):
        img, x, y, w, h, title = spec
        card(canvas, img, x + int(math.sin(t + i) * 16), y, w, h, title)
    d = ImageDraw.Draw(canvas)
    draw_center(d, 142, "1,284 条情报正在汇聚", F["big"], (255, 255, 255, 245))


def app_window(canvas: Image.Image, t: float) -> None:
    p = ease(seg(t, 14.5, 17.0))
    x, y = 260, int(360 - 120 * p)
    w, h = 1400, 720
    d = rounded_shadow(canvas, (x, y, x + w, y + h), 30, 28)
    d.rounded_rectangle((x, y, x + w, y + h), radius=30, fill=(16, 17, 21, 248), outline=(255, 255, 255, 50), width=2)
    d.rounded_rectangle((x, y, x + w, y + 68), radius=30, fill=(26, 27, 33, 255))
    for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        d.ellipse((x + 28 + i * 28, y + 26, x + 42 + i * 28, y + 40), fill=c + (255,))
    d.text((x + 80, y + 98), "FE-Radar Timeline", font=F["mid"], fill=(255, 255, 255, 255))
    stats = [("全量", "1,284"), ("C1+C2", "42"), ("自家告警", "7"), ("下次抓取", "06:00")]
    for i, (lab, val) in enumerate(stats):
        sx = x + 84 + i * 300
        d.rounded_rectangle((sx, y + 175, sx + 240, y + 275), radius=8, fill=(239, 242, 246, 255))
        d.text((sx + 24, y + 195), lab, font=F["small"], fill=(90, 96, 106, 255))
        d.text((sx + 24, y + 224), val, font=F["mid"], fill=((205, 76, 68, 255) if i == 2 else (20, 24, 30, 255)))
    rows = [
        ("国家能源局", "新型储能并网管理办法发布", "政策突发", "88"),
        ("巨潮公告", "竞品中标高压电缆项目", "竞品动态", "76"),
        ("SMM", "电解铜现货升水继续回落", "铜锂行情", "64"),
    ]
    for i, row in enumerate(rows):
        ry = y + 330 + i * 108
        d.rounded_rectangle((x + 84, ry, x + w - 84, ry + 82), radius=10, fill=(246, 248, 250, 255), outline=(220, 226, 235, 255))
        d.text((x + 118, ry + 18), row[0], font=F["mono"], fill=(90, 96, 106, 255))
        d.text((x + 118, ry + 42), row[1], font=F["body"], fill=(24, 27, 33, 255))
        d.text((x + 820, ry + 30), row[2], font=F["small"], fill=(25, 111, 125, 255))
        d.text((x + 1190, ry + 20), row[3], font=F["mid"], fill=(21, 120, 104, 255))
    draw_center(d, 210, "内网部署 · 统一入口", F["big"], (255, 255, 255, int(255 * seg(t, 15.0, 16.0))))


def pill(d: ImageDraw.ImageDraw, x: int, y: int, text: str, fill=(42, 44, 52, 235), outline=(255, 255, 255, 50)) -> None:
    tw, th = text_size(d, text, F["small"])
    d.rounded_rectangle((x, y, x + tw + 42, y + 48), radius=24, fill=fill, outline=outline, width=1)
    d.text((x + 21, y + 11), text, font=F["small"], fill=(255, 255, 255, 235))


def ecosystem(canvas: Image.Image, t: float) -> None:
    d = ImageDraw.Draw(canvas)
    cx, cy = W // 2, 540
    r = 160 + int(22 * math.sin(t * 2))
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(20, 21, 25, 248), outline=(255, 255, 255, 45), width=2)
    draw_center(d, cy - 22, "精选信源", F["mid"])
    draw_center(d, cy + 34, "Source First", F["small"], (170, 178, 192, 255))
    names = ["政府", "交易所", "协会", "RSS", "Firecrawl", "行情", "dataPro", "WebSearch"]
    p = ease(seg(t, 17.0, 20.5))
    for i, name in enumerate(names):
        a = -math.pi * 0.85 + i * (math.pi * 1.7 / (len(names) - 1)) + t * 0.08
        rr = 360 + 70 * math.sin(i)
        x = int(cx + math.cos(a) * rr - 72)
        y = int(cy + math.sin(a) * rr - 22)
        if i / len(names) < p:
            pill(d, x, y, name)
            d.line((cx + int(math.cos(a) * r), cy + int(math.sin(a) * r), x + 72, y + 24), fill=(255, 255, 255, 48), width=2)
    draw_center(d, 170, "信源比信息重要", F["big"], (255, 255, 255, 245))


def capability_ring(canvas: Image.Image, t: float) -> None:
    d = ImageDraw.Draw(canvas)
    cx, cy = W // 2, 540
    labels = ["去重", "NER", "五维评分", "聚簇", "C1 告警", "C2 风险", "脱敏", "日报"]
    for i, lab in enumerate(labels):
        a = t * 0.45 + i * math.tau / len(labels)
        rr = 310 + 26 * math.sin(t + i)
        x = int(cx + math.cos(a) * rr)
        y = int(cy + math.sin(a) * rr)
        size = int(116 + 24 * (1 + math.sin(a)) / 2)
        d.ellipse((x - size // 2, y - size // 2, x + size // 2, y + size // 2), fill=(32, 33, 39, 238), outline=(255, 255, 255, 45), width=2)
        draw_center(d, y, lab, F["small"], x=x)
    draw_center(d, 514, "8 阶段 Pipeline", F["mid"])
    draw_center(d, 570, "规则先行 · LLM 只做语言任务", F["small"], (178, 186, 202, 255))
    draw_center(d, 170, "从信息流到告警", F["big"], (255, 255, 255, 245))


def export_burst(canvas: Image.Image, t: float) -> None:
    d = ImageDraw.Draw(canvas)
    draw_center(d, 250, "高价值情报", F["big"])
    gradient_button(canvas, (1160, 216, 1390, 282), "生成简报", pulse=seg(t, 25.2, 26.0))
    x, y = 760, 520
    d.rounded_rectangle((x, y, x + 400, y + 220), radius=28, fill=(18, 19, 23, 245), outline=(255, 255, 255, 65), width=2)
    d.rounded_rectangle((x + 40, y - 52, x + 214, y + 20), radius=22, fill=(20, 21, 25, 245), outline=(255, 255, 255, 60), width=2)
    labels = ["Timeline", "Alerts", "Daily", "DOCX", "DingTalk", "Dashboard"]
    p = ease(seg(t, 27.2, 30.5))
    for i, lab in enumerate(labels):
        a = -math.pi * 0.9 + i * math.pi * 1.8 / (len(labels) - 1)
        rr = 80 + 380 * p
        px = int(x + 200 + math.cos(a) * rr)
        py = int(y + 70 + math.sin(a) * rr)
        color = (22, 220, 230, 245) if i % 2 == 0 else (205, 72, 255, 245)
        pill(d, px - 82, py - 24, lab, fill=color, outline=(255, 255, 255, 70))


def final_claim(canvas: Image.Image, t: float) -> None:
    d = ImageDraw.Draw(canvas)
    logo_lockup(canvas, 80, 90, 0.74)
    if t < 31.5:
        text = "信源驱动"
    elif t < 32.6:
        text = "风险先到"
    else:
        text = "产业情报雷达"
    draw_center(d, 520, text, F["hero"], (255, 255, 255, 255))
    draw_center(d, 632, "FE-Radar · Far East Holding Group", F["small"], (176, 184, 198, 255))


def frame(t: float) -> Image.Image:
    img = background(t)
    d = ImageDraw.Draw(img)
    if t < 5.5:
        phrases = [
            (0.0, 1.4, "FE-Radar"),
            (1.0, 2.4, "产业情报雷达"),
            (2.0, 3.3, "不是刷新闻"),
            (3.0, 5.5, "是可执行的风险信号"),
        ]
        for a, b, text in phrases:
            p = seg(t, a, b)
            if p > 0 and p < 1:
                xoff = int((1 - ease(p)) * 120)
                alpha = int(255 * min(seg(t, a, a + 0.35), 1 - seg(t, b - 0.35, b)))
                draw_center(d, 500, text, F["hero"], (255, 255, 255, alpha), x=W // 2 + xoff)
        logo_lockup(img, 730, 690, 0.78)
    elif t < 9.5:
        draw_prompt(img, t)
    elif t < 14.5:
        scene_cards(img, t)
    elif t < 17.0:
        app_window(img, t)
    elif t < 20.5:
        ecosystem(img, t)
    elif t < 24.5:
        capability_ring(img, t)
    elif t < 30.5:
        export_burst(img, t)
    else:
        final_claim(img, t)
    return img.convert("RGB")


def make_contact(paths: list[Path], out: Path) -> None:
    thumbs = []
    for path in paths:
        im = Image.open(path).convert("RGB")
        im.thumbnail((426, 240), Image.Resampling.LANCZOS)
        thumbs.append((path, im.copy()))
    canvas = Image.new("RGB", (4 * 456 + 30, 3 * 290 + 64), (10, 10, 12))
    d = ImageDraw.Draw(canvas)
    d.text((24, 18), "FE-Radar product showcase sampled frames", font=F["small"], fill=(255, 255, 255))
    for i, (path, im) in enumerate(thumbs):
        x = 24 + (i % 4) * 456
        y = 64 + (i // 4) * 290
        canvas.paste(im, (x, y))
        d.text((x, y + 250), path.stem.replace("frame_", "") + "s", font=F["mono"], fill=(205, 212, 224))
    canvas.save(out, quality=90)


def main() -> None:
    FRAMES.mkdir(parents=True, exist_ok=True)
    QC.mkdir(parents=True, exist_ok=True)
    total = int(DURATION * FPS)
    sample_times = [0, 2.5, 5, 7.5, 10, 12.5, 15, 17.5, 21, 25, 28.5, 32.5]
    sample_paths: list[Path] = []
    for i in range(total):
        t = i / FPS
        out = FRAMES / f"frame_{i:04d}.jpg"
        frame(t).save(out, quality=90, subsampling=1)
        if any(abs(t - s) < 0.017 for s in sample_times):
            sample = QC / f"frame_{t:.1f}.jpg"
            frame(t).save(sample, quality=92)
            sample_paths.append(sample)
    (QC / "first-frame.jpg").write_bytes((FRAMES / "frame_0000.jpg").read_bytes())
    make_contact(sample_paths, QC / "contact-sheet.jpg")
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-framerate",
            str(FPS),
            "-i",
            str(FRAMES / "frame_%04d.jpg"),
            "-f",
            "lavfi",
            "-i",
            "anullsrc=channel_layout=stereo:sample_rate=48000",
            "-shortest",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-r",
            str(FPS),
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            str(OUT / "fe-radar-product-showcase.mp4"),
        ],
        check=True,
    )
    print(OUT / "fe-radar-product-showcase.mp4")


if __name__ == "__main__":
    main()
