#include "assets.h"

#include <ctype.h>
#include <psp2/io/dirent.h>
#include <psp2/io/stat.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CONFIG_DIR "ux0:data/LiveAreaDesigner"
#define CONFIG_FILE CONFIG_DIR "/settings.ini"

static int ci_cmp(const char *a, const char *b) {
    for (; *a && *b; ++a, ++b) {
        int x = tolower((unsigned char)*a);
        int y = tolower((unsigned char)*b);
        if (x != y) return x - y;
    }
    return tolower((unsigned char)*a) - tolower((unsigned char)*b);
}

bool lad_is_image(const char *name) {
    const char *ext = strrchr(name, '.');
    if (!ext) return false;
    return ci_cmp(ext, ".png") == 0 ||
           ci_cmp(ext, ".jpg") == 0 ||
           ci_cmp(ext, ".jpeg") == 0;
}
bool lad_is_vpk(const char *name) {
    const char *ext = strrchr(name, '.');
    return ext && ci_cmp(ext, ".vpk") == 0;
}

void designer_defaults(DesignerConfig *cfg) {
    memset(cfg, 0, sizeof(*cfg));
    cfg->x = 276;
    cfg->y = 112;
    cfg->w = 286;
    cfg->h = 168;
    cfg->card_color = 0;
    cfg->button_color = 1;
    cfg->aspect_width = 286;
    cfg->aspect_height = 168;
    cfg->frame_id = 3;
    snprintf(cfg->frame_target, sizeof(cfg->frame_target), "https://example.com");
}

void designer_frame_snapshot(const DesignerConfig *cfg, DesignerFrame *out) {
    memset(out, 0, sizeof(*out));
    out->initialized = 1;
    out->x = cfg->x; out->y = cfg->y; out->w = cfg->w; out->h = cfg->h;
    out->button_color = cfg->button_color;
    out->aspect_lock = cfg->aspect_lock;
    out->aspect_width = cfg->aspect_width;
    out->aspect_height = cfg->aspect_height;
    out->transparent_button = cfg->transparent_button;
    out->age_limit = cfg->age_limit;
    out->vita_only = cfg->vita_only;
    out->autoflip = cfg->autoflip;
    snprintf(out->image, sizeof(out->image), "%s", cfg->button_image);
    snprintf(out->target, sizeof(out->target), "%s", cfg->frame_target);
    snprintf(out->text, sizeof(out->text), "%s", cfg->frame_text);
    snprintf(out->lang, sizeof(out->lang), "%s", cfg->frame_lang);
}

void designer_store_active_frame(DesignerConfig *cfg) {
    if (cfg->template_style >= 0 && cfg->template_style < LAD_STYLE_COUNT &&
        cfg->frame_id >= 1 && cfg->frame_id <= LAD_MAX_FRAMES)
        designer_frame_snapshot(cfg,
            &cfg->frames[cfg->template_style][cfg->frame_id - 1]);
}

void designer_load_active_frame(DesignerConfig *cfg, int style, int id,
                                const DesignerFrame *fallback) {
    if (style < 0 || style >= LAD_STYLE_COUNT || id < 1 || id > LAD_MAX_FRAMES)
        return;
    DesignerFrame *saved = &cfg->frames[style][id - 1];
    if (!saved->initialized && fallback) *saved = *fallback;
    if (!saved->initialized) return;
    cfg->template_style = style;
    cfg->frame_id = id;
    cfg->x = saved->x; cfg->y = saved->y;
    cfg->w = saved->w; cfg->h = saved->h;
    cfg->button_color = saved->button_color;
    cfg->aspect_lock = saved->aspect_lock;
    cfg->aspect_width = saved->aspect_width;
    cfg->aspect_height = saved->aspect_height;
    cfg->transparent_button = saved->transparent_button;
    cfg->age_limit = saved->age_limit;
    cfg->vita_only = saved->vita_only;
    cfg->autoflip = saved->autoflip;
    snprintf(cfg->button_image, sizeof(cfg->button_image), "%s", saved->image);
    snprintf(cfg->frame_target, sizeof(cfg->frame_target), "%s", saved->target);
    snprintf(cfg->frame_text, sizeof(cfg->frame_text), "%s", saved->text);
    snprintf(cfg->frame_lang, sizeof(cfg->frame_lang), "%s", saved->lang);
}

