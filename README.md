# LiveArea Designer

**PS Vita LiveArea editor — v1.22, RCO-based template preview.** Open-source C/SDL2 homebrew and a matching static web editor.

[**Web editor**](https://robin994.github.io/LiveAreaDesigner/) · [**GitHub releases**](https://github.com/robin994/LiveAreaDesigner/releases) · [**Source code**](https://github.com/robin994/LiveAreaDesigner)

## What it does

LiveArea Designer helps homebrew authors prototype the images and layout of a PS Vita LiveArea page. The simulator has a **960 × 544** screen and a **840 × 500** card whose top 44 pixels are reserved for system controls. The editable **frame image/button** stays out of that area.

- Position/resize an image with touch, mouse, D-pad or numeric inputs.
- **Signed coordinates relative to the center of the card:** (0, 0) at the center; left/up negative, right/down positive.
- **Fixed aspect ratio** mode to prevent image distortion.
- **Transparent button background** mode. Transparent PNG pixels remain transparent in the indexed PNG8 export; JPG content remains opaque.
- Import PNG/JPG for the card background, movable frame button, fixed startup gate, plus optional bubble icon and bootscreen.
- Pick ten default colors and display frame sizes/offsets.
- Choose one LiveArea style and frame, with optional target URI, text, language restriction, age limit, Vita-only model and autoflip (see notes below).
- Save **template.xml** and an accompanying export of **8-bit indexed PNG assets** (up to 225 palette entries including a transparent slot).
- Add optional **manual pages**, packaged in numerical order starting at `sce_sys/manual/001.png`.
- **Preview Template** draws the firmware's real, fixed layout slots for **19 styles**. Every frame is visible; its slot dimensions, native position and the gate center come from the PS Vita RCOF `layout_hint` records. Continue moving or resizing the liveitem while previewing; XML uses the selected frame's coordinates.

The preview uses **actual slot geometry**, but is **not** a pixel-perfect emulation of Sony's rendered LiveArea: system graphics, clipping, animations and reserved elements are not fully simulated. Moving the custom frame image does not move the actual startup gate. Test and adjust the exported XML on a real PS Vita.

## Web editor / GitHub Pages

**https://robin994.github.io/LiveAreaDesigner/**

Everything runs in your browser; images never leave your computer. Choose PNG/JPG assets through the normal file picker or drag-and-drop. Layout settings use localStorage, images use IndexedDB. Supported on modern desktop and mobile browsers; the Vita's built-in browser is not a target.

**Template preview:** click **Preview Template** above the canvas (or press **P**) to switch between the freeform editor and the RCO-based layout. Changing `Layout Style` now changes the actual visual arrangement and count of frames (e.g. `a1` has 3 slots, `a3` has 5 and `a5` has 7). Click any visible frame to select it, then drag/resize the liveitem or press **Fit image to selected frame** to center it and shrink it if needed. The selected frame is outlined in gold, an out-of-frame image in red. **Export PNG Preview** captures the active mode, and the preview flag and layout settings persist after refresh.

The preview reads slot position/size metadata exported from `vs0:/vsh/shell/livearea/*.rco` on a PS Vita (19 native styles). Frame center coordinates are card-relative in the editor; the XML generator subtracts the **selected frame's RCO center**, so `x` and `y` are frame-relative. Changing styles does not silently move the custom image: use **Fit image to selected frame** to reposition it intentionally. Some system-specific frames expose dynamic dimensions; those show a `DYNAMIC` marker, and automatic fitting is unavailable.

The web app can download a standalone `template.xml` and **Export LiveArea Assets (.zip)**, which contains:

```text
sce_sys/
  icon0.png           # optional, 128 x 128
  pic0.png            # optional, 960 x 544
  livearea/
    contents/
      template.xml
      bg0.png          # 840 x 500, indexed PNG8
      startup.png      # 280 x 158, indexed PNG8 with transparency
      button.png       # selected frame dimensions, indexed PNG8, optional transparency
  manual/
    001.png            # optional, 960 x 544
    002.png
```

A gate is fixed by the chosen LiveArea style. For example, `a1` centers the startup image; `psmobile` places it to the right. Other styles listed in the tutorial include system-specific layouts whose additional built-in functionality may not work for third-party homebrew.

The web app exports a single custom liveitem in the selected frame. A frame can link to a website or supported Vita URI using the `target` field. If you leave the default `https://example.com`, replace that URL before publishing your VPK.

PNG assets use a quantized indexed palette. Colors are approximated and alpha is binary (fully transparent or opaque) rather than full 8-bit per-pixel opacity. Optional `icon0.png` and `pic0.png` are exported only after an image is selected.

## PS Vita native homebrew

Install the `LIVAREA01.vpk` from [Releases](https://github.com/robin994/LiveAreaDesigner/releases). Title ID: `LIVAREA01`. A local config is saved to `ux0:data/LiveAreaDesigner/settings.ini`. Only the **front touchscreen** is accepted; the rear panel is ignored.

### Controls

| Input | Action |
| --- | --- |
| Front touch / drag | Move the frame image |
| Front touch / yellow grip | Resize |
| Triangle | Toggle Move / Resize |
| D-pad | Move or resize by 1 pixel |
| Hold R + D-pad | Change by 10 pixels |
| SELECT in the editor | Toggle **Preview Template** |
| Square while template preview is active | Cycle LiveArea style |
| L while template preview is active | Cycle all frames available to the selected style |
| Cross while template preview is active | Center/fit the image inside the selected frame |
| Start | Open/close Settings |
| L / R in Settings | Switch between Colors and XML + Assets tabs |
| XML + Assets > Preview | Toggle template preview, including the Settings mini-preview |
| Front touch on a different frame | Select that frame (inside the editor or Settings mini-preview) |
| D-pad + Cross | Navigate / select options / browse |
| Square on image row | Clear image |
| Cross on XML + Assets > Export | Save XML and PNG8 assets |
| XML + Assets > Select Manual Folder | Browse to a directory; press **Square** to use it |
| Circle | Back / save / exit |

In the XML + Assets tab, select gate, icon0 and pic0 images, LiveArea style, frame, aspect-lock and transparency options. The persisted preview flag is `preview_template=1` when active. Frame link, text, language, age, Vita-only and autoflip are loaded/saved in the editable `settings.ini` keys:

```ini
frame_target=https://example.com
frame_text=
frame_lang=
age_limit=0
vita_only=0
autoflip=0
preview_template=1
```

**Native export destination:**

```text
ux0:data/LiveAreaDesigner/export/sce_sys/livearea/contents/template.xml
ux0:data/LiveAreaDesigner/export/sce_sys/livearea/contents/bg0.png
ux0:data/LiveAreaDesigner/export/sce_sys/livearea/contents/startup.png
ux0:data/LiveAreaDesigner/export/sce_sys/livearea/contents/button.png
```

Optional `icon0.png`, `pic0.png` and `manual/001.png...` are saved alongside this folder tree. The native app does **not** change installed apps or the Vita's system LiveArea: copy the exported assets into your homebrew project, rebuild its VPK and install or refresh its LiveArea through normal developer workflows.

**Image constraints:** maximum 12 MiB per imported PNG/JPG, dimensions no larger than 2048 × 2048. Assets are scaled into their required output size; keep your originals for best image quality. The XML is not a promise that an arbitrary chosen LiveArea style has a usable frame at every position.

## Build from source

Requirements: VitaSDK, CMake >= 3.16, SDL2, SDL2_image, libpng, libjpeg, zlib, pthread, WebP static dependencies.

```sh
git clone https://github.com/robin994/LiveAreaDesigner.git
cd LiveAreaDesigner
export VITASDK=/usr/local/vitasdk
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j8
```

Output: `build/LIVAREA01.vpk` (v1.22). RCO geometry is verified against the user's own Vita firmware, but the rendered preview and newly generated XML/PNG8 assets still require end-to-end hardware testing.

Tests:

```sh
node --test tests/web-geometry.test.mjs
node tests/web-browser-smoke.mjs  # Requires Google Chrome
mkdir -p build/host-test
clang -std=c99 -Wall -Wextra -Werror -Isrc src/exporter_xml.c src/template_slots.c tests/exporter_xml_smoke.c -o build/host-test/exporter_xml_smoke
build/host-test/exporter_xml_smoke
clang -std=c99 -Wall -Wextra -Werror -Itests/mocks -Isrc src/assets.c tests/assets_smoke.c -o build/host-test/assets_smoke
build/host-test/assets_smoke
clang -std=c99 -Wall -Wextra -Werror -Isrc src/template_preview.c src/template_slots.c tests/template_preview_smoke.c -o build/host-test/template_preview_smoke
build/host-test/template_preview_smoke
```

### Regenerating the RCO layout tables

The repo includes **numeric layout metadata only**; the firmware `.rco` files are not committed or redistributed. To reproduce the tables, copy the 19 files from your own Vita's `vs0:/vsh/shell/livearea/` into a local folder, then run:

```sh
python3 tools/extract-livearea-layouts.py /path/to/your/rco-files data/livearea-layouts.json
node tools/generate-template-slots.mjs
```

This generates `docs/template-slots.mjs` and `src/template_slots.c/.h` from the same structured geometry. A gate is represented by a `layout_hint` without an explicit size; a frame has both position and dimensions. The underlying coordinate system uses positive Y upwards, whereas the editable pixel positions use positive Y downwards.

## Reference material

- [Hackinformer (Freakler): How to create a custom Livearea screen for your Homebrew](https://web.archive.org/web/20250126023851/https://forum.hackinformer.com/viewtopic.php?t=765)
- [PS Vita Developer Wiki: template.xml](https://www.psdevwiki.com/vita/Template.xml)
- [LiveArea image specifications](https://gist.github.com/Hammerill/64411eebf071b93396b7d310ba8d6776)

## Roadmap / limitations

- Refine native LiveArea clipping, shell artwork, animations and dynamic-size frame behavior beyond the current RCO geometry.
- Support multiple independently editable liveitems and language variants; a single liveitem with `autoflip` has no meaningful automatic rotation on its own.
- Add on-device text/target editing rather than requiring direct edits to `settings.ini`.
- Validate indexed PNGs and installed XML on real hardware and update compatibility notes.

[MIT license](LICENSE). Independent homebrew; not affiliated with Sony Interactive Entertainment.
