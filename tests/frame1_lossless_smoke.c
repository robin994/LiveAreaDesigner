#include "png_lossless.h"
#include "png_passthrough.h"

#include <png.h>
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static bool files_equal(const char *first, const char *second) {
    FILE *a = fopen(first, "rb"), *b = fopen(second, "rb");
    assert(a && b);
    bool same = true;
    int ac, bc;
    do {
        ac = fgetc(a);
        bc = fgetc(b);
        if (ac != bc) same = false;
    } while (ac == bc && ac != EOF);
    fclose(a);
    fclose(b);
    return same;
}

static void verify_pixels(const char *file, const unsigned char *expected,
                          int width, int height, bool alpha) {
    FILE *stream = fopen(file, "rb");
    assert(stream);
    png_structp png = png_create_read_struct(PNG_LIBPNG_VER_STRING, NULL, NULL, NULL);
    png_infop info = png_create_info_struct(png);
    assert(png && info);
    assert(!setjmp(png_jmpbuf(png)));
    png_init_io(png, stream);
    png_read_info(png, info);
    png_uint_32 w = 0, h = 0;
    int depth = 0, kind = 0;
    assert(png_get_IHDR(png, info, &w, &h, &depth, &kind, NULL, NULL, NULL));
    assert(w == (png_uint_32)width && h == (png_uint_32)height);
    assert(depth == 8 && kind == (alpha ? PNG_COLOR_TYPE_RGB_ALPHA : PNG_COLOR_TYPE_RGB));
    const int channels = alpha ? 4 : 3;
    unsigned char *row = malloc((size_t)width * channels);
    assert(row);
    for (int y = 0; y < height; y++) {
        png_read_row(png, row, NULL);
        for (int x = 0; x < width; x++)
            for (int channel = 0; channel < channels; channel++)
                assert(row[x * channels + channel] ==
                       expected[((size_t)y * width + x) * 4 + channel]);
    }
    png_read_end(png, NULL);
    free(row);
    png_destroy_read_struct(&png, &info, NULL);
    fclose(stream);
}

int main(void) {
    enum { WIDTH = 173, HEIGHT = 111 };
    unsigned char *rgba = malloc((size_t)WIDTH * HEIGHT * 4);
    assert(rgba);
    for (int i = 0; i < WIDTH * HEIGHT; i++) {
        rgba[i * 4] = (unsigned char)(i * 19);
        rgba[i * 4 + 1] = (unsigned char)(i * 31);
        rgba[i * 4 + 2] = (unsigned char)(i * 47);
        rgba[i * 4 + 3] = (unsigned char)(i * 13);
    }
    const char *rgb = "build/host-test/frame1-original-rgb.png";
    const char *alpha = "build/host-test/frame1-original-rgba.png";
    const char *copy = "build/host-test/frame1-copied.png";
    assert(lad_write_truecolor_png(rgba, WIDTH, HEIGHT, false, rgb));
    verify_pixels(rgb, rgba, WIDTH, HEIGHT, false);
    assert(lad_copy_frame_png(rgb, copy, WIDTH, HEIGHT, false));
    assert(files_equal(rgb, copy));
    assert(!lad_copy_frame_png(rgb, copy, WIDTH + 1, HEIGHT, false));
    assert(lad_copy_frame_png(rgb, rgb, WIDTH, HEIGHT, false));
    assert(lad_write_truecolor_png(rgba, WIDTH, HEIGHT, true, alpha));
    verify_pixels(alpha, rgba, WIDTH, HEIGHT, true);
    assert(!lad_copy_frame_png(alpha, copy, WIDTH, HEIGHT, false));
    assert(lad_copy_frame_png(alpha, copy, WIDTH, HEIGHT, true));
    assert(files_equal(alpha, copy));
    free(rgba);
    remove(rgb);
    remove(alpha);
    remove(copy);
    puts("Frame1 lossless RGB/RGBA export and PNG passthrough passed");
    return 0;
}
