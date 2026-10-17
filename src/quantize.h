#ifndef LAD_QUANTIZE_H
#define LAD_QUANTIZE_H

#include <stdbool.h>
#include <stdint.h>

typedef struct {
    uint8_t rgb[256][3];
    uint8_t *indices; /* width * height, caller owns through lad_indexed_free */
    int colors;
    bool transparent;
} LadIndexed;

/* Adaptive RGB palette, up to 256 entries, with optional bounded dithering.
   Alpha is binary as required by the existing LiveArea PNG8 export path. */
bool lad_quantize_rgba(const uint8_t *rgba, int width, int height,
                       bool transparency, int max_colors, float dither,
                       LadIndexed *output);
void lad_indexed_free(LadIndexed *image);

#endif
