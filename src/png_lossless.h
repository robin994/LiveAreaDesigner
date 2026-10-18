#ifndef LAD_PNG_LOSSLESS_H
#define LAD_PNG_LOSSLESS_H

#include <stdbool.h>
#include <stdint.h>

/* Write 8-bit RGB/RGBA PNG without palette quantization or alpha thresholding.
   PNG's mandatory DEFLATE compression is pixel-lossless. */
bool lad_write_truecolor_png(const uint8_t *rgba, int width, int height,
                              bool transparency, const char *filename);

#endif
