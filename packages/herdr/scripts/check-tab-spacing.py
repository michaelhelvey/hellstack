# /// script
# requires-python = ">=3.12"
# dependencies = ["pillow"]
# ///
"""Check the visible space above and below a tab tray in a Herdr screenshot."""

import argparse
import subprocess
import tempfile
from pathlib import Path

from PIL import Image


def transition(pixels: list, start: int, color: tuple, equal: bool) -> int:
    """Find the first pixel that matches the requested color condition."""
    for index in range(start, len(pixels)):
        if (pixels[index] == color) == equal:
            return index
    raise ValueError("No tab tray and pane border found at this x coordinate.")


def measure(image: Image.Image, x: int) -> tuple[int, int]:
    """Measure the background gaps before the tray and before the pane border."""
    pixels = [image.getpixel((x, y)) for y in range(min(image.height, 200))]
    background = pixels[0]
    top = transition(pixels, 0, background, False)
    bottom = transition(pixels, top, background, True)
    pane = transition(pixels, bottom, background, False)
    return top, pane - bottom


def capture(path: Path) -> None:
    """Save the current Herdr frame to a file."""
    subprocess.run(
        ["herdr-app", "shot", str(path)],
        check=True,
        timeout=10,
        capture_output=True,
    )


def gaps(image_path: Path | None, x: int) -> tuple[int, int]:
    """Measure a saved image, or capture the current Herdr frame and measure it."""
    with tempfile.TemporaryDirectory(prefix="herdr-spacing-") as directory:
        path = image_path or Path(directory) / "frame.png"
        if not image_path:
            capture(path)
        with Image.open(path) as image:
            return measure(image.convert("RGB"), x)


def main() -> None:
    """Check a saved image or capture the current Herdr frame."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--x", type=int, required=True, help="A column through a tab tray."
    )
    parser.add_argument("--image", type=Path, help="Use a saved screenshot.")
    args = parser.parse_args()
    top, bottom = gaps(args.image, args.x)
    print(f"Above tray: {top}px. Below tray: {bottom}px.")
    if abs(top - bottom) > 1:
        raise SystemExit("The tab tray is not vertically centered.")
    print("The tray is centered within one physical pixel.")


if __name__ == "__main__":
    main()
