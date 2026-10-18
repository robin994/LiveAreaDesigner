#include "exporter.h"
#include "template_slots.h"
#include "quantize.h"
#include "png_passthrough.h"

#include <SDL.h>
#include <SDL_image.h>
#include <png.h>
#include <zlib.h>
#include <psp2/io/dirent.h>
#include <psp2/io/stat.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CONTENTS_DIR LAD_EXPORT_DIR "/sce_sys/livearea/contents"
#define MAX_SOURCE_EDGE 2048
/* Real stock firmware on a retail Vita uses indexed bg0.png up to 369,340 B.
   Allow such content rather than forcing it below the previous 128 KiB cap. */
#define BG0_PNG_LIMIT (384 * 1024)

static const SDL_Color palette[LAD_PALETTE_COUNT] = {
    {113, 0, 158, 255}, {224, 20, 208, 255}, {32, 106, 190, 255},
    {26, 173, 221, 255}, {30, 158, 105, 255}, {247, 203, 58, 255},
    {245, 143, 55, 255}, {213, 60, 90, 255}, {230, 228, 240, 255},
    {56, 65, 85, 255}
};

static void set_error(char *error, size_t size, const char *description) {
    if (size) snprintf(error, size, "%s", description);
}

static bool encode_png8(SDL_Surface *src, const char *filename, bool alpha,
                        int max_colors, float dither, bool full_palette) {
    const size_t bytes = (size_t)src->w * src->h * 4;
    uint8_t *rgba = (uint8_t *)malloc(bytes);
    if (!rgba) return false;
    if (SDL_MUSTLOCK(src) && SDL_LockSurface(src) != 0) {
        free(rgba);
        return false;
    }
    for (int y = 0; y < src->h; y++) {
        uint8_t *dest = rgba + (size_t)y * src->w * 4;
        const uint8_t *row = (const uint8_t *)src->pixels + y * src->pitch;
        if (src->format->format == SDL_PIXELFORMAT_RGBA32) {
            memcpy(dest, row, (size_t)src->w * 4);
        } else {
            for (int x = 0; x < src->w; x++) {
                Uint8 r, g, b, a;
                Uint32 pixel;
                memcpy(&pixel, row + x * 4, sizeof(pixel));
                SDL_GetRGBA(pixel, src->format, &r, &g, &b, &a);
                dest[x * 4] = r; dest[x * 4 + 1] = g;
                dest[x * 4 + 2] = b; dest[x * 4 + 3] = a;
            }
        }
    }
    if (SDL_MUSTLOCK(src)) SDL_UnlockSurface(src);
    LadIndexed indexed = {0};
    const bool quantized = lad_quantize_rgba(rgba, src->w, src->h,
                                             alpha, max_colors, dither, &indexed);
    free(rgba);
    if (!quantized) return false;
    png_bytep *rows = (png_bytep *)malloc(sizeof(*rows) * (size_t)src->h);
    FILE *file = fopen(filename, "wb");
    if (!rows || !file) {
        free(rows);
        if (file) fclose(file);
        lad_indexed_free(&indexed);
        return false;
    }
    for (int y = 0; y < src->h; y++)
        rows[y] = indexed.indices + (size_t)y * src->w;
    png_structp png = png_create_write_struct(PNG_LIBPNG_VER_STRING, NULL, NULL, NULL);
    if (!png) {
        fclose(file);
        free(rows);
        lad_indexed_free(&indexed);
        return false;
    }
    png_infop info = png_create_info_struct(png);
    if (!info) {
        png_destroy_write_struct(&png, NULL);
        fclose(file);
        free(rows);
        lad_indexed_free(&indexed);
        return false;
    }
    bool success = false;
    if (setjmp(png_jmpbuf(png))) goto cleanup;
    png_init_io(png, file);
    png_set_compression_level(png, Z_BEST_COMPRESSION);
    png_set_filter(png, PNG_FILTER_TYPE_BASE, PNG_ALL_FILTERS);
    png_set_IHDR(png, info, (png_uint_32)src->w, (png_uint_32)src->h, 8,
                 PNG_COLOR_TYPE_PALETTE, PNG_INTERLACE_NONE,
                 PNG_COMPRESSION_TYPE_BASE, PNG_FILTER_TYPE_BASE);
    png_color colors[256] = {{0}};
    for (int i = 0; i < indexed.colors; i++) {
        colors[i].red = indexed.rgb[i][0];
        colors[i].green = indexed.rgb[i][1];
        colors[i].blue = indexed.rgb[i][2];
    }
    /* The Vita bootscreen is unusually picky: give pic0 a full 256-entry
       PNG8 PLTE even when its image actually uses fewer colors. */
    png_set_PLTE(png, info, colors, full_palette ? 256 : indexed.colors);
    if (alpha) {
        const png_byte transparent = 0;
        png_set_tRNS(png, info, (png_bytep)&transparent, 1, NULL);
    }
    png_write_info(png, info);
    png_write_image(png, rows);
    png_write_end(png, info);
    success = true;
cleanup:
    png_destroy_write_struct(&png, &info);
    lad_indexed_free(&indexed);
    free(rows);
    if (fclose(file) != 0) success = false;
    if (!success) remove(filename);
    return success;
}

