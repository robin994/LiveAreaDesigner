# Changelog

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
