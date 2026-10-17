#include "vpk_editor.h"
#include "exporter.h"
#include "template_slots.h"

#include <zip.h>
#include <psp2/io/stat.h>
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define IMPORT_DIR "ux0:data/LiveAreaDesigner/import"
#define CONTENTS "sce_sys/livearea/contents/"
#define MAX_XML (1024 * 1024)
#define MAX_IMPORTED_IMAGE (12 * 1024 * 1024)

static void report(char *message, size_t size, const char *text) {
    if (size) snprintf(message, size, "%s", text);
}

static int bounded_int(const char *text, int fallback, int lo, int hi) {
    if (!text || !*text) return fallback;
    char *end = NULL;
    long value = strtol(text, &end, 10);
    if (!end || *end) return fallback;
    if (value < lo) value = lo;
    if (value > hi) value = hi;
    return (int)value;
}

static void xml_unescape(char *text) {
    char *out = text;
    for (char *in = text; *in;) {
        struct { const char *code; char replacement; } entities[] = {
            {"&amp;", '&'}, {"&lt;", '<'}, {"&gt;", '>'},
            {"&quot;", '"'}, {"&apos;", '\''}
        };
        int matched = 0;
        for (unsigned int i = 0; i < sizeof(entities) / sizeof(entities[0]); i++) {
            const size_t n = strlen(entities[i].code);
            if (strncmp(in, entities[i].code, n) == 0) {
                *out++ = entities[i].replacement;
                in += n;
                matched = 1;
                break;
            }
        }
        if (!matched) {
            char character = *in++;
            *out++ = character == '\r' || character == '\n' ? ' ' : character;
        }
    }
    *out = 0;
}

/* Parse only attributes on the current opening tag; never interpret XML as code. */
static int attribute(const char *begin, const char *end,
                     const char *key, char *out, size_t capacity) {
    if (!begin || !end || end <= begin || !capacity) return 0;
    const size_t length = strlen(key);
    for (const char *at = begin; at + length + 2 < end; at++) {
        if (at != begin && !isspace((unsigned char)at[-1])) continue;
        if (strncmp(at, key, length) || at[length] != '=') continue;
        const char quote = at[length + 1];
        if (quote != '"' && quote != '\'') continue;
        const char *start = at + length + 2;
        const char *stop = start;
        while (stop < end && *stop != quote) stop++;
        if (stop == end || (size_t)(stop - start) >= capacity) return 0;
        memcpy(out, start, (size_t)(stop - start));
        out[stop - start] = 0;
        xml_unescape(out);
        return 1;
    }
    return 0;
}

static int text_between(const char *begin, const char *end,
                        const char *opening, const char *closing,
                        char *out, size_t capacity) {
    if (!begin || !end || !capacity) return 0;
    const char *found = strstr(begin, opening);
    if (!found || found >= end) return 0;
    const char *start = strchr(found, '>');
    if (!start || start >= end) return 0;
    start++;
    const char *stop = strstr(start, closing);
    if (!stop || stop > end || (size_t)(stop - start) >= capacity) return 0;
    while (start < stop && isspace((unsigned char)*start)) start++;
    while (stop > start && isspace((unsigned char)stop[-1])) stop--;
    if ((size_t)(stop - start) >= capacity) return 0;
    memcpy(out, start, (size_t)(stop - start));
    out[stop - start] = 0;
    xml_unescape(out);
    return 1;
}

static int clean_image_name(const char *name) {
    const size_t count = strlen(name);
    if (!count || count > 150 || name[0] == '.') return 0;
    for (const char *p = name; *p; p++) {
        if (!isalnum((unsigned char)*p) && *p != '_' && *p != '-' && *p != '.')
            return 0;
    }
    return lad_is_image(name);
}

