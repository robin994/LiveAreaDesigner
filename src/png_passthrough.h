#ifndef LAD_PNG_PASSTHROUGH_H
#define LAD_PNG_PASSTHROUGH_H

#include <stdbool.h>
#include <stddef.h>

/* Copy an already-compatible opaque PNG8 unchanged, preserving its palette
   and dithering. Returns false when a render/convert pass is required. */
bool lad_copy_opaque_indexed_png(const char *source, const char *destination,
                                 int width, int height, size_t maximum_bytes);

#endif