static bool export_picture(const char *source, const char *output,
                           int width, int height, SDL_Color color, bool transparent) {
    const char *basename = strrchr(output, '/');
    basename = basename ? basename + 1 : output;
    if (!transparent && strcmp(basename, "bg0.png") == 0 &&
        lad_copy_opaque_indexed_png(source, output, width, height, BG0_PNG_LIMIT))
        return true;

    SDL_Surface *dst = SDL_CreateRGBSurfaceWithFormat(0, width, height, 32,
                                                     SDL_PIXELFORMAT_RGBA32);
    if (!dst) return false;
    Uint32 fill = transparent ? 0 : SDL_MapRGBA(dst->format, color.r, color.g, color.b, 255);
    SDL_FillRect(dst, NULL, fill);
    if (source && source[0]) {
        SDL_Surface *image = IMG_Load(source);
        if (!image || image->w <= 0 || image->h <= 0 ||
            image->w > MAX_SOURCE_EDGE || image->h > MAX_SOURCE_EDGE) {
            SDL_FreeSurface(image);
            SDL_FreeSurface(dst);
            return false;
        }
        SDL_SetSurfaceBlendMode(image, SDL_BLENDMODE_BLEND);
        if (SDL_BlitScaled(image, NULL, dst, NULL) < 0) {
            SDL_FreeSurface(image);
            SDL_FreeSurface(dst);
            return false;
        }
        SDL_FreeSurface(image);
    }
    size_t max_size = 0;
    if (strcmp(basename, "bg0.png") == 0)
        max_size = BG0_PNG_LIMIT;
    else if (strcmp(basename, "icon0.png") == 0)
        max_size = 128 * 1024;
    else if (strcmp(basename, "startup.png") == 0)
        max_size = 64 * 1024;
    else if (strcmp(basename, "pic0.png") == 0)
        max_size = 256 * 1024;
    const bool full_palette = strcmp(basename, "pic0.png") == 0;
    const int color_steps[] = {256, 256, 256, 256, 256, 192, 128, 96, 64, 32};
    const float dither_steps[] = {.50f, .35f, .15f, .05f, 0.f,
                                  0.f, 0.f, 0.f, 0.f, 0.f};
    bool ok = false;
    for (unsigned int i = 0; i < sizeof(color_steps) / sizeof(color_steps[0]); i++) {
        if (!encode_png8(dst, output, transparent,
                         color_steps[i], dither_steps[i], full_palette))
            break;
        if (!max_size) { ok = true; break; }
        FILE *result = fopen(output, "rb");
        if (!result) break;
        const int positioned = fseek(result, 0, SEEK_END);
        const long size = positioned == 0 ? ftell(result) : -1;
        fclose(result);
        if (size < 0) break;
        if ((size_t)size <= max_size) { ok = true; break; }
        remove(output);
    }
    SDL_FreeSurface(dst);
    if (!ok) remove(output);
    return ok;
}

static int filename_compare(const void *a, const void *b) {
    return strcmp((const char *)a, (const char *)b);
}

