# LiveArea Designer

**LiveArea Designer v1.11 (PS Vita homebrew, experimental pre-release)**

A lightweight native SDL2 homebrew for prototyping PS Vita LiveArea card and button layouts. Position and resize a button in pixel units relative to the card, import independent card/button images and choose solid-color presets. No VitaGL/Aurora-Vita dependency is required.

**Download:** [GitHub releases](https://github.com/robin994/LiveAreaDesigner/releases) (download `LIVAREA01.vpk` from the v1.11 release assets).

This is a visual editor/simulator, **not** a tool that installs or modifies system LiveArea layouts. The example card geometry is provisional and layout/XML export is not implemented yet.

## Installation

1. Download `LIVAREA01.vpk` from the [releases page](https://github.com/robin994/LiveAreaDesigner/releases).
2. Copy it onto your PS Vita storage using VitaShell USB or FTP.
3. Open the VPK in VitaShell and confirm installation.
4. Start **LiveArea Designer** from the Vita LiveArea.

Application title ID: `LIVAREA01`. Updating over an existing installation preserves `ux0:data/LiveAreaDesigner/settings.ini`.

Only the **front touchscreen** controls the editor and settings. The rear touchpad is disabled in SDL2 and any indirect touch events are ignored. A drag is tied to its initiating front finger so unrelated fingers cannot interrupt it.

## Settings: images and color presets

Press **START** or tap **SETTINGS** on the top-right of the editor.

- **Card Image > Browse:** choose a `.png`, `.jpg`, or `.jpeg` from the Vita filesystem.
- **Button Image > Browse:** choose an independent image for the movable and resizable rectangle.
- **Clear:** remove the selected card/button image and return to the selected solid color.
- **Card Color / Button Color:** independently choose from 10 preset colors (Purple, Magenta, Blue, Cyan, Green, Yellow, Orange, Red, White, Slate) with the D-pad or by touching a swatch.
- **Live Preview:** inspect the current card and button images, layout, and colors while editing settings.
- **Save and Close:** persist the image paths, selected colors, and rectangle geometry to `ux0:data/LiveAreaDesigner/settings.ini`. Settings are also saved when leaving the screen or quitting the homebrew, not on every D-pad tick.

For PNG transparency, the selected color appears underneath transparent pixels. An opaque image covers the selected solid color.

The browser starts with the storage volumes that are accessible on the console (`ux0:`, `uma0:`, `imc0:`, `ur0:`, etc.). It lists directories and PNG/JPG files only. Use **X** to enter/select, **O** to go up, or **Triangle** to cancel. Touch selection is supported.

To add images conveniently, connect to VitaShell FTP and upload assets to a folder such as `ux0:data/LiveAreaDesigner/assets/` (create the `assets` subfolder first). Then open it through Settings > Browse. The homebrew does not move, edit, or delete your source images.

**Image limits:** maximum 12 MiB on disk, maximum 2048 x 2048 px per image. Larger or unreadable images are rejected; a previously loaded image is kept if a replacement fails.

## Coordinate system

- PS Vita display: **960 x 544** physical pixels.
- Sample card: screen `(60,44)`, size **840 x 480** pixels. These are POC placeholders until we select the exact LiveArea template and its official geometry.
- Button rectangle (`x`, `y`, `w`, `h`) uses **card-relative** pixels, with `(0,0)` at the top-left of the card.
- Right offset = `840 - x - w`; bottom offset = `480 - y - h`.
- Rectangle movement and resize are constrained to the card.

## Controls

| Control | Action |
|---|---|
| Touch and drag within rectangle | Move |
| Touch and drag yellow bottom-right grip | Resize |
| Triangle | Toggle Move / Resize |
| D-pad | Edit X/Y or W/H by 1 px |
| Hold R + D-pad | Edit by 10 px |
| Start / top-right Settings | Open settings |
| Circle (editor) | Save and exit |
| Settings D-pad Up/Down | Select row |
| Settings D-pad Left/Right | Change preset on a color row |
| Settings X / Circle | Select / close and save |
| Settings Square on image row | Clear the chosen image |
| File browser D-pad + X / Circle | Navigate + enter / go up |
| File browser Triangle | Cancel image selection |
| Desktop mouse | Drag / resize |
| Desktop F1, Tab, arrows, Enter, Escape | Settings, editor mode, navigate, select, go back |

The top HUD shows **X, Y, W, H, R, B** in real pixels. The lower HUD indicates the current control mode. The initial card art is a placeholder; importing a custom card image replaces it in the preview.

## Build from source

Prerequisites: **VitaSDK**, CMake (3.16+), VitaSDK SDL2 and SDL2_image with PNG/JPEG/WebP, zlib and pthread static dependencies. macOS/Linux with the VitaSDK cross-toolchain is supported as a build environment.

```sh
git clone https://github.com/robin994/LiveAreaDesigner.git
cd LiveAreaDesigner
export VITASDK=/usr/local/vitasdk
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j8
```

Output: `build/LIVAREA01.vpk` (Title ID `LIVAREA01`, version `01.11`). The VitaSDK build has been verified; the newest touch-input change has not yet been independently validated on console.

## Host smoke test (filesystem/navigation only)

```sh
mkdir -p build/host-test
clang -std=c99 -Wall -Wextra -Werror -Itests/mocks -Isrc src/assets.c tests/assets_smoke.c -o build/host-test/assets_smoke
build/host-test/assets_smoke
```

## Next steps

Use exact geometry from the chosen LiveArea template, support multiple buttons, and export positioning data to a LiveArea layout format after validating its schema.

## License

[MIT](LICENSE). This independent homebrew is not affiliated with Sony Interactive Entertainment.