static int extract_image(zip_t *source, const char *asset_name,
                         const char *label, char *output, size_t capacity) {
    if (!clean_image_name(asset_name)) return 0;
    char in_name[256];
    snprintf(in_name, sizeof(in_name), CONTENTS "%s", asset_name);
    zip_stat_t stats;
    zip_stat_init(&stats);
    if (zip_stat(source, in_name, 0, &stats) != 0 ||
        stats.size == 0 || stats.size > MAX_IMPORTED_IMAGE) return 0;
    const char *extension = strrchr(asset_name, '.');
    char path[512];
    if (snprintf(path, sizeof(path), IMPORT_DIR "/%s%s", label, extension) >=
        (int)sizeof(path) || strlen(path) >= capacity) return 0;
    zip_file_t *file = zip_fopen(source, in_name, 0);
    if (!file) return 0;
    FILE *out = fopen(path, "wb");
    if (!out) { zip_fclose(file); return 0; }
    unsigned char buffer[32768];
    zip_int64_t remaining = (zip_int64_t)stats.size;
    int okay = 1;
    while (remaining > 0) {
        zip_int64_t want = remaining > (zip_int64_t)sizeof(buffer)
            ? (zip_int64_t)sizeof(buffer) : remaining;
        zip_int64_t count = zip_fread(file, buffer, (zip_uint64_t)want);
        if (count <= 0 || fwrite(buffer, 1, (size_t)count, out) != (size_t)count) {
            okay = 0; break;
        }
        remaining -= count;
    }
    if (zip_fclose(file) < 0) okay = 0;
    if (fclose(out) != 0) okay = 0;
    if (!okay || remaining != 0) { remove(path); return 0; }
    snprintf(output, capacity, "%s", path);
    return 1;
}

static int image_node(const char *begin, const char *end,
                      char *tag, size_t tag_capacity,
                      char *filename, size_t filename_capacity) {
    const char *at = strstr(begin, "<image");
    if (!at || at >= end) return 0;
    const char *close = strchr(at, '>');
    if (!close || close >= end || (size_t)(close - at) >= tag_capacity)
        return 0;
    memcpy(tag, at, (size_t)(close - at));
    tag[close - at] = 0;
    const char *text_end = strstr(close + 1, "</image>");
    if (!text_end || text_end >= end ||
        (size_t)(text_end - close - 1) >= filename_capacity)
        return 0;
    memcpy(filename, close + 1, (size_t)(text_end - close - 1));
    filename[text_end - close - 1] = 0;
    xml_unescape(filename);
    return clean_image_name(filename);
}