void designer_load(DesignerConfig *cfg) {
    designer_defaults(cfg);
    FILE *f = fopen(CONFIG_FILE, "rb");
    if (!f) return;

    char line[1024];
    while (fgets(line, sizeof(line), f)) {
        char *eq = strchr(line, '=');
        if (!eq) continue;
        *eq++ = '\0';
        eq[strcspn(eq, "\r\n")] = '\0';
        int style, id;
        char field[48];
        if (sscanf(line, "frame.%d.%d.%47s", &style, &id, field) == 3) {
            if (style < 0 || style >= LAD_STYLE_COUNT || id < 1 || id > LAD_MAX_FRAMES)
                continue;
            DesignerFrame *item = &cfg->frames[style][id - 1];
            item->initialized = 1;
            if (!strcmp(field, "x")) item->x = atoi(eq);
            else if (!strcmp(field, "y")) item->y = atoi(eq);
            else if (!strcmp(field, "w")) item->w = atoi(eq);
            else if (!strcmp(field, "h")) item->h = atoi(eq);
            else if (!strcmp(field, "color")) item->button_color = atoi(eq);
            else if (!strcmp(field, "lock")) item->aspect_lock = atoi(eq);
            else if (!strcmp(field, "aspectw")) item->aspect_width = atoi(eq);
            else if (!strcmp(field, "aspecth")) item->aspect_height = atoi(eq);
            else if (!strcmp(field, "alpha")) item->transparent_button = atoi(eq);
            else if (!strcmp(field, "age")) item->age_limit = atoi(eq);
            else if (!strcmp(field, "model")) item->vita_only = atoi(eq);
            else if (!strcmp(field, "autoflip")) item->autoflip = atoi(eq);
            else if (!strcmp(field, "image") && strlen(eq) < sizeof(item->image))
                strcpy(item->image, eq);
            else if (!strcmp(field, "target") && strlen(eq) < sizeof(item->target))
                strcpy(item->target, eq);
            else if (!strcmp(field, "text") && strlen(eq) < sizeof(item->text))
                strcpy(item->text, eq);
            else if (!strcmp(field, "lang") && strlen(eq) < sizeof(item->lang))
                strcpy(item->lang, eq);
            continue;
        }
        if (strcmp(line, "x") == 0) cfg->x = atoi(eq);
        else if (strcmp(line, "y") == 0) cfg->y = atoi(eq);
        else if (strcmp(line, "w") == 0) cfg->w = atoi(eq);
        else if (strcmp(line, "h") == 0) cfg->h = atoi(eq);
        else if (strcmp(line, "card_color") == 0) cfg->card_color = atoi(eq);
        else if (strcmp(line, "button_color") == 0) cfg->button_color = atoi(eq);
        else if (strcmp(line, "aspect_lock") == 0) cfg->aspect_lock = atoi(eq);
        else if (strcmp(line, "aspect_width") == 0) cfg->aspect_width = atoi(eq);
        else if (strcmp(line, "aspect_height") == 0) cfg->aspect_height = atoi(eq);
        else if (strcmp(line, "transparent_button") == 0) cfg->transparent_button = atoi(eq);
        else if (strcmp(line, "template_style") == 0) cfg->template_style = atoi(eq);
        else if (strcmp(line, "frame_id") == 0) cfg->frame_id = atoi(eq);
        else if (strcmp(line, "age_limit") == 0) cfg->age_limit = atoi(eq);
        else if (strcmp(line, "vita_only") == 0) cfg->vita_only = atoi(eq);
        else if (strcmp(line, "autoflip") == 0) cfg->autoflip = atoi(eq);
        else if (strcmp(line, "preview_template") == 0) cfg->preview_template = atoi(eq);
        else if (strcmp(line, "invert_x") == 0) cfg->invert_x = atoi(eq) != 0;
        else if (strcmp(line, "invert_y") == 0) cfg->invert_y = atoi(eq) != 0;
        else if (strcmp(line, "card_image") == 0 && strlen(eq) < sizeof(cfg->card_image))
            strcpy(cfg->card_image, eq);
        else if (strcmp(line, "button_image") == 0 && strlen(eq) < sizeof(cfg->button_image))
            strcpy(cfg->button_image, eq);
        else if (strcmp(line, "gate_image") == 0 && strlen(eq) < sizeof(cfg->gate_image))
            strcpy(cfg->gate_image, eq);
        else if (strcmp(line, "icon_image") == 0 && strlen(eq) < sizeof(cfg->icon_image))
            strcpy(cfg->icon_image, eq);
        else if (strcmp(line, "boot_image") == 0 && strlen(eq) < sizeof(cfg->boot_image))
            strcpy(cfg->boot_image, eq);
        else if (strcmp(line, "manual_dir") == 0 && strlen(eq) < sizeof(cfg->manual_dir))
            strcpy(cfg->manual_dir, eq);
        else if (strcmp(line, "frame_target") == 0 && strlen(eq) < sizeof(cfg->frame_target))
            strcpy(cfg->frame_target, eq);
        else if (strcmp(line, "frame_text") == 0 && strlen(eq) < sizeof(cfg->frame_text))
            strcpy(cfg->frame_text, eq);
        else if (strcmp(line, "frame_lang") == 0 && strlen(eq) < sizeof(cfg->frame_lang))
            strcpy(cfg->frame_lang, eq);
    }
    fclose(f);
    /* Read edited per-frame settings for the currently selected frame too.
       The legacy top-level fields remain a fallback for old INI files. */
    if (cfg->template_style >= 0 && cfg->template_style < LAD_STYLE_COUNT &&
        cfg->frame_id >= 1 && cfg->frame_id <= LAD_MAX_FRAMES &&
        cfg->frames[cfg->template_style][cfg->frame_id - 1].initialized) {
        designer_load_active_frame(cfg, cfg->template_style, cfg->frame_id, NULL);
    }
}

