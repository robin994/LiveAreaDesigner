/*
 * Host-only integration test for the native PS Vita VPK import/export flow.
 * Exercises the real libzip-based importer/repacker with mock Vita IO and
 * a tiny deterministic exporter; no original source file is overwritten.
 */
#include "assets.h"
#include "exporter.h"
#include "vpk_editor.h"
#include "template_slots.h"

#include <zip.h>
#include <psp2/io/dirent.h>
#include <assert.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

SceUID sceIoDopen(const char *path) { (void)path; return -1; }
int sceIoDread(SceUID fd, SceIoDirent *entry) {
    (void)fd; (void)entry; return 0;
}
int sceIoDclose(SceUID fd) { (void)fd; return 0; }
int sceIoMkdir(const char *path, unsigned int mode) {
    int result = mkdir(path, (mode_t)mode);
    return result == 0 || errno == EEXIST ? 0 : -1;
}

static void write_file(const char *path, const char *data) {
    FILE *f = fopen(path, "wb");
    assert(f);
    assert(fwrite(data, 1, strlen(data), f) == strlen(data));
    assert(fclose(f) == 0);
}

static void add_test_entry(zip_t *archive, const char *name, const char *data) {
    zip_source_t *source = zip_source_buffer(archive, data, strlen(data), 0);
    assert(source);
    zip_int64_t result = zip_file_add(archive, name, source, ZIP_FL_ENC_UTF_8);
    assert(result >= 0);
}

static void make_original(void) {
    static const char template_xml[] =
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
        "<livearea style=\"a3\" format-ver=\"01.00\" content-rev=\"1\">\n"
        "<livearea-background><image>\n bg0.png \n</image></livearea-background>\n"
        "<gate><startup-image>startup.png</startup-image></gate>\n"
        "<frame id=\"frame2\" multi=\"o\" autoflip=\"0\" rev=\"1\">\n"
        "<liveitem default=\"on\">\n"
        "<image align=\"center\" origin=\"frame\" width=\"112\" "
        "height=\"70\" x=\"12\" y=\"-8\">\n frame2.png \n</image>\n"
        "<target>https://example.org/?a=1&amp;b=2</target>\n"
        "<text><str>HELLO FRAME TWO</str></text>\n"
        "</liveitem></frame>\n"
        "<frame id=\"frame4\" multi=\"o\" autoflip=\"0\" rev=\"1\">\n"
        "<liveitem default=\"on\"><image width=\"90\" height=\"66\" "
        "x=\"0\" y=\"0\">frame4.png</image></liveitem></frame>\n"
        "</livearea>\n";
    int err = 0;
    zip_t *archive = zip_open("native-input.vpk", ZIP_CREATE | ZIP_TRUNCATE, &err);
    assert(archive);
    add_test_entry(archive, "eboot.bin", "TEST-EXECUTABLE-UNCHANGED");
    add_test_entry(archive, "sce_sys/param.sfo", "PARAM-SFO-UNCHANGED");
    add_test_entry(archive, "game/data.bin", "UNRELATED-GAME-DATA-UNCHANGED");
    add_test_entry(archive, "sce_sys/livearea/contents/template.xml", template_xml);
    add_test_entry(archive, "sce_sys/livearea/contents/bg0.png", "PNG-CARD");
    add_test_entry(archive, "sce_sys/livearea/contents/startup.png", "PNG-GATE");
    add_test_entry(archive, "sce_sys/livearea/contents/frame2.png", "PNG-FRAME-TWO");
    add_test_entry(archive, "sce_sys/livearea/contents/frame4.png", "PNG-FRAME-FOUR");
    add_test_entry(archive, "sce_sys/icon0.png", "ICON0-PNG");
    add_test_entry(archive, "sce_sys/pic0.png", "PIC0-PNG");
    assert(zip_close(archive) == 0);
}

/* Avoid SDL in a host libzip test: generate deterministic assets from the
   real template writer so the VPK patching logic receives actual files. */
bool lad_export_bundle(const DesignerConfig *cfg, char *error, size_t error_size) {
    assert(sceIoMkdir("ux0:data", 0777) == 0);
    assert(sceIoMkdir("ux0:data/LiveAreaDesigner", 0777) == 0);
    assert(sceIoMkdir(LAD_EXPORT_DIR, 0777) == 0);
    assert(sceIoMkdir(LAD_EXPORT_DIR "/sce_sys", 0777) == 0);
    assert(sceIoMkdir(LAD_EXPORT_DIR "/sce_sys/livearea", 0777) == 0);
    assert(sceIoMkdir(LAD_EXPORT_DIR "/sce_sys/livearea/contents", 0777) == 0);
    const char *root = LAD_EXPORT_DIR "/sce_sys/livearea/contents/";
    char filename[500];
    snprintf(filename, sizeof(filename), "%stemplate.xml", root);
    FILE *f = fopen(filename, "wb");
    assert(f);
    assert(lad_write_template(f, cfg));
    assert(fclose(f) == 0);
    snprintf(filename, sizeof(filename), "%sbg0.png", root);
    write_file(filename, "MODIFIED-CARD");
    snprintf(filename, sizeof(filename), "%sstartup.png", root);
    write_file(filename, "MODIFIED-GATE");
    for (int i = 1; i <= lad_template_frame_count(cfg->template_style); i++) {
        snprintf(filename, sizeof(filename), "%sframe%d.png", root, i);
        write_file(filename, "MODIFIED-FRAME");
    }
    if (cfg->icon_image[0]) {
        write_file(LAD_EXPORT_DIR "/sce_sys/icon0.png", "MODIFIED-ICON");
    }
    if (cfg->boot_image[0]) {
        write_file(LAD_EXPORT_DIR "/sce_sys/pic0.png", "MODIFIED-PIC0");
    }
    if (error_size) snprintf(error, error_size, "ASSETS READY");
    return true;
}