bool lad_import_existing_vpk(const char *source, DesignerConfig *cfg,
                             char *message, size_t size) {
    if (!source || !*source || !cfg) {
        report(message, size, "INVALID VPK SOURCE"); return false;
    }
    int error = 0;
    zip_t *archive = zip_open(source, ZIP_RDONLY, &error);
    if (!archive) { report(message, size, "COULD NOT OPEN VPK ZIP"); return false; }
    if (zip_name_locate(archive, "eboot.bin", 0) < 0 ||
        zip_name_locate(archive, "sce_sys/param.sfo", 0) < 0) {
        report(message, size, "NOT A COMPLETE PS VITA VPK");
        zip_close(archive); return false;
    }
    zip_stat_t stats;
    zip_stat_init(&stats);
    if (zip_stat(archive, CONTENTS "template.xml", 0, &stats) ||
        stats.size == 0 || stats.size > MAX_XML) {
        report(message, size, "VPK HAS NO SUPPORTED TEMPLATE.XML");
        zip_close(archive); return false;
    }
    char *xml = malloc((size_t)stats.size + 1);
    DesignerConfig *staged = malloc(sizeof(*cfg));
    if (!xml || !staged) {
        free(xml); free(staged);
        zip_close(archive);
        report(message, size, "OUT OF MEMORY");
        return false;
    }
    zip_file_t *template_file = zip_fopen(archive, CONTENTS "template.xml", 0);
    zip_int64_t count = template_file ?
        zip_fread(template_file, xml, stats.size) : -1;
    int valid = count == (zip_int64_t)stats.size;
    if (template_file && zip_fclose(template_file) < 0) valid = 0;
    if (!valid) {
        report(message, size, "COULD NOT READ TEMPLATE.XML");
        free(xml); free(staged); zip_close(archive); return false;
    }
    xml[stats.size] = 0;
    if (strstr(xml, "<!DOCTYPE") || strstr(xml, "<!ENTITY")) {
        report(message, size, "UNSUPPORTED TEMPLATE XML ENTITIES");
        free(xml); free(staged); zip_close(archive); return false;
    }
    const char *livearea = strstr(xml, "<livearea");
    const char *opening_end = livearea ? strchr(livearea, '>') : NULL;
    char style_name[48];
    if (!opening_end || !attribute(livearea, opening_end,
                                   "style", style_name, sizeof(style_name))) {
        report(message, size, "INVALID LIVEAREA STYLE");
        free(xml); free(staged); zip_close(archive); return false;
    }
    int style = -1;
    for (int i = 0; i < LAD_STYLE_COUNT; i++) {
        if (strcmp(lad_template_layout(i)->style, style_name) == 0) {
            style = i; break;
        }
    }
    if (style < 0) {
        report(message, size, "UNSUPPORTED NATIVE FRAME STYLE");
        free(xml); free(staged); zip_close(archive); return false;
    }

    sceIoMkdir("ux0:data/LiveAreaDesigner", 0777);
    sceIoMkdir(IMPORT_DIR, 0777);
    memcpy(staged, cfg, sizeof(*cfg));
    staged->template_style = style;
    staged->preview_template = 1;
    memset(staged->frames[style], 0, sizeof(staged->frames[style]));
    staged->card_image[0] = 0;
    staged->gate_image[0] = 0;
    staged->icon_image[0] = 0;
    staged->boot_image[0] = 0;
    staged->manual_dir[0] = 0;

    char label[80], name[180], tag[512];
    const char *background = strstr(opening_end, "<livearea-background");
    const char *gate = strstr(opening_end, "<gate");
    const char *background_end = background
        ? strstr(background, "</livearea-background>") : NULL;
    if (!background) {
        background = strstr(opening_end, "<background");
        background_end = background ? strstr(background, "</background>") : NULL;
    }
    const char *gate_end = gate ? strstr(gate, "</gate>") : NULL;
    if (background && background_end &&
        image_node(background, background_end, tag, sizeof(tag), name, sizeof(name)))
        extract_image(archive, name, "card", staged->card_image,
                      sizeof(staged->card_image));
    if (gate && gate_end &&
        text_between(gate, gate_end, "<startup-image", "</startup-image>",
                     name, sizeof(name)))
        extract_image(archive, name, "gate", staged->gate_image,
                      sizeof(staged->gate_image));

    int imported = 0;
    const char *cursor = opening_end;
    while ((cursor = strstr(cursor, "<frame")) != NULL && imported < LAD_MAX_FRAMES) {
        const char *frame_tag_end = strchr(cursor, '>');
        const char *frame_end = frame_tag_end ? strstr(frame_tag_end, "</frame>") : NULL;
        if (!frame_end) break;
        char frame_name[32];
        if (attribute(cursor, frame_tag_end, "id", frame_name, sizeof(frame_name))) {
            int id = 0;
            if (sscanf(frame_name, "frame%d", &id) == 1 &&
                id >= 1 && id <= lad_template_frame_count(style)) {
                const LadTemplateSlot *slot = lad_template_frame(style, id);
                DesignerFrame *item = &staged->frames[style][id - 1];
                memset(item, 0, sizeof(*item));
                item->initialized = 1;
                item->button_color = 1;
                item->w = slot->width >= 24 ? slot->width : 120;
                item->h = slot->height >= 24 ? slot->height : 80;
                if (item->w > 286) item->w = 286;
                if (item->h > 168) item->h = 168;
                item->x = 420 + slot->center_x - item->w / 2;
                item->y = 250 - slot->center_y - item->h / 2;
                char attribute_value[48];
                if (attribute(cursor, frame_tag_end, "autoflip",
                              attribute_value, sizeof(attribute_value)))
                    item->autoflip = bounded_int(attribute_value, 0, 0, 1);
                if (image_node(frame_tag_end, frame_end, tag, sizeof(tag),
                               name, sizeof(name))) {
                    const char *end_tag = tag + strlen(tag);
                    int width = item->w, height = item->h;
                    int relative_x = 0, relative_y = 0;
                    if (attribute(tag, end_tag, "width", attribute_value, sizeof(attribute_value)))
                        width = bounded_int(attribute_value, width, 24, 840);
                    if (attribute(tag, end_tag, "height", attribute_value, sizeof(attribute_value)))
                        height = bounded_int(attribute_value, height, 24, 456);
                    if (attribute(tag, end_tag, "x", attribute_value, sizeof(attribute_value)))
                        relative_x = bounded_int(attribute_value, 0, -840, 840);
                    if (attribute(tag, end_tag, "y", attribute_value, sizeof(attribute_value)))
                        relative_y = bounded_int(attribute_value, 0, -500, 500);
                    item->w = width; item->h = height;
                    item->x = 420 + slot->center_x + relative_x - (width + 1) / 2;
                    item->y = 250 - slot->center_y - relative_y - (height + 1) / 2;
                    if (item->x < 0) item->x = 0;
                    if (item->y < 44) item->y = 44;
                    if (item->x + item->w > 840) item->x = 840 - item->w;
                    if (item->y + item->h > 500) item->y = 500 - item->h;
                    snprintf(label, sizeof(label), "frame%d", id);
                    extract_image(archive, name, label, item->image,
                                  sizeof(item->image));
                }
                text_between(frame_tag_end, frame_end, "<target", "</target>",
                             item->target, sizeof(item->target));
                text_between(frame_tag_end, frame_end, "<str", "</str>",
                             item->text, sizeof(item->text));
                text_between(frame_tag_end, frame_end, "<lang", "</lang>",
                             item->lang, sizeof(item->lang));
                imported++;
            }
        }
        cursor = frame_end + strlen("</frame>");
    }
    staged->frame_id = imported ? 1 : 3;
    if (staged->frame_id > lad_template_frame_count(style))
        staged->frame_id = lad_template_frame_count(style);
    DesignerFrame active = staged->frames[style][staged->frame_id - 1];
    if (active.initialized) designer_load_active_frame(staged, style, staged->frame_id, NULL);
    else {
        const LadTemplateSlot *slot = lad_template_frame(style, staged->frame_id);
        staged->x = 420 + slot->center_x - 120 / 2;
        staged->y = 250 - slot->center_y - 80 / 2;
        staged->w = 120; staged->h = 80;
        staged->button_image[0] = 0;
    }
    free(xml);
    zip_close(archive);
    memcpy(cfg, staged, sizeof(*cfg));
    free(staged);
    snprintf(message, size, "VPK IMPORTED: %d FRAMES / %s", imported, style_name);
    return true;
}

