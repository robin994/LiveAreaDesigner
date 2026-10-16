#include "exporter.h"
#include "template_slots.h"

#include <SDL.h>
#include <SDL_image.h>
#include <png.h>
#include <psp2/io/dirent.h>
#include <psp2/io/stat.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CONTENTS_DIR LAD_EXPORT_DIR "/sce_sys/livearea/contents"
#define MAX_SOURCE_EDGE 2048

static const SDL_Color palette[LAD_PALETTE_COUNT] = {
    {113, 0, 158, 255}, {224, 20, 208, 255}, {32, 106, 190, 255},
    {26, 173, 221, 255}, {30, 158, 105, 255}, {247, 203, 58, 255},
    {245, 143, 55, 255}, {213, 60, 90, 255}, {230, 228, 240, 255},
    {56, 65, 85, 255}
};

static void set_error(char *error, size_t size, const char *description) {
    if (size) snprintf(error, size, "%s", description);
}

static bool encode_png8(SDL_Surface *src, const char *filename, bool alpha) {
    FILE *file = fopen(filename, "wb");
    if (!file) return false;
    png_structp png = png_create_write_struct(PNG_LIBPNG_VER_STRING, NULL, NULL, NULL);
    if (!png) { fclose(file); return false; }
    png_infop info = png_create_info_struct(png);
    if (!info) { png_destroy_write_struct(&png, NULL); fclose(file); return false; }

    unsigned char *pixels = NULL;
    png_bytep *rows = NULL;
    bool success = false;
    if (setjmp(png_jmpbuf(png))) goto done;

    png_init_io(png, file);
    png_set_IHDR(png, info, (png_uint_32)src->w, (png_uint_32)src->h, 8,
                 PNG_COLOR_TYPE_PALETTE, PNG_INTERLACE_NONE,
                 PNG_COMPRESSION_TYPE_BASE, PNG_FILTER_TYPE_BASE);
    png_color colors[225];
    memset(colors, 0, sizeof(colors));
    for (int r = 0; r < 7; ++r) for (int g = 0; g < 8; ++g)
        for (int b = 0; b < 4; ++b) {
            const int idx = 1 + (r * 8 + g) * 4 + b;
            colors[idx].red = (png_byte)((r * 255 + 3) / 6);
            colors[idx].green = (png_byte)((g * 255 + 3) / 7);
            colors[idx].blue = (png_byte)((b * 255 + 1) / 3);
        }
    png_set_PLTE(png, info, colors, 225);
    if (alpha) {
        const png_byte transparent = 0;
        png_set_tRNS(png, info, (png_bytep)&transparent, 1, NULL);
    }

    pixels = (unsigned char *)malloc((size_t)src->w * src->h);
    rows = (png_bytep *)malloc(sizeof(png_bytep) * (size_t)src->h);
    if (!pixels || !rows) goto done;
    for (int y = 0; y < src->h; ++y) rows[y] = pixels + (size_t)y * src->w;

    if (SDL_MUSTLOCK(src) && SDL_LockSurface(src) != 0) goto done;
    for (int y = 0; y < src->h; ++y) {
        const Uint32 *row = (const Uint32 *)((const Uint8 *)src->pixels + y * src->pitch);
        for (int x = 0; x < src->w; ++x) {
            Uint8 red, green, blue, opacity;
            SDL_GetRGBA(row[x], src->format, &red, &green, &blue, &opacity);
            if (alpha && opacity < 128) { rows[y][x] = 0; continue; }
            const int cr = (red * 6 + 127) / 255;
            const int cg = (green * 7 + 127) / 255;
            const int cb = (blue * 3 + 127) / 255;
            rows[y][x] = (png_byte)(1 + (cr * 8 + cg) * 4 + cb);
        }
    }
    if (SDL_MUSTLOCK(src)) SDL_UnlockSurface(src);
    png_write_info(png, info);
    png_write_image(png, rows);
    png_write_end(png, info);
    success = true;

done:
    free(rows);
    free(pixels);
    png_destroy_write_struct(&png, &info);
    if (fclose(file) != 0) success = false;
    if (!success) remove(filename);
    return success;
}

static bool export_picture(const char *source, const char *output,
                           int width, int height, SDL_Color color, bool transparent) {
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
    bool ok = encode_png8(dst, output, transparent);
    SDL_FreeSurface(dst);
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
    if (!export_picture(cfg->gate_image, filename, 280, 158,
                        palette[cfg->button_color], true)) {
        set_error(error, size, "STARTUP.PNG EXPORT FAILED"); return false;
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