bool designer_save(const DesignerConfig *cfg) {
    sceIoMkdir(CONFIG_DIR, 0777); /* Already exists is harmless. */
    FILE *f = fopen(CONFIG_FILE, "wb");
    if (!f) return false;
    int ok = fprintf(f,
        "x=%d\ny=%d\nw=%d\nh=%d\ncard_color=%d\nbutton_color=%d\n"
        "aspect_lock=%d\naspect_width=%d\naspect_height=%d\ntransparent_button=%d\n"
        "template_style=%d\nframe_id=%d\nage_limit=%d\nvita_only=%d\nautoflip=%d\npreview_template=%d\n"
        "invert_x=%d\ninvert_y=%d\n"
        "card_image=%s\nbutton_image=%s\ngate_image=%s\nicon_image=%s\nboot_image=%s\nmanual_dir=%s\n"
        "frame_target=%s\nframe_text=%s\nframe_lang=%s\n",
        cfg->x, cfg->y, cfg->w, cfg->h, cfg->card_color, cfg->button_color,
        cfg->aspect_lock, cfg->aspect_width, cfg->aspect_height, cfg->transparent_button,
        cfg->template_style, cfg->frame_id, cfg->age_limit, cfg->vita_only, cfg->autoflip,
        cfg->preview_template, cfg->invert_x, cfg->invert_y,
        cfg->card_image, cfg->button_image, cfg->gate_image, cfg->icon_image,
        cfg->boot_image, cfg->manual_dir, cfg->frame_target, cfg->frame_text, cfg->frame_lang);
    for (int style = 0; style < LAD_STYLE_COUNT; ++style) {
        for (int id = 1; id <= LAD_MAX_FRAMES; ++id) {
            DesignerFrame active;
            const DesignerFrame *item = &cfg->frames[style][id - 1];
            if (style == cfg->template_style && id == cfg->frame_id) {
                designer_frame_snapshot(cfg, &active);
                item = &active;
            }
            if (!item->initialized) continue;
            int result = fprintf(f,
                "frame.%d.%d.x=%d\nframe.%d.%d.y=%d\nframe.%d.%d.w=%d\nframe.%d.%d.h=%d\n"
                "frame.%d.%d.color=%d\nframe.%d.%d.lock=%d\nframe.%d.%d.aspectw=%d\n"
                "frame.%d.%d.aspecth=%d\nframe.%d.%d.alpha=%d\n"
                "frame.%d.%d.age=%d\nframe.%d.%d.model=%d\nframe.%d.%d.autoflip=%d\n"
                "frame.%d.%d.image=%s\nframe.%d.%d.target=%s\nframe.%d.%d.text=%s\nframe.%d.%d.lang=%s\n",
                style,id,item->x, style,id,item->y, style,id,item->w, style,id,item->h,
                style,id,item->button_color, style,id,item->aspect_lock,
                style,id,item->aspect_width, style,id,item->aspect_height,
                style,id,item->transparent_button, style,id,item->age_limit,
                style,id,item->vita_only, style,id,item->autoflip,
                style,id,item->image, style,id,item->target, style,id,item->text,
                style,id,item->lang);
            if (result < 0) ok = -1;
        }
    }
    if (fflush(f) != 0) ok = -1;
    if (fclose(f) != 0) ok = -1;
    return ok > 0;
}

