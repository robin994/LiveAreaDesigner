# Changelog

## v1.11 - 2026-10-15 (pre-release)

- Added filtering for the **front touchscreen** so the rear touchpad cannot interact with the editor.
- Ignore mouse events synthesized from touch and associate a drag with the front finger that started it.
- Retain the v1.10 features: card and button images (PNG/JPG), solid-color palette, filesystem browser, live preview, and persistent settings.

### Known limitations

- LiveArea card dimensions are currently a prototype example (840 x 480 within a 960 x 544 screen), not a certified Sony LiveArea template.
- Only one button rectangle is supported.
- Layout export to LiveArea XML is not implemented.
- The latest front-touch-only fix was compiled successfully but has not yet been confirmed through a follow-up on-device usability test.
