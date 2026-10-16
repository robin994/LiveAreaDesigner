# LiveArea Designer

**PS Vita LiveArea editor — v1.25, corrected Y coordinates, VPK editing, optimized PNG8 and independent LiveArea frames.** Open-source C/SDL2 homebrew and a matching static web editor.

[**Web editor**](https://robin994.github.io/LiveAreaDesigner/) · [**GitHub releases**](https://github.com/robin994/LiveAreaDesigner/releases) · [**Source code**](https://github.com/robin994/LiveAreaDesigner)

## What it does

LiveArea Designer helps homebrew authors prototype the images and layout of a PS Vita LiveArea page. The simulator has a **960 × 544** screen and a **840 × 500** card whose top 44 pixels are reserved for system controls. The editable **frame image/button** stays out of that area.

- Position/resize an image with touch, mouse, D-pad or numeric inputs.
- **Signed coordinates relative to the center of the card:** (0, 0) at the center; left/up negative, right/down positive.
- **Fixed aspect ratio** mode to prevent image distortion.
- **Transparent button background** mode. Transparent PNG pixels remain transparent in the indexed PNG8 export; JPG content remains opaque.
- Import PNG/JPG for the card background, movable frame button, fixed startup gate, plus optional bubble icon and bootscreen.
- Optional fallback colors (under **Advanced appearance**) and precise frame offsets.
- Choose one LiveArea style and frame, with optional target URI, text, language restriction, age limit, Vita-only model and autoflip (see notes below).
- Save **template.xml** and an accompanying export of **8-bit indexed PNG assets** (up to 225 palette entries including a transparent slot).
- Add optional **manual pages**, packaged in numerical order starting at `sce_sys/manual/001.png`.
- **Preview Template** draws the firmware's real, fixed layout slots for **19 styles**. Every frame is visible; each can hold its **own PNG/JPG, coordinates, dimensions, colors, text and target**. Preview displays each liveitem directly within its slot without adding an unrelated global movable rectangle. The slot itself cannot move, but its liveitem can move/resize within it.

The preview uses **actual slot geometry**, but is **not** a pixel-perfect emulation of Sony's rendered LiveArea: system graphics, clipping, animations and reserved elements are not fully simulated. Moving the custom frame image does not move the actual startup gate. Test and adjust the exported XML on a real PS Vita.

## Web editor / GitHub Pages

**https://robin994.github.io/LiveAreaDesigner/**

Everything runs in your browser; images never leave your computer. Choose PNG/JPG assets through the normal file picker or drag-and-drop. Layout settings use localStorage, images use IndexedDB. Supported on modern desktop and mobile browsers; the Vita's built-in browser is not a target.

### Edit an existing VPK in the browser

1. Click **Open VPK…** below the preview and choose a homebrew `.vpk`. The editor reads its `sce_sys/livearea/contents/template.xml` and the associated supported PNG/JPG artwork entirely in the browser.
2. Choose the frame to edit, update its image, geometry, link and text. Unrelated game files are **never exposed to the editor or edited**.
3. Click **Export modified VPK**. A newly named `<original>-livearea.vpk` is downloaded; your input file remains unchanged. The compressed `eboot.bin` and unrelated game/data entries are passed through without changing their bytes.

Imported frame images that were not replaced or resized are reused **byte for byte** where feasible, avoiding an unnecessary PNG8 recompression. A source VPK is kept in browser memory only for the current page session, so reopen it after refreshing if you need another VPK export. There is no server-side upload.

The web importer supports **non-encrypted, single-volume ZIP32 archives up to 512 MiB** and common `template.xml` fields. It intentionally rejects corrupt or unsupported ZIPs. It edits typical homebrew LiveArea templates, **not** DRM-protected packages, and does not promise to preserve arbitrary custom XML extensions, complex language variants, multiple liveitems per frame or digital signatures. Its generated `template.xml` follows the editor's single-liveitem-per-frame model. Keep a backup and test the modified VPK on your Vita.

### Image compression

PNG assets were already compressed in older releases: LiveArea Designer converts them to **indexed 8-bit PNGs (PNG8) with zlib/DEFLATE**, using a Vita-compatible format. Version 1.24 adds **Optimize PNG8 images** (on by default): unused palette colors are removed and adaptive filters are used to improve zlib compression. This does not introduce additional precision loss compared with existing PNG8 export.

PNG8 conversion itself remains a **lossy quantization** of RGB colors with binary alpha (fully transparent/opaque); gradients and partial transparency may appear different. Imported, unchanged image bytes are preserved when patching a VPK if their dimensions and rendering properties remain compatible. ZIP/VPK containers need not additionally DEFLATE PNG files, as PNG's IDAT payload is already compressed.

**Template preview:** click **Preview Template** above the canvas (or press **P**) to switch between the freeform editor and the RCO-based layout. Changing `Layout Style` changes the native frame layout and count (e.g. `a1` has 3 slots, `a3` has 5 and `a5` has 7). Click a frame to edit **that frame's own liveitem**: upload PNG/JPG using **FrameN image**, adjust size and position using the editor or Geometry inputs, change frame background, text and target in the inspector. The preview renders the selected image in the appropriate slot; other configured frames remain visible at the same time. The selected native frame has a gold outline, and editing handles act only on its liveitem. **Fit image to selected frame** centers/scales it into the slot. **Export PNG Preview** captures the active mode; settings and images survive refresh.

The preview reads slot position/size metadata exported from `vs0:/vsh/shell/livearea/*.rco` on a PS Vita (19 native styles). Frame center coordinates are card-relative in the editor; XML generation subtracts **each frame's own RCO center**, so exported `x` and `y` are frame-relative. Switching styles or frame selection does not discard the other frames' settings. Some system-specific frames expose dynamic dimensions; those show a `DYNAMIC` marker, and automatic fitting is unavailable.

**Coordinate directions:** the origin (0, 0) is at the card center. X increases right and decreases left; **Y increases upward and decreases downward**, matching the native RCO coordinate convention. Dragging a liveitem down reduces its displayed and exported Y. Internally, saved layout `x`/`y` still represent top-left pixels, so projects created with earlier versions retain their visual placement without migration. Imported VPK `template.xml` coordinates are interpreted with the same convention.

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
      frame1.png       # independent PNG8 for native frame1
      frame2.png       # independent PNG8 for native frame2
      frame3.png       # independent PNG8 for native frame3
      ...              # up to all frame slots supported by the chosen layout
  manual/
    001.png            # optional, 960 x 544
    002.png
```

A gate is fixed by the chosen LiveArea style. For example, `a1` centers the startup image; `psmobile` places it to the right. Other styles listed in the tutorial include system-specific layouts whose additional built-in functionality may not work for third-party homebrew.

The web app exports a liveitem for **every frame in the selected style**, together with an individual PNG8. Each frame can have a different link to a website or supported Vita URI, text, dimensions and transparent/preset-color background. Existing pre-v1.23 projects retain their original button artwork in the previously active frame.

PNG assets use a quantized indexed palette. Colors are approximated and alpha is binary (fully transparent or opaque) rather than full 8-bit per-pixel opacity. Optional `icon0.png` and `pic0.png` are exported only after an image is selected.

## PS Vita native homebrew

Install the `LIVAREA01.vpk` from [Releases](https://github.com/robin994/LiveAreaDesigner/releases). Title ID: `LIVAREA01`. A local config is saved to `ux0:data/LiveAreaDesigner/settings.ini`. Only the **front touchscreen** is accepted; the rear panel is ignored.

The native **Template + VPK** Settings tab has **Open VPK** and **Patch VPK** controls. Browse to an existing homebrew VPK, import its basic LiveArea images/geometry, then adjust the frames and choose Patch VPK. The original VPK is never modified; the output is written to `ux0:data/LiveAreaDesigner/export/modified_livearea.vpk`. Only supported artwork/text/layout fields are imported; advanced multi-liveitem XML features are not retained. For large archives allow enough free disk space for a second complete VPK file. The native encoder automatically uses strong PNG8 zlib compression and adaptive filters. Keep your original VPK and validate the edited package on the console.

### Controls

| Input | Action |
| --- | --- |
| Front touch on frame slot | Select that frame's independent liveitem |
| Front touch / drag on selected image | Move liveitem content within the selected fixed native frame |
| Front touch / yellow grip | Resize the selected frame's liveitem only |
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
| Template + VPK > Open VPK | Browse existing `.vpk` files and import basic LiveArea resources |
| Template + VPK > Patch VPK | Export a separate modified VPK without changing the original |
| XML + Assets > Select Manual Folder | Browse to a directory; press **Square** to use it |
| Circle | Back / save / exit |

In **XML + Assets**, select style and frame; then switch to the **Colors / Images** tab and load the PNG/JPG for that specific frame. Returning to any other frame restores its image, geometry and background settings. The persisted preview flag is `preview_template=1` when active. For text, target URI, language and restrictions, the native app currently uses editable `settings.ini` keys, with a separate entry for every frame:

```ini
frame_target=https://example.com
frame_text=
frame_lang=
age_limit=0
vita_only=0
autoflip=0
preview_template=1
frame.0.1.image=ux0:/data/example-frame1.png
frame.0.1.text=Frame One
frame.0.1.target=https://example.org/one
frame.0.2.image=ux0:/data/example-frame2.png
frame.0.2.text=Frame Two
frame.0.2.target=https://example.org/two
```

**Native export destination:**

```text
ux0:data/LiveAreaDesigner/export/sce_sys/livearea/contents/template.xml
ux0:data/LiveAreaDesigner/export/sce_sys/livearea/contents/bg0.png
ux0:data/LiveAreaDesigner/export/sce_sys/livearea/contents/startup.png
ux0:data/LiveAreaDesigner/export/sce_sys/livearea/contents/frame1.png
ux0:data/LiveAreaDesigner/export/sce_sys/livearea/contents/frame2.png
ux0:data/LiveAreaDesigner/export/sce_sys/livearea/contents/frame3.png
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

Output: `build/LIVAREA01.vpk` (v1.25). RCO geometry is verified against the user's own Vita firmware, but the VPK editing workflow and newly exported XML/PNG8 assets still require end-to-end hardware testing.

Tests:

```sh
node --test tests/web-geometry.test.mjs
node --test tests/vpk-archive.test.mjs
node tests/web-browser-smoke.mjs  # Requires Google Chrome
mkdir -p build/host-test
clang -std=c99 -Wall -Wextra -Werror -Isrc src/exporter_xml.c src/template_slots.c tests/exporter_xml_smoke.c -o build/host-test/exporter_xml_smoke
build/host-test/exporter_xml_smoke
clang -std=c99 -Wall -Wextra -Werror -Itests/mocks -Isrc src/assets.c tests/assets_smoke.c -o build/host-test/assets_smoke
(cd build/host-test && ./assets_smoke)
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
- Support multiple language-specific liveitems **within an individual frame** (currently one liveitem per frame) and meaningful multi-liveitem autoflip behavior.
- Add on-device text/target editing rather than requiring direct edits to `settings.ini`.
- Validate indexed PNGs and installed XML on real hardware and update compatibility notes.
- Preserve custom template.xml structures (multiple liveitems per frame, localization variants and legacy/animated elements) when patching older VPKs instead of normalizing those fields.

[MIT license](LICENSE). Independent homebrew; not affiliated with Sony Interactive Entertainment.
