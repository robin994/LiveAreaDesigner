# Changelog

## Web Editor 1.32 - 2026-10-22 (manual gate for ad0, issue #1)

- **Optional startup gate for ad0 and other styles without a native RCO gate slot.** The web editor offers an explicit **Include startup gate manually** checkbox. When enabled it unlocks the image uploader, includes the gate/startup-image tags in template.xml and packages startup.png into the ZIP or modified VPK.
- **Default is unchanged:** ad0 emits no gate or startup image unless explicitly enabled. Disabling the gate does not delete uploaded artwork from browser storage.
- Importing an existing VPK whose XML already contains a gate for a gate-less style activates the manual option automatically. It persists across reloads and style/frame changes.
- Previewing a manually configured gate uses an **estimated, labeled position**, not a native RCO coordinate; hardware placement and visibility are unverified.
- **Web-only fix.** The native PS Vita VPK remains v1.31 pending on-device verification.
- Added XML, ZIP, import, UI persistence and Chrome desktop/mobile regression tests.

## v1.31 - 2026-10-18 (frame1 without lossy compression)

- Frame1 images are no longer reduced to an indexed 256-color palette. Both web and Vita now export frame1 as full-color 8-bit RGB/RGBA PNG with no loss of pixel values.
- An existing, correctly sized and alpha-compatible 8-bit PNG is copied byte for byte, including its original pixels and alpha. If resizing, compositing or JPG conversion is needed, frame1 is re-encoded as RGB/RGBA without palette reduction.
- Only frame1 changes: the other frames, gate, backgrounds and icons retain their optimized PNG8 behavior.
- PNG's mandatory DEFLATE stage is **lossless**; eliminating that step would not improve image quality or produce a valid PNG.
- This is an experimental hardware compatibility path. Some stock Sony LiveArea frame images use 8-bit RGBA, but large truecolor frame assets still require testing on a real PS Vita. Web exports warn when frame1 is unusually large.
- Added pixel-perfect RGB/RGBA encoding and PNG pass-through tests, and a browser ZIP regression test contrasting full-color frame1 against indexed frame2.

## v1.30 - 2026-10-18 (TinyPNG-quality compatibility and faithful asset reuse)

- **Removed the artificial 128 KiB ceiling for bg0.png.** A read-only inspection of a real PS Vita firmware installation found stock Sony 840x500, indexed PNG8 backgrounds up to **369,340 bytes**. The previous exporter cap forced unnecessary dithering/color reduction. The editor now accepts indexed bg0 up to **384 KiB**, a conservative envelope based on observed firmware assets, not a claimed universal Sony limit.
- **Preserve an existing compatible PNG8 exactly.** For opaque 840x500 indexed backgrounds (no tRNS), web ZIP exports and Vita-native exports now copy the original PNG bytes without re-encoding, if the input already fits the size envelope. Users can import a TinyPNG/pngquant-optimized image directly without damaging its palette.
- For source RGB images that already contain at most 256 distinct colors, the offline quantizer still reproduces their RGB values **exactly** and encodes them as indexed PNG8. The user-provided TinyPNG comparison image was verified to round-trip through the real web encoder with **0 RGB pixels changed**, from a 429,699-byte RGB upload to a 157,447-byte PNG8.
- For images requiring quantization, the default **quality-first dithering strength is 0.50**. The exporter tries 0.35, 0.15, 0.05 and 0.00 before reducing 256-color palette size if an asset exceeds its own limit.
- Other image limits remain conservative pending direct hardware tests; the image format stays noninterlaced PNG8. The source comparison artwork is not included in the repository or releases.
- Added tests for high-fidelity backgrounds larger than 128 KiB, exact-color preservation, browser binary PNG8 reuse and native opaque indexed PNG pass-through.

## v1.29 - 2026-10-18 (PNG8 visual-fidelity refinement)