static int entry_cmp(const void *va, const void *vb) {
    const BrowserEntry *a = (const BrowserEntry *)va;
    const BrowserEntry *b = (const BrowserEntry *)vb;
    if (a->directory != b->directory) return a->directory ? -1 : 1;
    return ci_cmp(a->name, b->name);
}

static void add_entry(FileBrowser *b, const char *name, bool directory) {
    if (b->count >= LAD_ITEMS_MAX || strlen(name) >= sizeof(b->items[0].name))
        return;
    BrowserEntry *entry = &b->items[b->count++];
    snprintf(entry->name, sizeof(entry->name), "%s", name);
    entry->directory = directory;
}

void browser_root(FileBrowser *b) {
    static const char *devices[] = {
        "ux0:/", "uma0:/", "imc0:/", "xmc0:/", "grw0:/", "ur0:/"
    };
    b->cwd[0] = '\0';
    b->count = b->selected = b->scroll = 0;
    b->error[0] = '\0';
    for (size_t i = 0; i < sizeof(devices) / sizeof(devices[0]); ++i) {
        SceUID fd = sceIoDopen(devices[i]);
        if (fd >= 0) {
            sceIoDclose(fd);
            add_entry(b, devices[i], true);
        }
    }
    if (b->count == 0) snprintf(b->error, sizeof(b->error), "NO STORAGE AVAILABLE");
}

bool browser_directory(FileBrowser *b, const char *path) {
    if (!path || !*path || strlen(path) >= sizeof(b->cwd)) return false;
    SceUID fd = sceIoDopen(path);
    if (fd < 0) {
        snprintf(b->error, sizeof(b->error), "CANNOT OPEN DIRECTORY");
        return false;
    }

    snprintf(b->cwd, sizeof(b->cwd), "%s", path);
    b->count = b->selected = b->scroll = 0;
    b->error[0] = '\0';
    SceIoDirent ent;
    int rc;
    while (1) {
        memset(&ent, 0, sizeof(ent));
        rc = sceIoDread(fd, &ent);
        if (rc <= 0) break;
        if (strcmp(ent.d_name, ".") == 0 || strcmp(ent.d_name, "..") == 0)
            continue;
        bool is_dir = SCE_S_ISDIR(ent.d_stat.st_mode);
        if (is_dir || (b->filter_vpk ? lad_is_vpk(ent.d_name) :
                       lad_is_image(ent.d_name)))
            add_entry(b, ent.d_name, is_dir);
    }
    sceIoDclose(fd);
    if (b->count > 1) qsort(b->items, (size_t)b->count, sizeof(b->items[0]), entry_cmp);
    if (rc < 0) snprintf(b->error, sizeof(b->error), "DIRECTORY READ ERROR");
    else if (b->count == LAD_ITEMS_MAX)
        snprintf(b->error, sizeof(b->error), "SHOWING FIRST 256 ITEMS");
    return true;
}

bool browser_parent(FileBrowser *b) {
    if (!b->cwd[0]) return false;
    char path[LAD_PATH_MAX];
    snprintf(path, sizeof(path), "%s", b->cwd);
    size_t n = strlen(path);
    while (n > 0 && path[n - 1] == '/') path[--n] = '\0';
    char *last = strrchr(path, '/');
    if (!last) {
        browser_root(b);
        return true;
    }
    /* root (ux0:/) is represented by a trailing slash */
    if (last > path && last[-1] == ':') {
        last[1] = '\0';
    } else if (last == path) {
        browser_root(b);
        return true;
    } else {
        *last = '\0';
    }
    return browser_directory(b, path);
}

bool browser_activate(FileBrowser *b, char *picked, size_t picked_size) {
    if (b->selected < 0 || b->selected >= b->count) return false;
    BrowserEntry *entry = &b->items[b->selected];
    char path[LAD_PATH_MAX];
    int n;
    if (b->cwd[0]) {
        const char *slash = b->cwd[strlen(b->cwd) - 1] == '/' ? "" : "/";
        n = snprintf(path, sizeof(path), "%s%s%s", b->cwd, slash, entry->name);
    } else {
        n = snprintf(path, sizeof(path), "%s", entry->name);
    }
    if (n < 0 || (size_t)n >= sizeof(path)) {
        snprintf(b->error, sizeof(b->error), "PATH TOO LONG");
        return false;
    }
    if (entry->directory) {
        browser_directory(b, path);
        return false;
    }
    if (picked_size == 0 || (size_t)n >= picked_size) {
        snprintf(b->error, sizeof(b->error), "PATH TOO LONG");
        return false;
    }
    snprintf(picked, picked_size, "%s", path);
    return true;
}
