# /// script
# requires-python = ">=3.10"
# dependencies = ["dmgbuild==1.6.7"]
# ///
"""Write the Installer layout directly to .DS_Store; no Finder or GUI session."""
from pathlib import Path
import sys

from dmgbuild import build_dmg


def settings(app, assets):
    return {
        "format": "UDZO",
        "compression_level": 9,
        "filesystem": "HFS+",
        "files": [str(app)],
        "symlinks": {"Applications": "/Applications"},
        "icon": str(assets / "app-icon" / "Polaris.icns"),
        "background": str(assets / "dmg" / "background.png"),
        "icon_locations": {"Polaris.app": (165, 190), "Applications": (495, 190)},
        # Finder's bounds include the 32pt title bar above the 660×400 content.
        "window_rect": ((100, 100), (660, 432)),
        "default_view": "icon-view",
        "include_icon_view_settings": True,
        "include_list_view_settings": False,
        "show_status_bar": False,
        "show_tab_view": False,
        "show_toolbar": False,
        "show_pathbar": False,
        "show_sidebar": False,
        "show_icon_preview": False,
        "show_item_info": False,
        "arrange_by": None,
        "grid_offset": (0, 0),
        "scroll_position": (0, 0),
        "label_pos": "bottom",
        "text_size": 12,
        "icon_size": 100,
        "hide_extensions": ["Polaris.app"],
    }


if __name__ == "__main__":
    app, assets, output = (Path(arg).resolve() for arg in sys.argv[1:])
    if not (app / "Contents" / "Info.plist").is_file():
        raise ValueError(f"not an app bundle: {app}")
    for asset in (assets / "app-icon" / "Polaris.icns", assets / "dmg" / "background.png",
                  assets / "dmg" / "background@2x.png"):
        if not asset.is_file():
            raise FileNotFoundError(asset)
    build_dmg(str(output), "Polaris", settings=settings(app, assets), lookForHiDPI=True)