- Improved the image-specific PNG8 encoder for artwork with complex gradients, shadows and glow effects. The v1.28 quantizer used a coarse RGB5 histogram for both palette refinement and color lookup, which introduced additional banding beyond PNG8's intrinsic 256-color limitation.
- Web and Vita now refine their RGB palettes using **eight weighted centroid passes on 6-bit-per-channel histogram bins**. Pixels are assigned using their full 8-bit RGB values and the four nearest palette candidates per RGB6 cell instead of one cached coarse-bin result.
- Default error diffusion is lowered to **0.15** to avoid grain and unnecessary file growth. File-size fallback progressively reduces dithering through 0.10, 0.05, and 0.00 before reducing the number of colors. Web caches a palette during retries so only the pixel mapping needs to be repeated.
- On a user-provided 840x500 artwork sample with approximately 190,000 unique source colors, measured mean squared RGB error improved from **28.37 (v1.28)** to **21.99**, a roughly **22% reduction**, with a 128,401-byte indexed PNG that fits the 128 KiB export cap. This artwork is a private test fixture and is **not** included in the repository or release.
- PNG8 still cannot reproduce an image with more than 256 colors losslessly. The export remains 8-bit indexed and non-interlaced for Vita compatibility; no unverified 24/32-bit fallback has been introduced.
- Added a cached-palette regression test, tighter gradient-quality assertions, and real-image offline benchmarking. Existing import/edit/ZIP, alpha, gate-less ad0 and XML behavior remain unchanged.

## v1.28 - 2026-10-18 (gate-less layouts and high-fidelity PNG8)

- **ad0 XML fix:** no `<gate>`, no `<startup-image>`, and no `startup.png` in the freshly exported assets. Also applies to firmware-defined gate-less `ad1`-`ad4` and `music` layouts. The web editor hides irrelevant gate upload controls for those styles.
- **Image quality fix:** replaced the old global 7x8x4 RGB palette with a **256-color adaptive palette**, weighted median cut, two refinement passes, and moderate, bounded Floyd-Steinberg dithering on both web and PS Vita.
- **Exact reproduction** for source artwork with up to 256 unique opaque colors (255 when transparency needs a palette entry), without the previous red/green/blue rounding. Complex images now allocate colors according to actual image content.
- **Compatibility:** retain non-interlaced indexed PNG8/zlib, transparent palette slot where requested, and full 256 palette slots for `pic0.png`. Common Vita asset size limits are enforced: bg0/icon0 128 KiB, startup 64 KiB and pic0 256 KiB. Compression first removes dithering at 256 colors, only then reduces palette size as needed; impossible inputs fail rather than silently exceeding the limit.
- Web: adaptive PNG filters are compared to PNG filter-0, choosing the smaller lossless stream; automatic size-limit adjustments are reported during ZIP/VPK export. Processing remains fully offline without TinyPNG API calls or dependencies.
- Added PNG decoding, 256-color exactness, alpha, gradient quality and size-limit regression tests alongside ad0 XML/ZIP and browser UI checks.

## v1.27 - 2026-10-16 (frame1 startup target)

- New, previously unconfigured **frame1** liveitems now default to `psla:eboot` in every supported layout style.
- The web editor displays `psla:eboot` when frame1 is first selected; the same value is used in the default exported `template.xml` and the PS Vita homebrew frame-selection fallback.
- Explicitly saved targets (including empty targets and custom URLs) and imported VPK frame settings are not overwritten. The other frames' defaults are unchanged.
- Added web/native regression tests for the generated template and preservation of customized frame1 targets.

## v1.26 - 2026-10-16 (editor coordinate sign preferences)