static int copy_file(const char *src, const char *dst) {
    FILE *source = fopen(src, "rb");
    if (!source) return 0;
    FILE *dest = fopen(dst, "wb");
    if (!dest) { fclose(source); return 0; }
    unsigned char buffer[64 * 1024];
    size_t n;
    int okay = 1;
    while ((n = fread(buffer, 1, sizeof(buffer), source)) > 0) {
        if (fwrite(buffer, 1, n, dest) != n) { okay = 0; break; }
    }
    if (ferror(source)) okay = 0;
    if (fclose(source) != 0) okay = 0;
    if (fclose(dest) != 0) okay = 0;
    if (!okay) remove(dst);
    return okay;
}

static int replace_entry(zip_t *archive, const char *name,
                         const char *path) {
    zip_source_t *data = zip_source_file(archive, path, 0, -1);
    if (!data) return 0;
    if (zip_file_add(archive, name, data,
                     ZIP_FL_OVERWRITE | ZIP_FL_ENC_UTF_8) < 0) {
        zip_source_free(data);
        return 0;
    }
    return 1;
}

bool lad_write_modified_vpk(const char *source, const DesignerConfig *cfg,
                            char *message, size_t size) {
    if (!source || !*source || !cfg || !lad_is_vpk(source)) {
        report(message, size, "SELECT AN EXISTING VPK FIRST");
        return false;
    }
    if (strcmp(source, LAD_MODIFIED_VPK) == 0) {
        report(message, size, "CANNOT PATCH OUTPUT FILE IN PLACE"); return false;
    }
    char bundle_status[128];
    if (!lad_export_bundle(cfg, bundle_status, sizeof(bundle_status))) {
        report(message, size, bundle_status); return false;
    }
    int error = 0;
    zip_t *original = zip_open(source, ZIP_RDONLY, &error);
    if (!original) { report(message, size, "FAILED TO REOPEN ORIGINAL VPK"); return false; }
    const int valid = zip_name_locate(original, "eboot.bin", 0) >= 0 &&
                      zip_name_locate(original, "sce_sys/param.sfo", 0) >= 0;
    zip_close(original);
    if (!valid) { report(message, size, "VPK MISSING EBOOT OR PARAM.SFO"); return false; }

    // Source is never edited. Copy on disk using 64 KiB, then patch the copy.
    if (!copy_file(source, LAD_MODIFIED_VPK)) {
        report(message, size, "FAILED TO COPY SOURCE VPK"); return false;
    }
    zip_t *archive = zip_open(LAD_MODIFIED_VPK, ZIP_CHECKCONS, &error);
    if (!archive) {
        remove(LAD_MODIFIED_VPK);
        report(message, size, "INVALID OR UNSUPPORTED VPK ZIP");
        return false;
    }
    const char *base = LAD_EXPORT_DIR "/sce_sys/livearea/contents/";
    const char *files[] = {"template.xml", "bg0.png"};
    int success = 1;
    for (unsigned int i = 0; i < sizeof(files) / sizeof(files[0]); i++) {
        char out[600], in[600];
        snprintf(out, sizeof(out), CONTENTS "%s", files[i]);
        snprintf(in, sizeof(in), "%s%s", base, files[i]);
        if (!replace_entry(archive, out, in)) success = 0;
    }
    if (success && lad_template_layout(cfg->template_style)->has_gate) {
        success = replace_entry(archive, CONTENTS "startup.png",
                                LAD_EXPORT_DIR "/sce_sys/livearea/contents/startup.png");
    }
    const int count = lad_template_frame_count(cfg->template_style);
    for (int id = 1; success && id <= count; id++) {
        char out[600], in[600];
        snprintf(out, sizeof(out), CONTENTS "frame%d.png", id);
        snprintf(in, sizeof(in), "%sframe%d.png", base, id);
        if (!replace_entry(archive, out, in)) success = 0;
    }
    const struct { const char *source; const char *entry; } optional[] = {
        { cfg->icon_image, "sce_sys/icon0.png" },
        { cfg->boot_image, "sce_sys/pic0.png" }
    };
    for (unsigned int i = 0; success && i < 2; i++) {
        if (!optional[i].source[0]) continue;
        char path[600];
        snprintf(path, sizeof(path), LAD_EXPORT_DIR "/%s", optional[i].entry);
        if (!replace_entry(archive, optional[i].entry, path)) success = 0;
    }
    if (cfg->manual_dir[0]) {
        for (int i = 1; success && i <= 10; i++) {
            char entry[64], path[600];
            snprintf(entry, sizeof(entry), "sce_sys/manual/%03d.png", i);
            snprintf(path, sizeof(path), LAD_EXPORT_DIR "/%s", entry);
            FILE *candidate = fopen(path, "rb");
            if (!candidate) break; /* Only exported manual pages are added. */
            fclose(candidate);
            if (!replace_entry(archive, entry, path)) success = 0;
        }
    }
    if (!success) {
        zip_discard(archive);
        remove(LAD_MODIFIED_VPK);
        report(message, size, "COULD NOT REPLACE LIVEAREA VPK ENTRIES");
        return false;
    }
    if (zip_close(archive) != 0) {
        remove(LAD_MODIFIED_VPK);
        report(message, size, "VPK ZIP WRITE FAILED (FREE SPACE?)");
        return false;
    }
    zip_t *verified = zip_open(LAD_MODIFIED_VPK, ZIP_RDONLY, &error);
    if (!verified) {
        remove(LAD_MODIFIED_VPK);
        report(message, size, "OUTPUT VPK FAILED VALIDATION");
        return false;
    }
    int verified_ok = zip_name_locate(verified, "eboot.bin", 0) >= 0 &&
        zip_name_locate(verified, "sce_sys/param.sfo", 0) >= 0 &&
        zip_name_locate(verified, CONTENTS "template.xml", 0) >= 0;
    zip_close(verified);
    if (!verified_ok) {
        remove(LAD_MODIFIED_VPK);
        report(message, size, "OUTPUT VPK MISSING REQUIRED ENTRIES"); return false;
    }
    report(message, size, "MODIFIED VPK EXPORTED - ORIGINAL UNCHANGED");
    return true;
}