static bool export_manual_pages(const DesignerConfig *cfg) {
    if (!cfg->manual_dir[0]) return true;
    SceUID fd = sceIoDopen(cfg->manual_dir);
    if (fd < 0) return false;
    char names[10][256];
    int total = 0;
    SceIoDirent ent;
    while (total < 10) {
        memset(&ent, 0, sizeof(ent));
        int read = sceIoDread(fd, &ent);
        if (read < 0) { sceIoDclose(fd); return false; }
        if (read == 0) break;
        if (!SCE_S_ISDIR(ent.d_stat.st_mode) && lad_is_image(ent.d_name) &&
            strlen(ent.d_name) < sizeof(names[0])) {
            snprintf(names[total], sizeof(names[total]), "%s", ent.d_name);
            total++;
        }
    }
    sceIoDclose(fd);
    if (!total) return false;
    qsort(names, (size_t)total, sizeof(names[0]), filename_compare);
    sceIoMkdir(LAD_EXPORT_DIR "/sce_sys/manual", 0777);
    for (int i = 0; i < total; i++) {
        char from[LAD_PATH_MAX + 260];
        char to[600];
        const char *slash = cfg->manual_dir[strlen(cfg->manual_dir) - 1] == '/' ? "" : "/";
        snprintf(from, sizeof(from), "%s%s%s", cfg->manual_dir, slash, names[i]);
        snprintf(to, sizeof(to), LAD_EXPORT_DIR "/sce_sys/manual/%03d.png", i + 1);
        if (!export_picture(from, to, 960, 544, palette[8], false)) return false;
    }
    return true;
}

bool lad_export_bundle(const DesignerConfig *cfg, char *error, size_t size) {
    if (!cfg) { set_error(error, size, "INVALID CONFIG"); return false; }
    sceIoMkdir("ux0:data/LiveAreaDesigner", 0777);
    sceIoMkdir(LAD_EXPORT_DIR, 0777);
    sceIoMkdir(LAD_EXPORT_DIR "/sce_sys", 0777);
    sceIoMkdir(LAD_EXPORT_DIR "/sce_sys/livearea", 0777);
    sceIoMkdir(CONTENTS_DIR, 0777);

    char filename[600];
    snprintf(filename, sizeof(filename), "%s/template.xml", CONTENTS_DIR);
    FILE *xml = fopen(filename, "wb");
    if (!xml) { set_error(error, size, "UNABLE TO CREATE TEMPLATE.XML"); return false; }
    bool ok = lad_write_template(xml, cfg);
    if (fclose(xml) != 0) ok = false;
    if (!ok) { set_error(error, size, "XML WRITE FAILED"); return false; }

    snprintf(filename, sizeof(filename), "%s/bg0.png", CONTENTS_DIR);
    if (!export_picture(cfg->card_image, filename, 840, 500,
                        palette[cfg->card_color], false)) {
        set_error(error, size, "BG0.PNG EXPORT FAILED"); return false;
    }

    snprintf(filename, sizeof(filename), "%s/startup.png", CONTENTS_DIR);
    if (lad_template_layout(cfg->template_style)->has_gate) {
        if (!export_picture(cfg->gate_image, filename, 280, 158,
                            palette[cfg->button_color], true)) {
            set_error(error, size, "STARTUP.PNG EXPORT FAILED"); return false;
        }
    } else {
        /* Remove leftovers from an earlier gated style in the shared output
           directory, so ad0 ZIP/VPK exports cannot pick up stale artwork. */
        remove(filename);
    }

    const int total = lad_template_frame_count(cfg->template_style);
    for (int frame = 1; frame <= total; ++frame) {
        DesignerFrame item;
        lad_resolve_frame(cfg, frame, &item);
        snprintf(filename, sizeof(filename), "%s/frame%d.png", CONTENTS_DIR, frame);
        const int color = item.button_color >= 0 && item.button_color < LAD_PALETTE_COUNT
            ? item.button_color : 1;
        if (!export_picture(item.image, filename, item.w, item.h,
                            palette[color], item.transparent_button != 0)) {
            set_error(error, size, "FRAME PNG EXPORT FAILED"); return false;
        }
    }

    if (cfg->icon_image[0]) {
        snprintf(filename, sizeof(filename), "%s/sce_sys/icon0.png", LAD_EXPORT_DIR);
        if (!export_picture(cfg->icon_image, filename, 128, 128, palette[8], false)) {
            set_error(error, size, "ICON0.PNG EXPORT FAILED"); return false;
        }
    }
    if (cfg->boot_image[0]) {
        snprintf(filename, sizeof(filename), "%s/sce_sys/pic0.png", LAD_EXPORT_DIR);
        if (!export_picture(cfg->boot_image, filename, 960, 544, palette[8], false)) {
            set_error(error, size, "PIC0.PNG EXPORT FAILED"); return false;
        }
    }
    if (!export_manual_pages(cfg)) {
        set_error(error, size, "MANUAL PAGES EXPORT FAILED"); return false;
    }
    set_error(error, size, "TEMPLATE.XML + PNGS EXPORTED TO UX0:DATA");
    return true;
}