static char *read_entry(zip_t *archive, const char *path) {
    zip_stat_t stat;
    zip_stat_init(&stat);
    assert(zip_stat(archive, path, 0, &stat) == 0);
    assert(stat.size < 1024 * 1024);
    zip_file_t *f = zip_fopen(archive, path, 0);
    assert(f);
    char *data = calloc((size_t)stat.size + 1, 1);
    assert(data);
    assert(zip_fread(f, data, stat.size) == (zip_int64_t)stat.size);
    assert(zip_fclose(f) == 0);
    return data;
}

int main(void) {
    assert(sceIoMkdir("ux0:data", 0777) == 0);
    assert(sceIoMkdir("ux0:data/LiveAreaDesigner", 0777) == 0);
    make_original();

    DesignerConfig *cfg = malloc(sizeof(*cfg));
    assert(cfg);
    designer_defaults(cfg);
    cfg->template_style = 0;
    cfg->frames[0][2].initialized = 1;
    snprintf(cfg->frames[0][2].text, sizeof(cfg->frames[0][2].text),
             "STALE PREVIOUS PROJECT");
    char message[128];
    assert(lad_import_existing_vpk("native-input.vpk", cfg, message, sizeof(message)));
    assert(cfg->template_style == 2); /* a3 */
    assert(cfg->frame_id == 2);       /* First present frame is not frame1. */
    assert(cfg->frames[0][2].initialized == 0); /* Old project must be cleared. */
    assert(cfg->frames[2][1].initialized && cfg->frames[2][3].initialized);
    assert(strcmp(cfg->frame_text, "HELLO FRAME TWO") == 0);
    assert(strcmp(cfg->frame_target, "https://example.org/?a=1&b=2") == 0);
    assert(cfg->w == 112 && cfg->h == 70);
    assert(cfg->x == 666 && cfg->y == 159);
    assert(lad_center_y(cfg) == 56); /* Native card origin: Y positive up. */
    assert(cfg->card_image[0] && cfg->button_image[0] && cfg->gate_image[0]);
    assert(cfg->icon_image[0] && cfg->boot_image[0]);
    FILE *image = fopen(cfg->button_image, "rb");
    assert(image);
    char content[64] = {0};
    assert(fread(content, 1, 13, image) == 13);
    fclose(image);
    assert(strcmp(content, "PNG-FRAME-TWO") == 0);
    FILE *roundtrip = tmpfile();
    assert(roundtrip && lad_write_template(roundtrip, cfg));
    assert(fseek(roundtrip, 0, SEEK_SET) == 0);
    char roundtrip_xml[8192] = {0};
    assert(fread(roundtrip_xml, 1, sizeof(roundtrip_xml) - 1, roundtrip) > 200);
    fclose(roundtrip);
    assert(strstr(roundtrip_xml,
      "width=\"112\" height=\"70\" x=\"12\" y=\"-8\">frame2.png"));

    zip_t *archive;
    int err = 0;
    archive = zip_open("native-input.vpk", ZIP_RDONLY, &err);
    assert(archive);
    char *original_exec = read_entry(archive, "eboot.bin");
    char *original_game = read_entry(archive, "game/data.bin");
    assert(zip_close(archive) == 0);

    snprintf(cfg->frame_text, sizeof(cfg->frame_text), "EDITED TEXT");
    designer_store_active_frame(cfg);
    assert(lad_write_modified_vpk("native-input.vpk", cfg, message, sizeof(message)));
    archive = zip_open(LAD_MODIFIED_VPK, ZIP_RDONLY, &err);
    assert(archive);
    char *modified_exec = read_entry(archive, "eboot.bin");
    char *modified_game = read_entry(archive, "game/data.bin");
    char *xml = read_entry(archive, "sce_sys/livearea/contents/template.xml");
    assert(strcmp(original_exec, modified_exec) == 0);
    assert(strcmp(original_game, modified_game) == 0);
    assert(strstr(xml, "EDITED TEXT"));
    assert(strstr(xml, "style=\"a3\""));
    char *frame = read_entry(archive, "sce_sys/livearea/contents/frame2.png");
    assert(strcmp(frame, "MODIFIED-FRAME") == 0);
    char *icon = read_entry(archive, "sce_sys/icon0.png");
    char *pic0 = read_entry(archive, "sce_sys/pic0.png");
    assert(strcmp(icon, "MODIFIED-ICON") == 0);
    assert(strcmp(pic0, "MODIFIED-PIC0") == 0);
    assert(zip_close(archive) == 0);

    assert(!lad_write_modified_vpk(LAD_MODIFIED_VPK, cfg, message, sizeof(message)));
    free(pic0); free(icon); free(frame); free(xml); free(modified_game); free(modified_exec);
    free(original_game); free(original_exec); free(cfg);
    puts("Native VPK host integration test passed");
    return 0;
}
