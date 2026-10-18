#ifndef LAD_PNG_PASSTHROUGH_H
#define LAD_PNG_PASSTHROUGH_H

#include <stdbool.h>
#include <stddef.h>

/* Copy an already-compatible opaque PNG8 unchanged, preserving its palette
   and dithering. Returns false when a render/convert pass is required. */
bool lad_copy_opaque_indexed_png(const char *source, const char *destination,
                                 int width, int height, size_t maximum_bytes);

/* Frame1: retain a compatible 8-bit PNG (indexed, RGB or RGBA) exactly as
   provided when its dimensions and transparency mode already match. */
bool lad_copy_frame_png(const char *source, const char *destination,
                        int width, int height, bool allow_transparency);

#endif
