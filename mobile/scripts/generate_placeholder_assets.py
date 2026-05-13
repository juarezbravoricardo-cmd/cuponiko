"""
Genera assets placeholder para el build inicial de Cuponiko.
- icon.png 1024x1024 — fondo naranja con "C" blanca centrada
- adaptive-icon.png 1024x1024 — mismo diseño (foreground)
- splash.png 1284x2778 — fondo naranja con texto "Cuponiko" centrado
- favicon.png 48x48 — fondo naranja con "C" blanca

No son diseño final. Solo evitan que el build de EAS falle.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ORANGE = (249, 115, 22, 255)  # #F97316
WHITE = (255, 255, 255, 255)

ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets"
ASSETS_DIR.mkdir(parents=True, exist_ok=True)


def find_font(size: int) -> ImageFont.FreeTypeFont:
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
    ]
    for c in candidates:
        if Path(c).exists():
            return ImageFont.truetype(c, size)
    return ImageFont.load_default()


def draw_centered_text(img: Image.Image, text: str, font: ImageFont.FreeTypeFont, fill=WHITE):
    draw = ImageDraw.Draw(img)
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    x = (img.width - text_w) // 2 - bbox[0]
    y = (img.height - text_h) // 2 - bbox[1]
    draw.text((x, y), text, font=font, fill=fill)


def make_icon(path: Path, size: int, text: str, font_size_ratio: float = 0.55):
    img = Image.new("RGBA", (size, size), ORANGE)
    font = find_font(int(size * font_size_ratio))
    draw_centered_text(img, text, font)
    img.save(path, "PNG")
    print(f"created {path} ({size}x{size})")


def make_splash(path: Path, w: int, h: int, text: str):
    img = Image.new("RGBA", (w, h), ORANGE)
    font = find_font(int(min(w, h) * 0.10))
    draw_centered_text(img, text, font)
    img.save(path, "PNG")
    print(f"created {path} ({w}x{h})")


def main():
    make_icon(ASSETS_DIR / "icon.png", 1024, "C")
    make_icon(ASSETS_DIR / "adaptive-icon.png", 1024, "C")
    make_icon(ASSETS_DIR / "favicon.png", 48, "C", font_size_ratio=0.7)
    make_splash(ASSETS_DIR / "splash.png", 1284, 2778, "Cuponiko")


if __name__ == "__main__":
    main()
