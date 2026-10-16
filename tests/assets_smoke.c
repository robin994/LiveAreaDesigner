#include "assets.h"
#include <psp2/io/dirent.h>

#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>

static int cursor[8];
static const char *root_names[] = {"readme.txt", "IMAGE.JPG", "data", "cover.png"};
static const char *data_names[] = {"images", "unrelated.mp3", "button.JPEG"};
static const char *image_names[] = {"splash.png"};

SceUID sceIoDopen(const char *path) {
    int fd = -1;
    if (strcmp(path, "ux0:/") == 0) fd = 1;
    else if (strcmp(path, "uma0:/") == 0) fd = 2;
    else if (strcmp(path, "ux0:/data") == 0) fd = 3;
    else if (strcmp(path, "ux0:/data/images") == 0) fd = 4;
    if (fd >= 0) cursor[fd] = 0;
    return fd;
}
int sceIoDread(SceUID fd, SceIoDirent *entry) {
    const char **items = NULL;
    int n = 0;
    if (fd == 1) { items = root_names; n = 4; }
    if (fd == 3) { items = data_names; n = 3; }
    if (fd == 4) { items = image_names; n = 1; }
    if (cursor[fd] >= n) return 0;
    const char *name = items[cursor[fd]++];
    snprintf(entry->d_name, sizeof(entry->d_name), "%s", name);
    entry->d_stat.st_mode =
        strcmp(name, "data") == 0 || strcmp(name, "images") == 0
        ? 0x1000u : 0;
    return 1;
}
int sceIoDclose(SceUID fd) { (void)fd; return 0; }
int sceIoMkdir(const char *path, unsigned int mode) {
    (void)path; (void)mode; return 0;
}

int main(void) {
    DesignerConfig cfg;
    designer_defaults(&cfg);
    assert(cfg.x == 276 && cfg.y == 112 && cfg.card_color == 0);
    assert(cfg.preview_template == 0);
    designer_store_active_frame(&cfg);
    assert(cfg.frames[0][2].initialized && cfg.frames[0][2].w == 286);
    DesignerFrame fallback = {0};
    fallback.initialized = 1;
    fallback.x = 55;
    fallback.y = 125;
    fallback.w = 126;
    fallback.h = 82;
    fallback.button_color = 2;
    fallback.aspect_width = 126;
    fallback.aspect_height = 82;
    designer_load_active_frame(&cfg, 0, 1, &fallback);
    assert(cfg.frame_id == 1 && cfg.w == 126 && cfg.button_color == 2);
    snprintf(cfg.button_image, sizeof(cfg.button_image), "ux0:/data/frame1-red.png");
    snprintf(cfg.frame_text, sizeof(cfg.frame_text), "FIRST FRAME TEXT");
    cfg.x = 89;
    designer_store_active_frame(&cfg);
    designer_load_active_frame(&cfg, 0, 2, &fallback);
    snprintf(cfg.button_image, sizeof(cfg.button_image), "ux0:/data/frame2-blue.png");
    snprintf(cfg.frame_text, sizeof(cfg.frame_text), "SECOND FRAME TEXT");
    cfg.w = 98;
    designer_store_active_frame(&cfg);
    designer_load_active_frame(&cfg, 0, 1, &fallback);
    assert(cfg.x == 89 && cfg.w == 126 && cfg.frame_id == 1);
    assert(strcmp(cfg.frame_text, "FIRST FRAME TEXT") == 0);
    assert(strcmp(cfg.button_image, "ux0:/data/frame1-red.png") == 0);

    /* Run this test from build/host-test so that settings.ini stays temporary. */
    mkdir("ux0:data", 0777);
    mkdir("ux0:data/LiveAreaDesigner", 0777);
    assert(designer_save(&cfg));
    DesignerConfig restored;
    designer_load(&restored);
    assert(restored.frame_id == 1 && restored.w == 126);
    designer_load_active_frame(&restored, 0, 2, &fallback);
    assert(restored.w == 98);
    assert(strcmp(restored.frame_text, "SECOND FRAME TEXT") == 0);
    assert(strcmp(restored.button_image, "ux0:/data/frame2-blue.png") == 0);
    assert(lad_is_image("card.png") && lad_is_image("photo.JPG"));
    assert(lad_is_image("photo.jpeg") && !lad_is_image("photo.gif"));
    assert(!lad_is_image("photo.png.txt"));

    FileBrowser b;
    browser_root(&b);
    assert(b.count == 2 && strcmp(b.items[0].name, "ux0:/") == 0);
    char picked[LAD_PATH_MAX];
    assert(!browser_activate(&b, picked, sizeof(picked)));
    assert(strcmp(b.cwd, "ux0:/") == 0);
    assert(b.count == 3); /* readme.txt hidden; data first */
    assert(b.items[0].directory && strcmp(b.items[0].name, "data") == 0);

    b.selected = 1; /* cover.png comes before IMAGE.JPG */
    assert(browser_activate(&b, picked, sizeof(picked)));
    assert(strcmp(picked, "ux0:/cover.png") == 0);

    b.selected = 0;
    assert(!browser_activate(&b, picked, sizeof(picked)));
    assert(strcmp(b.cwd, "ux0:/data") == 0);
    assert(b.count == 2 && b.items[0].directory);
    b.selected = 0;
    assert(!browser_activate(&b, picked, sizeof(picked)));
    assert(strcmp(b.cwd, "ux0:/data/images") == 0);
    assert(b.count == 1);

    assert(browser_parent(&b) && strcmp(b.cwd, "ux0:/data") == 0);
    assert(browser_parent(&b) && strcmp(b.cwd, "ux0:/") == 0);
    assert(browser_parent(&b) && strcmp(b.cwd, "") == 0);
    assert(!browser_parent(&b));
    puts("Asset browser smoke tests passed");
    return 0;
}
