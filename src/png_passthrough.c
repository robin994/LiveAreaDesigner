#include "png_passthrough.h"

#include <png.h>
#include <stdio.h>
#include <string.h>

bool lad_copy_opaque_indexed_png(const char *source, const char *destination,
                                 int width, int height, size_t maximum_bytes) {
    if (!source || !destination || !*source || width <= 0 || height <= 0)
        return false;

    FILE *input = fopen(source, "rb");
    if (!input) return false;
    if (fseek(input, 0, SEEK_END) != 0) {
        fclose(input);
        return false;
    }
    const long length = ftell(input);
    if (length < 65 || (maximum_bytes && (size_t)length > maximum_bytes) ||
        fseek(input, 0, SEEK_SET) != 0) {
        fclose(input);
        return false;
    }
    png_byte signature[8];
    if (fread(signature, 1, sizeof(signature), input) != sizeof(signature) ||
        png_sig_cmp(signature, 0, sizeof(signature)) != 0 ||
        fseek(input, 0, SEEK_SET) != 0) {
        fclose(input);
        return false;
    }

    png_structp reader = png_create_read_struct(PNG_LIBPNG_VER_STRING,
                                                NULL, NULL, NULL);
    if (!reader) {
        fclose(input);
        return false;
    }
    png_infop info = png_create_info_struct(reader);
    if (!info) {
        png_destroy_read_struct(&reader, NULL, NULL);
        fclose(input);
        return false;
    }

    bool compatible = false;
    if (setjmp(png_jmpbuf(reader))) goto close_reader;
    png_init_io(reader, input);
    png_read_info(reader, info);
    png_uint_32 image_width = 0, image_height = 0;
    int depth = 0, color = 0, interlace = 0;
    if (!png_get_IHDR(reader, info, &image_width, &image_height,
                      &depth, &color, &interlace, NULL, NULL))
        goto close_reader;
    png_colorp palette = NULL;
    int palette_count = 0;
    compatible =
        image_width == (png_uint_32)width &&
        image_height == (png_uint_32)height &&
        depth == 8 && color == PNG_COLOR_TYPE_PALETTE &&
        interlace == PNG_INTERLACE_NONE &&
        png_get_PLTE(reader, info, &palette, &palette_count) &&
        palette_count >= 1 && palette_count <= 256 &&
        !png_get_valid(reader, info, PNG_INFO_tRNS);

close_reader:
    png_destroy_read_struct(&reader, &info, NULL);
    if (!compatible || fseek(input, 0, SEEK_SET) != 0) {
        fclose(input);
        return false;
    }
    /* Re-exporting the previous output as input must never truncate it. */
    if (strcmp(source, destination) == 0) {
        fclose(input);
        return true;
    }
    FILE *output = fopen(destination, "wb");
    if (!output) {
        fclose(input);
        return false;
    }
    unsigned char buffer[8192];
    bool success = true;
    while (!feof(input)) {
        const size_t count = fread(buffer, 1, sizeof(buffer), input);
        if (!count) break;
        if (fwrite(buffer, 1, count, output) != count) {
            success = false;
            break;
        }
    }
    if (ferror(input)) success = false;
    fclose(input);
    if (fclose(output) != 0) success = false;
    if (!success) remove(destination);
    return success;
}
