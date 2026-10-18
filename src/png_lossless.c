#include "png_lossless.h"

#include <png.h>
#include <zlib.h>
#include <stdio.h>
#include <stdlib.h>

bool lad_write_truecolor_png(const uint8_t *rgba, int width, int height,
                              bool transparency, const char *filename) {
    if (!rgba || !filename || width <= 0 || height <= 0 ||
        width > 4096 || height > 4096) return false;
    FILE *file = fopen(filename, "wb");
    if (!file) return false;
    /* Allocate before setjmp so cleanup is safe if libpng rejects the file. */
    png_bytep rgb_row = transparency ? NULL : (png_bytep)malloc((size_t)width * 3);
    if (!transparency && !rgb_row) { fclose(file); return false; }
    png_structp png = png_create_write_struct(PNG_LIBPNG_VER_STRING, NULL, NULL, NULL);
    if (!png) { free(rgb_row); fclose(file); return false; }
    png_infop info = png_create_info_struct(png);
    if (!info) {
        png_destroy_write_struct(&png, NULL);
        free(rgb_row);
        fclose(file);
        return false;
    }
    bool success = false;
    if (setjmp(png_jmpbuf(png))) goto cleanup;
    png_init_io(png, file);
    png_set_compression_level(png, Z_BEST_COMPRESSION);
    png_set_filter(png, PNG_FILTER_TYPE_BASE, PNG_ALL_FILTERS);
    png_set_IHDR(png, info, (png_uint_32)width, (png_uint_32)height,
                 8, transparency ? PNG_COLOR_TYPE_RGB_ALPHA : PNG_COLOR_TYPE_RGB,
                 PNG_INTERLACE_NONE, PNG_COMPRESSION_TYPE_BASE,
                 PNG_FILTER_TYPE_BASE);
    png_write_info(png, info);
    for (int y = 0; y < height; y++) {
        png_const_bytep source = rgba + (size_t)y * width * 4;
        if (transparency) {
            png_write_row(png, source);
        } else {
            for (int x = 0; x < width; x++) {
                rgb_row[x * 3] = source[x * 4];
                rgb_row[x * 3 + 1] = source[x * 4 + 1];
                rgb_row[x * 3 + 2] = source[x * 4 + 2];
            }
            png_write_row(png, rgb_row);
        }
    }
    png_write_end(png, info);
    success = true;
cleanup:
    png_destroy_write_struct(&png, &info);
    free(rgb_row);
    if (fclose(file) != 0) success = false;
    if (!success) remove(filename);
    return success;
}
