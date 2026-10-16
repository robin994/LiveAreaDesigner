#ifndef LIVEAREA_ASSETS_H
#define LIVEAREA_ASSETS_H

#include <stdbool.h>
#include <stddef.h>

#define LAD_PATH_MAX 512
#define LAD_ITEMS_MAX 256
#define LAD_PALETTE_COUNT 10
#define LAD_STYLE_COUNT 19

typedef struct {
    int x, y, w, h;
    int card_color;
    int button_color;
    int aspect_lock;
    int aspect_width;
    int aspect_height;
    int transparent_button;
    int template_style;
    int frame_id;
    int age_limit;
    int vita_only;
    int autoflip;
    int preview_template;
    char card_image[LAD_PATH_MAX];
    char button_image[LAD_PATH_MAX];
    char gate_image[LAD_PATH_MAX];
    char icon_image[LAD_PATH_MAX];
    char boot_image[LAD_PATH_MAX];
    char manual_dir[LAD_PATH_MAX];
    char frame_target[256];
    char frame_text[160];
    char frame_lang[16];
} DesignerConfig;

typedef struct {
    char name[256];
    bool directory;
} BrowserEntry;

typedef struct {
    char cwd[LAD_PATH_MAX]; /* Empty means the device-selection screen. */
    BrowserEntry items[LAD_ITEMS_MAX];
    int count;
    int selected;
    int scroll;
    char error[96];
} FileBrowser;

void designer_defaults(DesignerConfig *cfg);
void designer_load(DesignerConfig *cfg);
bool designer_save(const DesignerConfig *cfg);
bool lad_is_image(const char *name);

void browser_root(FileBrowser *browser);
bool browser_directory(FileBrowser *browser, const char *path);
bool browser_parent(FileBrowser *browser);
bool browser_activate(FileBrowser *browser, char *picked, size_t picked_size);

#endif
