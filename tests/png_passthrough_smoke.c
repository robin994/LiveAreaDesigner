#include "png_passthrough.h"
#include <png.h>
#include <assert.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>

static void generate_palette_png(const char *name, bool transparent) {
    FILE *file = fopen(name, "wb");
    assert(file);
    png_structp writer = png_create_write_struct(PNG_LIBPNG_VER_STRING, NULL, NULL, NULL);
    png_infop info = png_create_info_struct(writer);
    assert(writer && info);
    png_init_io(writer, file);
    png_set_IHDR(writer, info, 128, 128, 8, PNG_COLOR_TYPE_PALETTE,
                 PNG_INTERLACE_NONE, PNG_COMPRESSION_TYPE_BASE, PNG_FILTER_TYPE_BASE);
    png_color palette[256];
    for (int i = 0; i < 256; i++) {
        palette[i].red = (png_byte)i;
        palette[i].green = (png_byte)((i * 73) & 255);
        palette[i].blue = (png_byte)((i * 39) & 255);
    }
    png_set_PLTE(writer, info, palette, 256);
    if (transparent) {
        const png_byte mask = 0;
        png_set_tRNS(writer, info, (png_bytep)&mask, 1, NULL);
    }
    png_write_info(writer, info);
    png_byte rows[128][128];
    png_bytep pointers[128];
    for (int y = 0; y < 128; y++) {
        pointers[y] = rows[y];
        for (int x = 0; x < 128; x++)
            rows[y][x] = (png_byte)((x * 13 + y * 41 + (x * y) / 7) & 255);
    }
    png_write_image(writer, pointers);
    png_write_end(writer, info);
    png_destroy_write_struct(&writer, &info);
    assert(fclose(file) == 0);
}

static bool binary_equal(const char *a, const char *b) {
    FILE *left = fopen(a, "rb"), *right = fopen(b, "rb");
    assert(left && right);
    bool equal = true;
    int c1, c2;
    while (1) {
        c1 = fgetc(left);
        c2 = fgetc(right);
        if (c1 != c2) { equal = false; break; }
        if (c1 == EOF) break;
    }
    fclose(left);
    fclose(right);
    return equal;
}

int main(void) {
    const char *opaque = "build/host-test/bg0-indexed-opaque.png";
    const char *alpha = "build/host-test/bg0-indexed-alpha.png";
    const char *output = "build/host-test/bg0-copied.png";
    generate_palette_png(opaque, false);
    generate_palette_png(alpha, true);
    assert(lad_copy_opaque_indexed_png(opaque, output, 128, 128, 384 * 1024));
    assert(binary_equal(opaque, output));
    assert(lad_copy_opaque_indexed_png(opaque, opaque, 128, 128, 384 * 1024));
    assert(binary_equal(opaque, output));
    assert(!lad_copy_opaque_indexed_png(opaque, output, 127, 128, 384 * 1024));
    assert(!lad_copy_opaque_indexed_png(opaque, output, 128, 128, 64));
    assert(!lad_copy_opaque_indexed_png(alpha, output, 128, 128, 384 * 1024));
    remove(opaque);
    remove(alpha);
    remove(output);
    puts("Opaque indexed PNG pass-through preserves original bytes");
    return 0;
}