- Added independent **Invert X** and **Invert Y** controls to the web editor, under **Geometry > Coordinate signs**, and to the Vita app's **Template + VPK** settings.
- The displayed CENTER X/Y numbers, numeric coordinate fields and copied values use the selected sign convention. Both checkboxes default to OFF, preserving the existing behavior.
- Sign preferences persist in browser localStorage and the Vita `settings.ini`, independently of the selected frame. Input ranges and direction hints update to match the selected convention.
- Saved pixel positions, dimensions, original artwork and native `template.xml` export are unaffected. Vita frame coordinates remain in the firmware's canonical convention regardless of the editor preferences.
- Added coordinate sign/reversible input/persistence regression tests for web and native C.

## v1.25 - 2026-10-16 (coordinate-direction correction)

- Corrected LiveArea Y to use the standard centered Cartesian convention: **Y positive up, negative down**. The web measurements, numeric input, copied offsets, Vita on-screen readings, and exported frame-relative `template.xml` values now agree.
- Fixed coordinate conversion for imported VPK templates in both the web and native Vita app, including pixel-exact round-trips with odd image dimensions.
- Preserved the physical pixel coordinates in existing web localStorage and native `settings.ini`: upgrading changes the signed coordinate labels and XML output, not where the images are drawn.
- Updated the shared RCO geometry code generator and added web/native tests for top/center/bottom positioning and signed XML import/export.

## v1.24 - 2026-10-16 (experimental pre-release)

- Cleaner web interface: collapsible fallback palette and advanced XML settings; measurements focus on X/Y/W/H, with secondary exports under **More tools**.
- **Open existing VPK** on web: locally inspect a PS Vita ZIP/VPK, import supported layout/frame geometry and PNG/JPG artwork into the editor. File content never leaves the browser.
- **Export modified VPK** on web: only requested `sce_sys/livearea/contents/*` assets and optional icon/manual artwork are replaced. Other entries, including the original `eboot.bin`, retain their compressed data, CRC and ZIP method. The source archive is never overwritten.
- Preserve original compressed LiveArea artwork when only text/position/target changed and the image itself was not altered; avoid unnecessary lossy PNG8 conversions.
- Added native Vita **Open VPK / Patch VPK** workflow with file-browser filtering for `.vpk`, selected common LiveArea fields/images import, and a separate output at `ux0:data/LiveAreaDesigner/export/modified_livearea.vpk`. Uses libzip and bounded 64 KiB file copying, never overwriting the source VPK.
- PNG8 compression was present in 1.23; the web exporter now also removes unused indexed-palette colors and uses adaptive row filtering before zlib. The change does **not** further reduce color precision beyond existing PNG8 quantization. Vita uses libpng's high-compression zlib level and adaptive PNG filtering.
- Added `Optimize PNG8 images` preference (web default ON), VPK archive integrity tests, Chrome end-to-end VPK import/edit/export test, and PNG8 size comparison.
- ZIP32 VPKs up to 512 MiB are supported by the web importer; encrypted, split and ZIP64 input is rejected. Complex multi-liveitem XML is simplified to the one-editable-liveitem-per-frame model. Test the new VPK on a real PS Vita; signed/protected packages may not tolerate modification.

## v1.23 - 2026-10-16 (experimental pre-release)

- Preview Template no longer draws an extra freeform rectangle over the system layout. Every native frame displays its own liveitem **inside its matching RCO frame slot**.
- Per-frame state: independent PNG/JPG artwork, position, size, background palette, transparency, aspect-ratio lock, target URI, text and optional language restrictions.
- Web: clicking a frame switches the inspector to that frame's image and settings. Move/resize its content, not the immutable system slot. Per-frame images are stored in IndexedDB, geometry and other settings in localStorage.
- Vita: frame selection restores the frame's own image and settings; cached, downscaled textures draw all frames at once. Each frame's configuration is persisted in `settings.ini`.
- Both exporters now generate **all frame elements** in `template.xml`, each referring to `frame1.png`, `frame2.png` and so on, plus a corresponding indexed PNG8 asset. Previously exported single-frame `button.png` is replaced by frame-specific filenames.
- Existing legacy single-button projects are migrated into the active frame; user assets are not deleted.
- Added regression tests proving independence across two frames, persistence across reload, multi-frame XML and ZIP integrity.
- Fixed-slot geometry is hardware-derived, but the Vita shell's artwork and clipping effects remain simplified; hardware validation is still required.

