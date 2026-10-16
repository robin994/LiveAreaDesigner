#include "assets.h"
#include <psp2/io/dirent.h>

#include <assert.h>
#include <stdio.h>
#include <string.h>

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
