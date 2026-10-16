# Changelog

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