## v1.22 - 2026-10-16 (pre-release)

- Fixed the Preview Template regression where selecting `a1`–`a5` barely changed the visual layout.
- Decoded `layout_hint` records from 19 LiveArea RCOF files read from a PS Vita. The repository includes numeric frame/gate geometry only, **not firmware files**.
- Added generated, synchronized browser and native-C tables with the real frame slot count, centers and dimensions.
- Every native slot is displayed in Preview Template, with its frame number, dimensions and a highlighted selection; click/tap another slot to select it.
- Web: **Fit image to selected frame**, clipping warning, dynamically populated frame select and live display of XML frame-relative X/Y.
- PS Vita: matching RCO-based slot rendering, SELECT/Square/L shortcuts preserved, Cross to fit the selected liveitem, and frame selection via front touch.
- Corrected XML export for both platforms to use the chosen frame's center, not the card center; fixed native rounding for odd image dimensions.
- Versioned browser module URLs to prevent cached 1.21 JavaScript from hiding the new layout behavior.
- Added deterministic regeneration scripts and geometry/visual browser regressions for `a1`–`a5`.
- System decorations are still schematic and frame clipping/XML validity on hardware require an end-to-end test.

## v1.21 - 2026-10-16 (pre-release)

- Added the persistent **Preview Template** flag to the web and PS Vita editors.
- When active, the preview displays the selected LiveArea style, its system update/manual controls, fixed startup gate image, the editable frame liveitem, and optional frame text/target.
- The liveitem can still be moved/resized while the template preview is active; all positions and XML export remain synchronized.
- Web: one-click preview toggle or P shortcut, live status label, localStorage persistence, and preview PNG export.
- PS Vita: SELECT in the editor or the XML + Assets Settings tab toggles preview; Square cycles style and L cycles frame in template mode.
- Templates with unknown native frame positions are explicitly labeled illustrative. The a1 center and psmobile right gate alignments are documented, but absolute offsets remain unverified.
- Added host and browser tests for the preview geometry, state persistence and dynamic XML updates.

## v1.20 - 2026-10-16 (pre-release)

- Reworked PS Vita card geometry to 840 x 500 px with 44 px reserved at its top for system controls.
- Signed center-based X/Y coordinates, updated on both website and native Vita editor.
- Fixed-aspect-ratio resizing and transparent button background.
- Indexed PNG8 asset exporter to make Vita-compatible `bg0.png`, `startup.png` and `button.png`.
- Standard `template.xml` generator with layout style, native gate and one frame liveitem with XML-escaped link/text and optional restrictions.
- Web editor: individual XML download, complete ZIP export, optional icon0, pic0, custom gate and manual page images.
- Vita app: XML + Assets settings tab, file picker for gate/icon0/pic0, manual folder and export under `ux0:data/LiveAreaDesigner/export/`.
- Added XML and ZIP unit/browser regression tests.
- Frame positions are fixed by the PS Vita system; the freeform button overlay in the simulator is an approximation and must be validated on hardware.

## v1.11 - 2026-10-15 (pre-release)

- Added filtering for the **front touchscreen** so the rear touchpad cannot interact with the editor.
- Ignore mouse events synthesized from touch and associate a drag with the front finger that started it.
- Retain the v1.10 features: card and button images (PNG/JPG), solid-color palette, filesystem browser, live preview, and persistent settings.

### Known limitations

- LiveArea card dimensions are currently a prototype example (840 x 480 within a 960 x 544 screen), not a certified Sony LiveArea template.
- Only one button rectangle is supported.
- Layout export to LiveArea XML is not implemented.
- The latest front-touch-only fix was compiled successfully but has not yet been confirmed through a follow-up on-device usability test.
