#include "assets.h"
#include "exporter.h"
#include "font.h"
#include "template_preview.h"
#include "template_slots.h"
#include "vpk_editor.h"

#include <SDL.h>
#include <SDL_image.h>
#include <stdbool.h>
#include <psp2/io/stat.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define SW 960
#define SH 544
#define CARD_X 60
#define CARD_Y 44
#define CARD_W 840
#define CARD_H 500
#define SAFE_TOP 44
#define MIN_SIZE 24
#define BROWSER_ROWS 10
#define BROWSER_Y 135
#define BROWSER_STEP 33
#define MAX_IMAGE_BYTES (12 * 1024 * 1024)

typedef enum { SCREEN_EDITOR, SCREEN_SETTINGS, SCREEN_BROWSER } Screen;

typedef struct { int x, y, w, h; } Rect;

typedef struct {
    SDL_Window *window;
    SDL_Renderer *renderer;
    SDL_GameController *pad;
    SDL_Texture *card_texture;
    SDL_Texture *button_texture;
    SDL_Texture *frame_previews[LAD_MAX_FRAMES];
    SDL_Texture *gate_texture;
    Font font;
    DesignerConfig cfg;
    FileBrowser browser;
    Screen screen;
    int setting_row;
    int settings_tab;
    int browse_target;
    bool resize_mode;
    bool drag;
    bool drag_resize;
    bool front_finger_active;
    SDL_TouchID front_touch_id;
    SDL_FingerID front_finger_id;
    bool dirty;
    bool running;
    int grab_x, grab_y;
    Rect start_button;
    char message[112];
    char vpk_source[LAD_PATH_MAX]; /* Input file is always read-only. */
    Uint32 message_until;
} App;

static const SDL_Color palette[LAD_PALETTE_COUNT] = {
    {113, 0, 158, 255},   /* purple */
    {224, 20, 208, 255},  /* magenta */
    {32, 106, 190, 255},  /* blue */
    {26, 173, 221, 255},  /* cyan */
    {30, 158, 105, 255},  /* green */
    {247, 203, 58, 255},  /* yellow */
    {245, 143, 55, 255},  /* orange */
    {213, 60, 90, 255},   /* red */
    {230, 228, 240, 255},/* white */
    {56, 65, 85, 255}     /* slate */
};
static const char *color_names[LAD_PALETTE_COUNT] = {
    "PURPLE", "MAGENTA", "BLUE", "CYAN", "GREEN", "YELLOW",
    "ORANGE", "RED", "WHITE", "SLATE"
};
static const SDL_Color TEXT = {243, 242, 252, 255};
static const SDL_Color MUTED = {180, 185, 211, 255};
static const SDL_Color GOLD = {255, 222, 79, 255};

static int clampi(int v, int lo, int hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}
static bool load_texture(App *a, const char *path, SDL_Texture **out);
static void reload_frame_previews(App *a);
static int roundi(float x) { return (int)(x + (x >= 0.0f ? 0.5f : -0.5f)); }
static void constrain_size(App *a, Rect origin, int dw, int dh) {
    const int max_w = CARD_W - origin.x;
    const int max_h = CARD_H - origin.y;
    if (a->cfg.aspect_lock && a->cfg.aspect_width > 0 && a->cfg.aspect_height > 0) {
        const float ratio = (float)a->cfg.aspect_width / a->cfg.aspect_height;
        int w, h;
        if (abs(dw) * origin.h >= abs(dh) * origin.w) {
            w = clampi(origin.w + dw, MIN_SIZE, max_w);
            h = roundi(w / ratio);
        } else {
            h = clampi(origin.h + dh, MIN_SIZE, max_h);
            w = roundi(h * ratio);
        }
        if (w > max_w) { w = max_w; h = roundi(w / ratio); }
        if (h > max_h) { h = max_h; w = roundi(h * ratio); }
        if (w < MIN_SIZE) { w = MIN_SIZE; h = roundi(w / ratio); }
        if (h < MIN_SIZE) { h = MIN_SIZE; w = roundi(h * ratio); }
        a->cfg.w = clampi(w, MIN_SIZE, max_w);
        a->cfg.h = clampi(h, MIN_SIZE, max_h);
    } else {
        a->cfg.w = clampi(origin.w + dw, MIN_SIZE, max_w);
        a->cfg.h = clampi(origin.h + dh, MIN_SIZE, max_h);
    }
}
static bool hit(int px, int py, Rect rect) {
    return px >= rect.x && py >= rect.y &&
           px < rect.x + rect.w && py < rect.y + rect.h;
}
static void box(SDL_Renderer *r, Rect b, SDL_Color col, Uint8 alpha) {
    SDL_SetRenderDrawColor(r, col.r, col.g, col.b, alpha);
    SDL_Rect rect = {b.x, b.y, b.w, b.h};
    SDL_RenderFillRect(r, &rect);
}
static void outline(SDL_Renderer *r, Rect b, SDL_Color col) {
    SDL_SetRenderDrawColor(r, col.r, col.g, col.b, 255);
    SDL_Rect rect = {b.x, b.y, b.w, b.h};
    SDL_RenderDrawRect(r, &rect);
}
static void label(App *a, int x, int y, const char *txt, int scale,
                  SDL_Color col, int max) {
    font_draw(&a->font, a->renderer, x, y, txt, scale, col, max);
}
static void action_button(App *a, Rect bounds, const char *txt, bool active) {
    SDL_Color back = active ? (SDL_Color){51, 74, 104, 255} :
                              (SDL_Color){34, 46, 72, 255};
    box(a->renderer, bounds, back, 255);
    outline(a->renderer, bounds, active ? GOLD : MUTED);
    label(a, bounds.x + 11, bounds.y + 7, txt, 2, TEXT, 0);
}
static void set_status(App *a, const char *message) {
    snprintf(a->message, sizeof(a->message), "%s", message);
    a->message_until = SDL_GetTicks() + 4500;
}
static void toggle_template_preview(App *a) {
    a->cfg.preview_template = !a->cfg.preview_template;
    reload_frame_previews(a);
    a->dirty = true;
    set_status(a, a->cfg.preview_template ?
               "TEMPLATE PREVIEW ON - NATIVE RCO FRAME GEOMETRY" :
               "TEMPLATE PREVIEW OFF");
}
static void select_frame(App *a, int style, int id) {
    if (style < 0 || style >= LAD_STYLE_COUNT) style = 0;
    id = clampi(id, 1, lad_template_frame_count(style));
    if (style == a->cfg.template_style && id == a->cfg.frame_id) return;
    designer_store_active_frame(&a->cfg);
    const LadTemplateSlot *slot = lad_template_frame(style, id);
    DesignerFrame fallback;
    memset(&fallback, 0, sizeof(fallback));
    fallback.initialized = 1;
    const int width = slot && slot->width >= MIN_SIZE ? slot->width : 120;
    const int height = slot && slot->height >= MIN_SIZE ? slot->height : 80;
    fallback.w = width < 286 ? width : 286;
    fallback.h = height < 168 ? height : 168;
    fallback.x = 420 + (slot ? slot->center_x : 0) - fallback.w / 2;
    fallback.y = 250 - (slot ? slot->center_y : 0) - fallback.h / 2;
    fallback.aspect_width = fallback.w;
    fallback.aspect_height = fallback.h;
    fallback.button_color = 1;
    if (id == 1)
        snprintf(fallback.target, sizeof(fallback.target), "%s",
                 LAD_DEFAULT_FRAME1_TARGET);
    designer_load_active_frame(&a->cfg, style, id, &fallback);
    a->cfg.x = clampi(a->cfg.x, 0, CARD_W - a->cfg.w);
    a->cfg.y = clampi(a->cfg.y, SAFE_TOP, CARD_H - a->cfg.h);
    load_texture(a, a->cfg.button_image, &a->button_texture);
    reload_frame_previews(a);
    a->dirty = true;
}
static void cycle_template_style(App *a) {
    select_frame(a, (a->cfg.template_style + 1) % LAD_STYLE_COUNT,
                 a->cfg.frame_id);
    char status_text[96];
    snprintf(status_text, sizeof(status_text), "TEMPLATE STYLE: %s",
             lad_preview_style_name(a->cfg.template_style));
    set_status(a, status_text);
}
static void cycle_template_frame(App *a) {
    select_frame(a, a->cfg.template_style,
                 (a->cfg.frame_id % lad_template_frame_count(a->cfg.template_style)) + 1);
    char status_text[96];
    snprintf(status_text, sizeof(status_text), "TEMPLATE FRAME: %d", a->cfg.frame_id);
    set_status(a, status_text);
}
static void normalize(App *a) {
    a->cfg.w = clampi(a->cfg.w, MIN_SIZE, CARD_W);
    a->cfg.h = clampi(a->cfg.h, MIN_SIZE, CARD_H - SAFE_TOP);
    a->cfg.x = clampi(a->cfg.x, 0, CARD_W - a->cfg.w);
    a->cfg.y = clampi(a->cfg.y, SAFE_TOP, CARD_H - a->cfg.h);
    a->cfg.card_color = clampi(a->cfg.card_color, 0, LAD_PALETTE_COUNT - 1);
    a->cfg.button_color = clampi(a->cfg.button_color, 0, LAD_PALETTE_COUNT - 1);
    a->cfg.template_style = clampi(a->cfg.template_style, 0, LAD_STYLE_COUNT - 1);
    a->cfg.frame_id = clampi(a->cfg.frame_id, 1,
                             lad_template_frame_count(a->cfg.template_style));
    a->cfg.preview_template = a->cfg.preview_template ? 1 : 0;
    if (a->cfg.aspect_width <= 0 || a->cfg.aspect_height <= 0) {
        a->cfg.aspect_width = a->cfg.w;
        a->cfg.aspect_height = a->cfg.h;
    }
}
static void save(App *a) {
    if (!a->dirty) return;
    if (designer_save(&a->cfg)) a->dirty = false;
    else set_status(a, "ERROR SAVING SETTINGS TO UX0");
}
static void settings_close(App *a) {
    save(a);
    a->screen = SCREEN_EDITOR;
}
static bool load_texture_limited(App *a, const char *path,
                                 SDL_Texture **out, int max_w, int max_h) {
    if (!*path) {
        SDL_DestroyTexture(*out);
        *out = NULL;
        return true;
    }
    SceIoStat stat;
    if (!lad_is_image(path) || sceIoGetstat(path, &stat) < 0 ||
        stat.st_size > MAX_IMAGE_BYTES || stat.st_size <= 0) {
        set_status(a, "IMAGE UNAVAILABLE OR OVER 12MB");
        return false;
    }
    SDL_Surface *surface = IMG_Load(path);
    if (!surface) {
        set_status(a, "FAILED TO DECODE PNG OR JPG");
        return false;
    }
    if (surface->w > 2048 || surface->h > 2048 ||
        surface->w <= 0 || surface->h <= 0 ||
        (long long)surface->w * surface->h > 2048LL * 2048LL) {
        SDL_FreeSurface(surface);
        set_status(a, "IMAGE MUST BE 2048PX OR SMALLER");
        return false;
    }
    /* Keep decoded previews close to their onscreen size. A 2048x2048 PNG
       otherwise consumes ~16MB VRAM for every single frame. */
    if (surface->w > max_w || surface->h > max_h) {
        const float scale_x = (float)max_w / surface->w;
        const float scale_y = (float)max_h / surface->h;
        const float factor = scale_x < scale_y ? scale_x : scale_y;
        const int w = clampi(roundi(surface->w * factor), 1, max_w);
        const int h = clampi(roundi(surface->h * factor), 1, max_h);
        SDL_Surface *scaled = SDL_CreateRGBSurfaceWithFormat(0, w, h, 32,
                                                              SDL_PIXELFORMAT_RGBA32);
        if (!scaled || SDL_BlitScaled(surface, NULL, scaled, NULL) < 0) {
            SDL_FreeSurface(scaled);
            SDL_FreeSurface(surface);
            set_status(a, "FRAME IMAGE RESIZE FAILED");
            return false;
        }
        SDL_FreeSurface(surface);
        surface = scaled;
    }
    SDL_Texture *texture = SDL_CreateTextureFromSurface(a->renderer, surface);
    SDL_FreeSurface(surface);
    if (!texture) {
        set_status(a, "INSUFFICIENT VIDEO MEMORY FOR IMAGE");
        return false;
    }
    SDL_SetTextureBlendMode(texture, SDL_BLENDMODE_BLEND);
    SDL_DestroyTexture(*out);
    *out = texture;
    return true;
}
static bool load_texture(App *a, const char *path, SDL_Texture **out) {
    return load_texture_limited(a, path, out, 960, 544);
}
static void reload_frame_previews(App *a) {
    for (int i = 0; i < LAD_MAX_FRAMES; ++i) {
        SDL_DestroyTexture(a->frame_previews[i]);
        a->frame_previews[i] = NULL;
    }
    if (!a->cfg.preview_template) return;
    const int count = lad_template_frame_count(a->cfg.template_style);
    for (int id = 1; id <= count; ++id) {
        if (id == a->cfg.frame_id) continue;
        DesignerFrame item;
        lad_resolve_frame(&a->cfg, id, &item);
        if (item.image[0])
            load_texture_limited(a, item.image, &a->frame_previews[id - 1],
                clampi(item.w, 1, 840), clampi(item.h, 1, 500));
    }
}
static void choose_image(App *a, const char *path) {
    char *chosen;
    SDL_Texture **tex;
    SDL_Texture *temp = NULL;
    switch (a->browse_target) {
    case 0: chosen = a->cfg.card_image; tex = &a->card_texture; break;
    case 1: chosen = a->cfg.button_image; tex = &a->button_texture; break;
    case 2: chosen = a->cfg.gate_image; tex = &a->gate_texture; break;
    case 3: chosen = a->cfg.icon_image; tex = &temp; break;
    default: chosen = a->cfg.boot_image; tex = &temp; break;
    }
    if (!load_texture(a, path, tex)) return;
    if (temp) SDL_DestroyTexture(temp);
    if (a->browse_target == 1) {
        SDL_Surface *source = IMG_Load(path);
        if (source) {
            a->cfg.aspect_width = source->w;
            a->cfg.aspect_height = source->h;
            if (a->cfg.aspect_lock) {
                Rect rect = {a->cfg.x, a->cfg.y, a->cfg.w, a->cfg.h};
                constrain_size(a, rect, 0, roundi(rect.w *
                                               (float)source->h / source->w) - rect.h);
            }
            SDL_FreeSurface(source);
        }
    }
    snprintf(chosen, LAD_PATH_MAX, "%s", path);
    a->dirty = true;
    a->screen = SCREEN_SETTINGS;
    set_status(a, "IMAGE LOADED");
}
static void clear_image(App *a, int target) {
    if (target == 0) {
        a->cfg.card_image[0] = '\0';
        load_texture(a, "", &a->card_texture);
    } else if (target == 1) {
        a->cfg.button_image[0] = '\0';
        load_texture(a, "", &a->button_texture);
    } else if (target == 2) {
        a->cfg.gate_image[0] = '\0';
        load_texture(a, "", &a->gate_texture);
    } else if (target == 3) {
        a->cfg.icon_image[0] = '\0';
    } else {
        a->cfg.boot_image[0] = '\0';
    }
    a->dirty = true;
    set_status(a, "IMAGE CLEARED");
}
static void open_browser(App *a, int target) {
    a->browse_target = target;
    a->browser.filter_vpk = target == 6;
    browser_root(&a->browser);
    a->screen = SCREEN_BROWSER;
}
static void browser_scroll(FileBrowser *b) {
    if (b->selected < b->scroll) b->scroll = b->selected;
    if (b->selected >= b->scroll + BROWSER_ROWS)
        b->scroll = b->selected - BROWSER_ROWS + 1;
}
static void browser_select(App *a) {
    char picked[LAD_PATH_MAX];
    if (!browser_activate(&a->browser, picked, sizeof(picked))) return;
    if (a->browse_target != 6) {
        choose_image(a, picked);
        return;
    }
    char feedback[112];
    const int invert_x = a->cfg.invert_x;
    const int invert_y = a->cfg.invert_y;
    if (!lad_import_existing_vpk(picked, &a->cfg, feedback, sizeof(feedback))) {
        set_status(a, feedback); return;
    }
    /* Sign preferences belong to the editor, not the imported VPK. */
    a->cfg.invert_x = invert_x;
    a->cfg.invert_y = invert_y;
    snprintf(a->vpk_source, sizeof(a->vpk_source), "%s", picked);
    normalize(a);
    load_texture(a, a->cfg.card_image, &a->card_texture);
    load_texture(a, a->cfg.button_image, &a->button_texture);
    load_texture(a, a->cfg.gate_image, &a->gate_texture);
    reload_frame_previews(a);
    a->settings_tab = 1;
    a->screen = SCREEN_SETTINGS;
    a->dirty = true;
    set_status(a, feedback);
}
static void patch_selected_vpk(App *a) {
    if (!a->vpk_source[0]) {
        set_status(a, "OPEN AN EXISTING VPK FIRST"); return;
    }
    char feedback[112];
    save(a);
    if (!lad_write_modified_vpk(a->vpk_source, &a->cfg,
                                feedback, sizeof(feedback))) {
        set_status(a, feedback); return;
    }
    set_status(a, "SAVED: UX0:DATA/LIVEAREADESIGNER/EXPORT/MODIFIED_LIVEAREA.VPK");
}
static void select_manual_directory(App *a) {
    if (a->browse_target != 5 || !a->browser.cwd[0]) {
        set_status(a, "ENTER A MANUAL FOLDER FIRST");
        return;
    }
    snprintf(a->cfg.manual_dir, sizeof(a->cfg.manual_dir), "%s", a->browser.cwd);
    a->dirty = true;
    a->screen = SCREEN_SETTINGS;
    set_status(a, "MANUAL FOLDER SELECTED");
}
static void editor_adjust(App *a, int dx, int dy, int step) {
    if (a->resize_mode) {
        Rect initial = {a->cfg.x, a->cfg.y, a->cfg.w, a->cfg.h};
        constrain_size(a, initial, dx * step, dy * step);
    } else {
        a->cfg.x += dx * step;
        a->cfg.y += dy * step;
    }
    normalize(a);
    if (a->cfg.preview_template) {
        const LadTemplateSlot *slot =
            lad_template_frame(a->cfg.template_style, a->cfg.frame_id);
        if (slot && slot->width >= MIN_SIZE && slot->height >= MIN_SIZE) {
            if (a->cfg.w > slot->width) a->cfg.w = slot->width;
            if (a->cfg.h > slot->height) a->cfg.h = slot->height;
            const int left = 420 + slot->center_x - slot->width / 2;
            const int top = 250 - slot->center_y - slot->height / 2;
            a->cfg.x = clampi(a->cfg.x, left, left + slot->width - a->cfg.w);
            a->cfg.y = clampi(a->cfg.y, top, top + slot->height - a->cfg.h);
        }
    }
    a->dirty = true;
}
static void fit_image_to_template_frame(App *a) {
    const LadTemplateSlot *slot =
        lad_template_frame(a->cfg.template_style, a->cfg.frame_id);
    if (!slot || slot->width < MIN_SIZE || slot->height < MIN_SIZE) {
        set_status(a, "FRAME HAS DYNAMIC OR UNSUPPORTED DIMENSIONS");
        return;
    }
    int w = a->cfg.w < slot->width ? a->cfg.w : slot->width;
    int h = a->cfg.h < slot->height ? a->cfg.h : slot->height;
    if (a->cfg.aspect_lock && a->cfg.aspect_height > 0) {
        const float ratio = (float)a->cfg.aspect_width / a->cfg.aspect_height;
        if (w > roundi(h * ratio)) w = roundi(h * ratio);
        h = roundi(w / ratio);
        if (h > slot->height) { h = slot->height; w = roundi(h * ratio); }
    }
    a->cfg.w = clampi(w, MIN_SIZE, CARD_W);
    a->cfg.h = clampi(h, MIN_SIZE, CARD_H - SAFE_TOP);
    a->cfg.x = 420 + slot->center_x - a->cfg.w / 2;
    a->cfg.y = 250 - slot->center_y - a->cfg.h / 2;
    normalize(a);
    a->dirty = true;
    set_status(a, "IMAGE FITTED TO THE SELECTED RCO FRAME");
}
static void settings_adjust(App *a, int delta) {
    int *p = NULL;
    if (!a->settings_tab) {
        if (a->setting_row == 2) p = &a->cfg.card_color;
        if (a->setting_row == 3) p = &a->cfg.button_color;
    } else {
        if (a->setting_row == 12 || a->setting_row == 13) {
            int *inverted = a->setting_row == 12 ? &a->cfg.invert_x : &a->cfg.invert_y;
            *inverted = !*inverted;
            a->dirty = true;
            return;
        }
        if (a->setting_row == 3) p = &a->cfg.template_style;
        if (a->setting_row == 4) p = &a->cfg.frame_id;
        if (a->setting_row == 5) {
            a->cfg.aspect_lock = !a->cfg.aspect_lock;
            if (a->cfg.aspect_lock) {
                a->cfg.aspect_width = a->cfg.w;
                a->cfg.aspect_height = a->cfg.h;
            }
            a->dirty = true; return;
        }
        if (a->setting_row == 6) {
            a->cfg.transparent_button = !a->cfg.transparent_button;
            a->dirty = true; return;
        }
        if (a->setting_row == 9) {
            toggle_template_preview(a);
            return;
        }
    }
    if (!p) return;
    const int range = a->settings_tab ?
        (a->setting_row == 3 ? LAD_STYLE_COUNT :
         lad_template_frame_count(a->cfg.template_style)) : LAD_PALETTE_COUNT;
    const int start = a->settings_tab && a->setting_row == 4 ? 1 : 0;
    const int selected = ((*p - start + delta + range) % range) + start;
    if (a->settings_tab && a->setting_row == 3) {
        select_frame(a, selected, a->cfg.frame_id);
    } else if (a->settings_tab && a->setting_row == 4) {
        select_frame(a, a->cfg.template_style, selected);
    } else {
        *p = selected;
    }
    a->dirty = true;
}
static void settings_confirm(App *a) {
    if (!a->settings_tab) {
        if (a->setting_row == 0 || a->setting_row == 1)
            open_browser(a, a->setting_row);
        else if (a->setting_row == 2 || a->setting_row == 3)
            settings_adjust(a, 1);
        else settings_close(a);
    } else {
        if (a->setting_row == 0 &&
            !lad_template_layout(a->cfg.template_style)->has_gate) {
            set_status(a, "THIS LAYOUT HAS NO STARTUP GATE");
            return;
        }
        if (a->setting_row >= 0 && a->setting_row <= 2)
            open_browser(a, a->setting_row + 2);
        else if (a->setting_row <= 6) settings_adjust(a, 1);
        else if (a->setting_row == 8) open_browser(a, 5);
        else if (a->setting_row == 9) toggle_template_preview(a);
        else if (a->setting_row == 10) open_browser(a, 6);
        else if (a->setting_row == 11) patch_selected_vpk(a);
        else if (a->setting_row == 12 || a->setting_row == 13)
            settings_adjust(a, 1);
        else {
            char message[112];
            save(a);
            lad_export_bundle(&a->cfg, message, sizeof(message));
            set_status(a, message);
        }
    }
}
static void settings_clear_selected(App *a) {
    if ((!a->settings_tab && a->setting_row <= 1) ||
        (a->settings_tab && a->setting_row <= 2))
        clear_image(a, a->setting_row + (a->settings_tab ? 2 : 0));
}
static void browser_back(App *a) {
    if (!browser_parent(&a->browser)) a->screen = SCREEN_SETTINGS;
}
static void navigate(App *a, int dx, int dy, int step) {
    if (a->screen == SCREEN_EDITOR) {
        editor_adjust(a, dx, dy, step);
    } else if (a->screen == SCREEN_SETTINGS) {
        if (dy) a->setting_row = clampi(a->setting_row + dy, 0, a->settings_tab ? 13 : 4);
        else if (dx) settings_adjust(a, dx);
    } else if (dy) {
        a->browser.selected = clampi(a->browser.selected + dy, 0,
                                     a->browser.count ? a->browser.count - 1 : 0);
        browser_scroll(&a->browser);
    }
}
static void pointer_down(App *a, int x, int y) {
    if (a->screen == SCREEN_SETTINGS) {
        if (hit(x, y, (Rect){580, 56, 350, 45})) {
            a->settings_tab = !a->settings_tab; a->setting_row = 0; return;
        }
        if (a->settings_tab) {
            if (!lad_template_layout(a->cfg.template_style)->has_gate &&
                hit(x, y, (Rect){284, 106, 110, 35})) {
                set_status(a, "THIS LAYOUT HAS NO STARTUP GATE");
                return;
            }
            if (hit(x, y, (Rect){710, 108, 93, 31})) {
                a->setting_row = 12; settings_confirm(a); return;
            }
            if (hit(x, y, (Rect){809, 108, 93, 31})) {
                a->setting_row = 13; settings_confirm(a); return;
            }
            if (hit(x, y, (Rect){524, 414, 184, 30})) {
                a->setting_row = 10; open_browser(a, 6); return;
            }
            if (hit(x, y, (Rect){716, 414, 186, 30})) {
                a->setting_row = 11; patch_selected_vpk(a); return;
            }
            if (a->cfg.preview_template && hit(x, y, (Rect){524, 150, 378, 225})) {
                const LadTemplateLayout *layout = lad_template_layout(a->cfg.template_style);
                const Rect card = {524, 150, 378, 225};
                for (int i = 0; i < layout->frame_count; ++i) {
                    const LadTemplateSlot *slot = &layout->frames[i];
                    if (slot->width <= 0 || slot->height <= 0) continue;
                    const Rect bounds = {
                        card.x + (420 + slot->center_x - slot->width / 2) * card.w / CARD_W,
                        card.y + (250 - slot->center_y - slot->height / 2) * card.h / CARD_H,
                        slot->width * card.w / CARD_W, slot->height * card.h / CARD_H
                    };
                    if (hit(x, y, bounds)) {
                        select_frame(a, a->cfg.template_style, i + 1);
                        set_status(a, "SELECTED NATIVE RCO FRAME");
                        return;
                    }
                }
            }
            if (hit(x, y, (Rect){524, 448, 380, 41})) {
                a->setting_row = 8; open_browser(a, 5); return;
            }
            if (hit(x, y, (Rect){261, 448, 206, 42})) {
                a->setting_row = 9; toggle_template_preview(a); return;
            }
            static const int centers[] = {106, 185, 264};
            for (int i = 0; i < 3; i++) {
                if (hit(x, y, (Rect){284, centers[i], 110, 35})) {
                    a->setting_row = i; open_browser(a, i + 2); return;
                }
                if (hit(x, y, (Rect){397, centers[i], 76, 35})) {
                    a->setting_row = i; clear_image(a, i + 2); return;
                }
            }
            if (hit(x, y, (Rect){46, 320, 430, 34})) a->setting_row = 3;
            else if (hit(x, y, (Rect){46, 356, 430, 30})) a->setting_row = 4;
            else if (hit(x, y, (Rect){46, 387, 430, 30})) a->setting_row = 5;
            else if (hit(x, y, (Rect){46, 416, 430, 29})) a->setting_row = 6;
            else if (hit(x, y, (Rect){52, 448, 207, 42})) a->setting_row = 7;
            else return;
            settings_confirm(a);
            return;
        }
        if (hit(x, y, (Rect){284, 106, 110, 35})) {
            a->setting_row = 0; open_browser(a, 0);
        } else if (hit(x, y, (Rect){397, 106, 76, 35})) {
            a->setting_row = 0; clear_image(a, 0);
        } else if (hit(x, y, (Rect){284, 186, 110, 35})) {
            a->setting_row = 1; open_browser(a, 1);
        } else if (hit(x, y, (Rect){397, 186, 76, 35})) {
            a->setting_row = 1; clear_image(a, 1);
        } else if (hit(x, y, (Rect){55, 282, 398, 34})) {
            int idx = (x - 55) / 40;
            if (idx < LAD_PALETTE_COUNT && (x - 55) % 40 < 33) {
                a->setting_row = 2; a->cfg.card_color = idx; a->dirty = true;
            }
        } else if (hit(x, y, (Rect){55, 368, 398, 34})) {
            int idx = (x - 55) / 40;
            if (idx < LAD_PALETTE_COUNT && (x - 55) % 40 < 33) {
                a->setting_row = 3; a->cfg.button_color = idx; a->dirty = true;
            }
        } else if (hit(x, y, (Rect){52, 435, 400, 45})) {
            settings_close(a);
        }
        return;
    }
    if (a->screen == SCREEN_BROWSER) {
        if (hit(x, y, (Rect){40, BROWSER_Y, 875, BROWSER_ROWS * BROWSER_STEP})) {
            int index = a->browser.scroll + (y - BROWSER_Y) / BROWSER_STEP;
            if (index >= 0 && index < a->browser.count) {
                a->browser.selected = index; browser_select(a);
            }
        } else if (hit(x, y, (Rect){762, 63, 154, 37})) {
            browser_back(a);
        }
        return;
    }

    if (hit(x, y, (Rect){752, 512, 203, 32})) {
        toggle_template_preview(a);
        return;
    }
    if (hit(x, y, (Rect){810, 0, 150, 33})) {
        a->screen = SCREEN_SETTINGS;
        return;
    }
    Rect rectangle = {CARD_X + a->cfg.x, CARD_Y + a->cfg.y,
                      a->cfg.w, a->cfg.h};
    Rect grip = {rectangle.x + rectangle.w - 20,
                 rectangle.y + rectangle.h - 20, 40, 40};
    bool on_grip = hit(x, y, grip);
    if (!hit(x, y, rectangle) && !on_grip) {
        if (a->cfg.preview_template) {
            const LadTemplateLayout *layout = lad_template_layout(a->cfg.template_style);
            for (int i = 0; i < layout->frame_count; ++i) {
                const LadTemplateSlot *slot = &layout->frames[i];
                if (slot->width <= 0 || slot->height <= 0) continue;
                const Rect bounds = {
                    CARD_X + 420 + slot->center_x - slot->width / 2,
                    CARD_Y + 250 - slot->center_y - slot->height / 2,
                    slot->width, slot->height
                };
                if (hit(x, y, bounds)) {
                    select_frame(a, a->cfg.template_style, i + 1);
                    set_status(a, "SELECTED NATIVE RCO FRAME");
                    return;
                }
            }
        }
        return;
    }
    a->drag = true;
    a->drag_resize = on_grip;
    a->grab_x = x;
    a->grab_y = y;
    a->start_button = (Rect){a->cfg.x, a->cfg.y, a->cfg.w, a->cfg.h};
}
static void pointer_move(App *a, int x, int y) {
    if (a->screen != SCREEN_EDITOR || !a->drag) return;
    int dx = x - a->grab_x, dy = y - a->grab_y;
    Rect b = a->start_button;
    if (a->drag_resize) {
        constrain_size(a, b, dx, dy);
    } else {
        a->cfg.x = clampi(b.x + dx, 0, CARD_W - b.w);
        a->cfg.y = clampi(b.y + dy, SAFE_TOP, CARD_H - b.h);
    }
    if (a->cfg.preview_template) {
        const LadTemplateSlot *slot =
            lad_template_frame(a->cfg.template_style, a->cfg.frame_id);
        if (slot && slot->width >= MIN_SIZE && slot->height >= MIN_SIZE) {
            if (a->cfg.w > slot->width) a->cfg.w = slot->width;
            if (a->cfg.h > slot->height) a->cfg.h = slot->height;
            const int left = 420 + slot->center_x - slot->width / 2;
            const int top = 250 - slot->center_y - slot->height / 2;
            a->cfg.x = clampi(a->cfg.x, left, left + slot->width - a->cfg.w);
            a->cfg.y = clampi(a->cfg.y, top, top + slot->height - a->cfg.h);
        }
    }
    a->dirty = true;
}
static void press(App *a, int button) {
    switch (button) {
    case SDL_CONTROLLER_BUTTON_START:
        if (a->screen == SCREEN_SETTINGS) settings_close(a);
        else if (a->screen == SCREEN_EDITOR) a->screen = SCREEN_SETTINGS;
        else a->screen = SCREEN_SETTINGS;
        break;
    case SDL_CONTROLLER_BUTTON_A: /* Cross */
        if (a->screen == SCREEN_SETTINGS) settings_confirm(a);
        else if (a->screen == SCREEN_BROWSER) browser_select(a);
        else if (a->screen == SCREEN_EDITOR && a->cfg.preview_template)
            fit_image_to_template_frame(a);
        break;
    case SDL_CONTROLLER_BUTTON_B: /* Circle */
        if (a->screen == SCREEN_BROWSER) browser_back(a);
        else if (a->screen == SCREEN_SETTINGS) settings_close(a);
        else a->running = false;
        break;
    case SDL_CONTROLLER_BUTTON_X: /* Square */
        if (a->screen == SCREEN_SETTINGS) settings_clear_selected(a);
        else if (a->screen == SCREEN_BROWSER && a->browse_target == 5)
            select_manual_directory(a);
        else if (a->screen == SCREEN_EDITOR && a->cfg.preview_template)
            cycle_template_style(a);
        break;
    case SDL_CONTROLLER_BUTTON_Y: /* Triangle */
        if (a->screen == SCREEN_EDITOR) a->resize_mode = !a->resize_mode;
        else if (a->screen == SCREEN_BROWSER) a->screen = SCREEN_SETTINGS;
        break;
    case SDL_CONTROLLER_BUTTON_BACK: /* SELECT on PS Vita */
        if (a->screen == SCREEN_EDITOR || a->screen == SCREEN_SETTINGS)
            toggle_template_preview(a);
        break;
    case SDL_CONTROLLER_BUTTON_LEFTSHOULDER:
        if (a->screen == SCREEN_EDITOR && a->cfg.preview_template)
            cycle_template_frame(a);
        else if (a->screen == SCREEN_SETTINGS) {
            a->settings_tab = !a->settings_tab;
            a->setting_row = 0;
        }
        break;
    case SDL_CONTROLLER_BUTTON_RIGHTSHOULDER:
        if (a->screen == SCREEN_SETTINGS) {
            a->settings_tab = !a->settings_tab;
            a->setting_row = 0;
        }
        break;
    default: break;
    }
}
static void key(App *a, SDL_Keycode code) {
    if (code == SDLK_ESCAPE) {
        press(a, SDL_CONTROLLER_BUTTON_B);
    } else if (code == SDLK_TAB) {
        if (a->screen == SCREEN_EDITOR) a->resize_mode = !a->resize_mode;
        else if (a->screen == SCREEN_SETTINGS) {
            a->settings_tab = !a->settings_tab; a->setting_row = 0;
        }
    } else if (code == SDLK_F1 || code == SDLK_s) {
        press(a, SDL_CONTROLLER_BUTTON_START);
    } else if (code == SDLK_p) {
        toggle_template_preview(a);
    } else if (code == SDLK_t && a->screen == SCREEN_EDITOR && a->cfg.preview_template) {
        cycle_template_style(a);
    } else if (code == SDLK_f && a->screen == SCREEN_EDITOR && a->cfg.preview_template) {
        cycle_template_frame(a);
    } else if (code == SDLK_RETURN || code == SDLK_KP_ENTER) {
        press(a, SDL_CONTROLLER_BUTTON_A);
    } else if (code == SDLK_DELETE || code == SDLK_BACKSPACE) {
        if (a->screen == SCREEN_BROWSER) browser_back(a);
        else press(a, SDL_CONTROLLER_BUTTON_X);
    } else if (code == SDLK_LEFT) navigate(a, -1, 0, 1);
    else if (code == SDLK_RIGHT) navigate(a, 1, 0, 1);
    else if (code == SDLK_UP) navigate(a, 0, -1, 1);
    else if (code == SDLK_DOWN) navigate(a, 0, 1, 1);
}
static void draw_image(SDL_Renderer *r, SDL_Texture *texture, Rect dest) {
    if (!texture) return;
    SDL_Rect rect = {dest.x, dest.y, dest.w, dest.h};
    SDL_RenderCopy(r, texture, NULL, &rect);
}
static Rect template_slot_rect(Rect card, const LadTemplateSlot *slot) {
    /* RCO slot positions: centered in 840x500 card, Y positive upward. */
    const int left = 420 + slot->center_x - slot->width / 2;
    const int top = 250 - slot->center_y - slot->height / 2;
    return (Rect) {
        card.x + left * card.w / CARD_W,
        card.y + top * card.h / CARD_H,
        slot->width * card.w / CARD_W,
        slot->height * card.h / CARD_H
    };
}
static bool image_fits_selected_frame(const App *a) {
    const LadTemplateSlot *slot =
        lad_template_frame(a->cfg.template_style, a->cfg.frame_id);
    if (!slot || slot->width <= 0 || slot->height <= 0) return false;
    const Rect frame = template_slot_rect((Rect){0, 0, CARD_W, CARD_H}, slot);
    return a->cfg.x >= frame.x && a->cfg.y >= frame.y &&
           a->cfg.x + a->cfg.w <= frame.x + frame.w &&
           a->cfg.y + a->cfg.h <= frame.y + frame.h;
}
static void draw_template_chrome(App *a, Rect card) {
    SDL_Renderer *r = a->renderer;
    const int mini = card.w < CARD_W;
    const int scale = mini ? 1 : 2;
    const int protected_h = SAFE_TOP * card.h / CARD_H;
    const LadPreviewGate placement = lad_preview_gate(a->cfg.template_style);
    const LadTemplateLayout *layout = lad_template_layout(a->cfg.template_style);
    Rect gate = {
        card.x + placement.x * card.w / CARD_W,
        card.y + placement.y * card.h / CARD_H,
        placement.w * card.w / CARD_W,
        placement.h * card.h / CARD_H
    };
    box(r, (Rect){card.x + 1, card.y + 1, card.w - 2, protected_h - 1},
        (SDL_Color){18, 29, 51, 255}, 235);
    label(a, card.x + 9, card.y + (mini ? 4 : 14),
          "LIVEAREA", scale, TEXT, 0);
    const int action_w = mini ? 44 : 91;
    const int action_h = mini ? 17 : 27;
    const int action_y = card.y + (protected_h - action_h) / 2;
    const int action_gap = mini ? 4 : 9;
    int right = card.x + card.w - 9;
    box(r, (Rect){right - action_w, action_y, action_w, action_h},
        (SDL_Color){50, 72, 99, 255}, 255);
    outline(r, (Rect){right - action_w, action_y, action_w, action_h}, MUTED);
    label(a, right - action_w + (mini ? 2 : 10),
          action_y + (mini ? 5 : 8), "MANUAL", 1, TEXT, 0);
    right -= action_w + action_gap;
    box(r, (Rect){right - action_w, action_y, action_w, action_h},
        (SDL_Color){50, 72, 99, 255}, 255);
    outline(r, (Rect){right - action_w, action_y, action_w, action_h}, MUTED);
    label(a, right - action_w + (mini ? 1 : 8),
          action_y + (mini ? 5 : 8), "UPDATE", 1, TEXT, 0);

    /* Render every RCO frame, not only the editor's free-moving image. */
    for (int i = 0; i < layout->frame_count; ++i) {
        const LadTemplateSlot *slot = &layout->frames[i];
        const int dynamic = slot->width <= 0 || slot->height <= 0;
        Rect rect = template_slot_rect(card, slot);
        if (dynamic) {
            const int cy = card.y + (250 - slot->center_y) * card.h / CARD_H;
            const int cx = card.x + (420 + slot->center_x) * card.w / CARD_W;
            rect = (Rect){cx - (mini ? 20 : 32),
                          cy - (mini ? 10 : 15),
                          mini ? 40 : 64, mini ? 20 : 30};
        }
        if (rect.w <= 0 || rect.h <= 0) continue;
        const bool selected = i + 1 == a->cfg.frame_id;
        box(r, rect, selected ?
            (SDL_Color){135, 64, 132, 255} :
            (SDL_Color){25, 47, 78, 255}, selected ? 168 : 188);
        outline(r, rect, selected ? GOLD : MUTED);
        if (selected && rect.w > 4 && rect.h > 4)
            outline(r, (Rect){rect.x + 2, rect.y + 2,
                              rect.w - 4, rect.h - 4}, GOLD);
        char desc[64];
        snprintf(desc, sizeof(desc), "FRAME%d", i + 1);
        label(a, rect.x + (mini ? 2 : 7), rect.y + (mini ? 4 : 12),
              desc, mini ? 1 : 2, selected ? GOLD : TEXT, 0);
        if (!mini && rect.h > 55) {
            snprintf(desc, sizeof(desc), dynamic ?
                     "DYNAMIC" : "%d x %d", slot->width, slot->height);
            label(a, rect.x + 8, rect.y + 33, desc, 1, MUTED, 0);
        }
    }

    if (placement.known_alignment) {
        box(r, (Rect){gate.x - 3, gate.y - 3, gate.w + 6, gate.h + (mini ? 19 : 33)},
            (SDL_Color){20, 31, 52, 255}, 224);
        if (a->gate_texture) {
            draw_image(r, a->gate_texture, gate);
        } else {
            box(r, gate, (SDL_Color){76, 82, 125, 255}, 255);
            label(a, gate.x + (mini ? 5 : 35), gate.y + gate.h / 2 - 5,
                  "STARTUP", scale, TEXT, 0);
        }
        outline(r, gate, TEXT);
        Rect start = {
            gate.x + (mini ? 16 : 54), gate.y + gate.h + (mini ? 2 : 5),
            gate.w - (mini ? 32 : 108), mini ? 13 : 21
        };
        box(r, start, (SDL_Color){58, 158, 231, 255}, 255);
        label(a, start.x + (mini ? 6 : 24), start.y + (mini ? 3 : 5),
              "START", mini ? 1 : 2, TEXT, 0);
    }

    char style[80];
    snprintf(style, sizeof(style), "%s  FRAME%d/%d",
             lad_preview_style_name(a->cfg.template_style), a->cfg.frame_id,
             layout->frame_count);
    box(r, (Rect){card.x + 6, card.y + protected_h + 7,
                  mini ? 150 : 250, mini ? 16 : 29},
        (SDL_Color){12, 20, 39, 255}, 214);
    label(a, card.x + 12, card.y + protected_h + (mini ? 11 : 16),
          style, scale, TEXT, 31);
}
static void draw_card(App *a, Rect card, bool guides) {
    SDL_Renderer *r = a->renderer;
    box(r, card, palette[a->cfg.card_color], 255);
    draw_image(r, a->card_texture, card);
    outline(r, card, (SDL_Color){224, 185, 236, 255});
    if (a->cfg.preview_template) {
        draw_template_chrome(a, card);
        const LadTemplateLayout *layout = lad_template_layout(a->cfg.template_style);
        const int mini = card.w < CARD_W;
        for (int index = 0; index < layout->frame_count; ++index) {
            const LadTemplateSlot *slot = &layout->frames[index];
            DesignerFrame item;
            lad_resolve_frame(&a->cfg, index + 1, &item);
            Rect slot_bounds = template_slot_rect(card, slot);
            if (slot->width <= 0 || slot->height <= 0) continue;
            const Rect content = {
                card.x + item.x * card.w / CARD_W,
                card.y + item.y * card.h / CARD_H,
                clampi(item.w * card.w / CARD_W, 1, card.w),
                clampi(item.h * card.h / CARD_H, 1, card.h)
            };
            SDL_Texture *texture = index + 1 == a->cfg.frame_id ?
                a->button_texture : a->frame_previews[index];
            SDL_Rect clip = {slot_bounds.x, slot_bounds.y,
                             slot_bounds.w, slot_bounds.h};
            SDL_RenderSetClipRect(r, &clip);
            if (!item.transparent_button) {
                const int palette_index = clampi(item.button_color, 0,
                                                  LAD_PALETTE_COUNT - 1);
                box(r, content, palette[palette_index], texture ? 255 : 164);
            }
            draw_image(r, texture, content);
            if (!texture) {
                char placeholder[48];
                snprintf(placeholder, sizeof(placeholder), "FRAME%d PNG/JPG",
                         index + 1);
                label(a, slot_bounds.x + (mini ? 2 : 12),
                      slot_bounds.y + (mini ? 4 : 26),
                      placeholder, 1, TEXT, mini ? 18 : 32);
            }
            if (item.text[0]) {
                const int y = clampi(content.y + content.h - 20,
                    slot_bounds.y, slot_bounds.y + slot_bounds.h - 9);
                label(a, content.x + 7, y, item.text, 1, TEXT,
                      mini ? 22 : 55);
            }
            SDL_RenderSetClipRect(r, NULL);
            if (index + 1 == a->cfg.frame_id) {
                outline(r, slot_bounds, GOLD);
                outline(r, content, image_fits_selected_frame(a) ? TEXT :
                       (SDL_Color){255, 130, 120, 255});
                if (guides) box(r,
                    (Rect){content.x + content.w - 9,
                           content.y + content.h - 9, 18, 18}, GOLD, 255);
            }
        }
        return; /* No global draggable button when Template Preview is ON. */
    } else if (guides) {
        int protect_h = SAFE_TOP * card.h / CARD_H;
        box(r, (Rect){card.x, card.y, card.w, protect_h},
            (SDL_Color){16, 19, 38, 255}, 197);
        label(a, card.x + card.w - 285, card.y + 13,
              "SYSTEM AREA - NO BUTTONS", 1, GOLD, 39);
        box(r, (Rect){card.x, card.y + protect_h, card.w, 2}, GOLD, 190);
    }
    Rect b = {
        card.x + a->cfg.x * card.w / CARD_W,
        card.y + a->cfg.y * card.h / CARD_H,
        clampi(a->cfg.w * card.w / CARD_W, 1, card.w),
        clampi(a->cfg.h * card.h / CARD_H, 1, card.h)
    };
    if (guides && !a->cfg.preview_template) {
        box(r, (Rect){card.x, b.y + b.h / 2, b.x - card.x, 2}, GOLD, 255);
        box(r, (Rect){b.x + b.w, b.y + b.h / 2,
                      card.x + card.w - b.x - b.w, 2}, GOLD, 255);
        box(r, (Rect){b.x + b.w / 2, card.y, 2, b.y - card.y}, GOLD, 255);
        box(r, (Rect){b.x + b.w / 2, b.y + b.h, 2,
                      card.y + card.h - b.y - b.h}, GOLD, 255);
    }
    if (!a->cfg.transparent_button)
        box(r, b, palette[a->cfg.button_color], a->button_texture ? 255 : 228);
    draw_image(r, a->button_texture, b);
    outline(r, b, TEXT);
    if (guides) {
        box(r, (Rect){b.x + b.w - 9, b.y + b.h - 9, 18, 18}, GOLD, 255);
        if (!a->button_texture) label(a, b.x + 12, b.y + 12, "LIVEITEM", 2, TEXT, 0);
    }
}
static void draw_editor(App *a) {
    SDL_Renderer *r = a->renderer;
    box(r, (Rect){0, 0, SW, SH}, (SDL_Color){10, 12, 29, 255}, 255);
    draw_card(a, (Rect){CARD_X, CARD_Y, CARD_W, CARD_H}, true);
    box(r, (Rect){0, 0, SW, 34}, (SDL_Color){5, 8, 21, 255}, 245);
    char pos[120];
    snprintf(pos, sizeof(pos), "X:%d Y:%d W:%d H:%d R:%d B:%d",
             lad_editor_center_x(&a->cfg), lad_editor_center_y(&a->cfg), a->cfg.w, a->cfg.h,
             CARD_W - a->cfg.x - a->cfg.w,
             CARD_H - a->cfg.y - a->cfg.h);
    label(a, 12, 9, pos, 2, TEXT, 65);
    action_button(a, (Rect){807, 3, 148, 29}, "SETTINGS", false);
    box(r, (Rect){0, 512, SW, 32}, (SDL_Color){6, 9, 23, 255}, 250);
    label(a, 12, 520, a->resize_mode ? "MODE: RESIZE" : "MODE: MOVE", 2, GOLD, 0);
    label(a, 240, 520, a->cfg.preview_template ?
          "SQUARE:STYLE  L:FRAME  X:FIT  TRI:MODE" :
          "TRIANGLE:MODE  START:SETTINGS  R:10  O:EXIT",
          2, TEXT, 58);
    box(r, (Rect){752, 514, 201, 26},
        a->cfg.preview_template ? (SDL_Color){90, 52, 108, 255} :
                                  (SDL_Color){34, 46, 72, 255}, 255);
    outline(r, (Rect){752, 514, 201, 26}, a->cfg.preview_template ? GOLD : MUTED);
    label(a, 759, 522, a->cfg.preview_template ?
          "PREVIEW TEMPLATE: ON" : "PREVIEW TEMPLATE: OFF", 1, TEXT, 0);
    if (SDL_TICKS_PASSED(a->message_until, SDL_GetTicks()))
        label(a, 75, 488, a->message, 1, GOLD, 90);
}
static void draw_swatch(App *a, int index, int x, int y, bool selected) {
    Rect rect = {x, y, 33, 32};
    box(a->renderer, rect, palette[index], 255);
    outline(a->renderer, rect, (SDL_Color){68, 74, 98, 255});
    if (selected) {
        outline(a->renderer, (Rect){x-3, y-3, 39, 38}, GOLD);
        outline(a->renderer, (Rect){x-4, y-4, 41, 40}, TEXT);
    }
}
static const char *file_basename(const char *path) {
    if (!*path) return "NONE - SOLID COLOR";
    const char *last = strrchr(path, '/');
    return last ? last + 1 : path;
}
static void draw_settings_export(App *a) {
    SDL_Renderer *r = a->renderer;
    char line[256];
    const char *filepaths[] = {
        a->cfg.gate_image, a->cfg.icon_image, a->cfg.boot_image
    };
    const char *titles[] = {"GATE STARTUP IMAGE", "BUBBLE ICON IMAGE", "BOOT SCREEN IMAGE"};
    static const int item_y[] = {106, 185, 264};
    label(a, 52, 96, "PNG8 EXPORT - SCE_SYS / LIVEAREA / CONTENTS", 1, MUTED, 0);
    for (int i = 0; i < 3; ++i) {
        if (a->setting_row == i) outline(r, (Rect){46, item_y[i] - 3, 428, 69}, GOLD);
        label(a, 57, item_y[i] + 10,
              i == 0 && !lad_template_layout(a->cfg.template_style)->has_gate ?
                  "NO STARTUP GATE FOR THIS STYLE" : titles[i],
              2, TEXT, 0);
        action_button(a, (Rect){284, item_y[i], 110, 35}, "BROWSE", a->setting_row == i);
        action_button(a, (Rect){397, item_y[i], 76, 35}, "CLEAR", false);
        label(a, 57, item_y[i] + 40, file_basename(filepaths[i]), 1, MUTED, 64);
    }
    snprintf(line, sizeof(line), "STYLE: %s",
             lad_preview_style_name(a->cfg.template_style));
    if (a->setting_row == 3) outline(r, (Rect){46, 319, 428, 33}, GOLD);
    label(a, 57, 327, line, 2, TEXT, 40);
    snprintf(line, sizeof(line), "LIVEITEM: FRAME%d", a->cfg.frame_id);
    if (a->setting_row == 4) outline(r, (Rect){46, 355, 428, 30}, GOLD);
    label(a, 57, 360, line, 2, TEXT, 40);
    snprintf(line, sizeof(line), "LOCK ASPECT: %s",
             a->cfg.aspect_lock ? "ON" : "OFF");
    if (a->setting_row == 5) outline(r, (Rect){46, 385, 428, 29}, GOLD);
    label(a, 57, 391, line, 2, TEXT, 40);
    snprintf(line, sizeof(line), "BUTTON ALPHA: %s",
             a->cfg.transparent_button ? "ON" : "OFF");
    if (a->setting_row == 6) outline(r, (Rect){46, 415, 428, 29}, GOLD);
    label(a, 57, 420, line, 2, TEXT, 40);
    action_button(a, (Rect){52, 450, 204, 39}, "EXPORT XML", a->setting_row == 7);
    box(r, (Rect){261, 450, 206, 39},
        a->cfg.preview_template ? (SDL_Color){73, 45, 90, 255} :
                                  (SDL_Color){34, 46, 72, 255}, 255);
    outline(r, (Rect){261, 450, 206, 39}, a->setting_row == 9 ? GOLD : MUTED);
    label(a, 269, 464, a->cfg.preview_template ?
          "PREVIEW TEMPLATE: ON" : "PREVIEW TEMPLATE: OFF", 1, TEXT, 0);

    label(a, 524, 112, "FRAME PREVIEW", 2, TEXT, 0);
    const Rect invert_x = {710, 108, 93, 31};
    const Rect invert_y = {809, 108, 93, 31};
    box(r, invert_x, a->cfg.invert_x ?
        (SDL_Color){73, 45, 90, 255} : (SDL_Color){34, 46, 72, 255}, 255);
    box(r, invert_y, a->cfg.invert_y ?
        (SDL_Color){73, 45, 90, 255} : (SDL_Color){34, 46, 72, 255}, 255);
    outline(r, invert_x, a->setting_row == 12 ? GOLD : MUTED);
    outline(r, invert_y, a->setting_row == 13 ? GOLD : MUTED);
    label(a, 717, 118, a->cfg.invert_x ? "INVERT X:ON" : "INVERT X:OFF", 1, TEXT, 0);
    label(a, 816, 118, a->cfg.invert_y ? "INVERT Y:ON" : "INVERT Y:OFF", 1, TEXT, 0);
    draw_card(a, (Rect){524, 150, 378, 225}, false);
    snprintf(line, sizeof(line), "CENTER X:%d Y:%d W:%d H:%d",
             lad_editor_center_x(&a->cfg), lad_editor_center_y(&a->cfg),
             a->cfg.w, a->cfg.h);
    label(a, 524, 389, line, 2, GOLD, 33);
    action_button(a, (Rect){524, 414, 184, 30}, "OPEN VPK", a->setting_row == 10);
    action_button(a, (Rect){716, 414, 186, 30}, "PATCH VPK", a->setting_row == 11);
    action_button(a, (Rect){524, 450, 380, 39}, "SELECT MANUAL FOLDER", a->setting_row == 8);
    if (SDL_TICKS_PASSED(a->message_until, SDL_GetTicks()))
        label(a, 524, 493, a->message, 1, GOLD, 72);
}
static void draw_settings(App *a) {
    SDL_Renderer *r = a->renderer;
    box(r, (Rect){0, 0, SW, SH}, (SDL_Color){9, 13, 29, 255}, 255);
    box(r, (Rect){28, 44, 904, 450}, (SDL_Color){23, 29, 52, 255}, 255);
    outline(r, (Rect){28, 44, 904, 450}, MUTED);
    label(a, 52, 63, "SETTINGS", 3, TEXT, 0);
    label(a, 584, 70, a->settings_tab ?
          "TEMPLATE + VPK  /  L/R: IMAGES" : "IMAGES  /  L/R: TEMPLATE",
          2, GOLD, 0);
    if (a->settings_tab) {
        draw_settings_export(a);
        box(r, (Rect){0, 507, SW, 37}, (SDL_Color){5, 7, 19, 255}, 255);
        label(a, 16, 518, "L/R:TABS  DPAD:NAV  X:SELECT  SELECT:PREVIEW  O:BACK",
              2, TEXT, 75);
        return;
    }
    label(a, 52, 96, "IMAGES PNG / JPG", 1, MUTED, 0);

    if (a->setting_row == 0)
        outline(r, (Rect){46, 103, 428, 70}, GOLD);
    if (a->setting_row == 1)
        outline(r, (Rect){46, 183, 428, 70}, GOLD);
    label(a, 57, 116, "CARD IMAGE", 2, TEXT, 0);
    action_button(a, (Rect){284, 106, 110, 35}, "BROWSE", a->setting_row == 0);
    action_button(a, (Rect){397, 106, 76, 35}, "CLEAR", false);
    label(a, 57, 148, file_basename(a->cfg.card_image), 1, MUTED, 66);

    char frame_heading[48];
    snprintf(frame_heading, sizeof(frame_heading), "FRAME%d IMAGE", a->cfg.frame_id);
    label(a, 57, 195, frame_heading, 2, TEXT, 0);
    action_button(a, (Rect){284, 186, 110, 35}, "BROWSE", a->setting_row == 1);
    action_button(a, (Rect){397, 186, 76, 35}, "CLEAR", false);
    label(a, 57, 228, file_basename(a->cfg.button_image), 1, MUTED, 66);

    if (a->setting_row == 2)
        outline(r, (Rect){46, 255, 428, 73}, GOLD);
    if (a->setting_row == 3)
        outline(r, (Rect){46, 342, 428, 72}, GOLD);
    char desc[96];
    snprintf(desc, sizeof(desc), "CARD COLOR: %s", color_names[a->cfg.card_color]);
    label(a, 57, 260, desc, 2, TEXT, 36);
    snprintf(desc, sizeof(desc), "FRAME%d COLOR: %s",
             a->cfg.frame_id, color_names[a->cfg.button_color]);
    label(a, 57, 345, desc, 2, TEXT, 36);
    for (int i = 0; i < LAD_PALETTE_COUNT; ++i) {
        draw_swatch(a, i, 55 + 40 * i, 282, i == a->cfg.card_color);
        draw_swatch(a, i, 55 + 40 * i, 368, i == a->cfg.button_color);
    }
    action_button(a, (Rect){52, 435, 400, 45}, "SAVE AND CLOSE", a->setting_row == 4);

    label(a, 520, 106, "LIVE PREVIEW", 2, TEXT, 0);
    draw_card(a, (Rect){524, 143, 378, 216}, false);
    snprintf(desc, sizeof(desc), "X:%d Y:%d W:%d H:%d",
             lad_editor_center_x(&a->cfg), lad_editor_center_y(&a->cfg),
             a->cfg.w, a->cfg.h);
    label(a, 524, 381, desc, 2, TEXT, 31);
    label(a, 524, 412, "BUTTON ALPHA IS IN THE XML+ASSETS TAB", 1, MUTED, 0);
    if (SDL_TICKS_PASSED(a->message_until, SDL_GetTicks()))
        label(a, 524, 456, a->message, 1, GOLD, 66);

    box(r, (Rect){0, 507, SW, 37}, (SDL_Color){5, 7, 19, 255}, 255);
    label(a, 24, 518, "DPAD:NAV  X:SELECT  SQUARE:CLEAR  O:BACK  START:CLOSE",
          2, TEXT, 72);
}
static void draw_browser(App *a) {
    SDL_Renderer *r = a->renderer;
    box(r, (Rect){0, 0, SW, SH}, (SDL_Color){9, 13, 29, 255}, 255);
    box(r, (Rect){24, 44, 912, 448}, (SDL_Color){23, 29, 52, 255}, 255);
    outline(r, (Rect){24, 44, 912, 448}, MUTED);
    static const char *headings[] = {
        "SELECT CARD IMAGE", "SELECT FRAME IMAGE", "SELECT GATE IMAGE",
        "SELECT ICON0 IMAGE", "SELECT PIC0 IMAGE", "CHOOSE MANUAL DIRECTORY",
        "OPEN EXISTING VPK (READ ONLY)"
    };
    label(a, 41, 61, headings[clampi(a->browse_target, 0, 6)], 3, TEXT, 0);
    action_button(a, (Rect){762, 63, 154, 37}, "GO BACK", false);

    const char *path = a->browser.cwd[0] ? a->browser.cwd : "CHOOSE STORAGE";
    label(a, 41, 102, path, 1, GOLD, 145);
    for (int row = 0; row < BROWSER_ROWS; ++row) {
        int index = row + a->browser.scroll;
        if (index >= a->browser.count) break;
        int y = BROWSER_Y + row * BROWSER_STEP;
        BrowserEntry *entry = &a->browser.items[index];
        if (index == a->browser.selected) {
            box(r, (Rect){43, y - 2, 875, 31},
                (SDL_Color){55, 78, 118, 255}, 255);
            outline(r, (Rect){43, y - 2, 875, 31}, GOLD);
        }
        label(a, 55, y + 6, entry->directory ? "DIR" : "IMG",
              2, entry->directory ? GOLD : MUTED, 0);
        label(a, 142, y + 6, entry->name, 2, TEXT, 63);
    }
    if (a->browser.count == 0)
        label(a, 50, 162, a->browser.filter_vpk ?
              "NO DIRECTORIES OR VPK FILES" : "NO DIRECTORIES OR PNG/JPG FILES",
              2, MUTED, 0);
    if (a->browser.error[0])
        label(a, 43, 474, a->browser.error, 1, GOLD, 100);
    else if (SDL_TICKS_PASSED(a->message_until, SDL_GetTicks()))
        label(a, 43, 474, a->message, 1, GOLD, 100);
    box(r, (Rect){0, 507, SW, 37}, (SDL_Color){5, 7, 19, 255}, 255);
    label(a, 24, 518, a->browse_target == 5
          ? "DPAD:BROWSE  X:OPEN  SQUARE:USE FOLDER  O:UP"
          : "DPAD:BROWSE  X:OPEN  O:UP  TRIANGLE:CANCEL",
          2, TEXT, 72);
}
static void render(App *a) {
    if (a->screen == SCREEN_EDITOR) draw_editor(a);
    else if (a->screen == SCREEN_SETTINGS) draw_settings(a);
    else draw_browser(a);
    SDL_RenderPresent(a->renderer);
}
static bool is_front_touch(SDL_TouchID touch_id) {
    /* SDL2 Vita registers the front screen as DIRECT, rear pad as INDIRECT. */
    return SDL_GetTouchDeviceType(touch_id) == SDL_TOUCH_DEVICE_DIRECT;
}
static void event(App *a, SDL_Event *e) {
    switch (e->type) {
    case SDL_QUIT: a->running = false; break;
    case SDL_CONTROLLERBUTTONDOWN: press(a, e->cbutton.button); break;
    case SDL_KEYDOWN:
        if (!e->key.repeat) key(a, e->key.keysym.sym);
        break;
    case SDL_MOUSEBUTTONDOWN:
        if (e->button.which != SDL_TOUCH_MOUSEID && e->button.button == SDL_BUTTON_LEFT)
            pointer_down(a, e->button.x, e->button.y);
        break;
    case SDL_MOUSEBUTTONUP:
        if (e->button.which != SDL_TOUCH_MOUSEID && e->button.button == SDL_BUTTON_LEFT)
            a->drag = false;
        break;
    case SDL_MOUSEMOTION:
        if (e->motion.which != SDL_TOUCH_MOUSEID)
            pointer_move(a, e->motion.x, e->motion.y);
        break;
    case SDL_FINGERDOWN:
        if (is_front_touch(e->tfinger.touchId) && !a->front_finger_active) {
            a->front_finger_active = true;
            a->front_touch_id = e->tfinger.touchId;
            a->front_finger_id = e->tfinger.fingerId;
            pointer_down(a, (int)(e->tfinger.x * SW), (int)(e->tfinger.y * SH));
        }
        break;
    case SDL_FINGERUP:
        if (a->front_finger_active &&
            e->tfinger.touchId == a->front_touch_id &&
            e->tfinger.fingerId == a->front_finger_id) {
            a->drag = false;
            a->front_finger_active = false;
        }
        break;
    case SDL_FINGERMOTION:
        if (a->front_finger_active &&
            e->tfinger.touchId == a->front_touch_id &&
            e->tfinger.fingerId == a->front_finger_id)
            pointer_move(a, (int)(e->tfinger.x * SW), (int)(e->tfinger.y * SH));
        break;
    default: break;
    }
}
int main(int argc, char **argv) {
    (void)argc; (void)argv;
    SDL_SetHint(SDL_HINT_RENDER_SCALE_QUALITY, "0");
    SDL_SetHint(SDL_HINT_TOUCH_MOUSE_EVENTS, "0");
    /* SDL2 Vita reads this before touch initialization. Never poll rear input. */
    SDL_setenv("VITA_DISABLE_TOUCH_BACK", "1", 1);
    if (SDL_Init(SDL_INIT_VIDEO | SDL_INIT_GAMECONTROLLER | SDL_INIT_EVENTS) != 0)
        return 1;
    IMG_Init(IMG_INIT_PNG | IMG_INIT_JPG);

    App *a = (App *)calloc(1, sizeof(*a));
    if (!a) { IMG_Quit(); SDL_Quit(); return 2; }
    designer_load(&a->cfg);
    normalize(a);
    a->settings_tab = 1; /* Artwork/frames are primary; palette is optional. */
    a->window = SDL_CreateWindow("LiveArea Designer",
        SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED, SW, SH, SDL_WINDOW_SHOWN);
    if (a->window) a->renderer =
        SDL_CreateRenderer(a->window, -1, SDL_RENDERER_ACCELERATED);
    if (!a->renderer && a->window) a->renderer =
        SDL_CreateRenderer(a->window, -1, SDL_RENDERER_SOFTWARE);
    if (!a->renderer) {
        SDL_DestroyWindow(a->window);
        free(a); IMG_Quit(); SDL_Quit(); return 3;
    }
    SDL_SetRenderDrawBlendMode(a->renderer, SDL_BLENDMODE_BLEND);
    if (!font_init(&a->font, a->renderer)) {
        SDL_DestroyRenderer(a->renderer);
        SDL_DestroyWindow(a->window);
        free(a); IMG_Quit(); SDL_Quit(); return 4;
    }
    if (a->cfg.card_image[0]) load_texture(a, a->cfg.card_image, &a->card_texture);
    if (a->cfg.button_image[0]) load_texture(a, a->cfg.button_image, &a->button_texture);
    if (a->cfg.gate_image[0]) load_texture(a, a->cfg.gate_image, &a->gate_texture);
    reload_frame_previews(a);
    for (int i = 0; i < SDL_NumJoysticks(); ++i) {
        if (SDL_IsGameController(i)) { a->pad = SDL_GameControllerOpen(i); break; }
    }
    a->running = true;
    int prev_x = 0, prev_y = 0;
    Uint32 prev_repeat = 0;
    while (a->running) {
        SDL_Event e;
        while (SDL_PollEvent(&e)) event(a, &e);
        if (a->pad) {
            int dx = SDL_GameControllerGetButton(a->pad, SDL_CONTROLLER_BUTTON_DPAD_RIGHT) -
                     SDL_GameControllerGetButton(a->pad, SDL_CONTROLLER_BUTTON_DPAD_LEFT);
            int dy = SDL_GameControllerGetButton(a->pad, SDL_CONTROLLER_BUTTON_DPAD_DOWN) -
                     SDL_GameControllerGetButton(a->pad, SDL_CONTROLLER_BUTTON_DPAD_UP);
            Uint32 now = SDL_GetTicks();
            int delay = a->screen == SCREEN_EDITOR ? 75 : 145;
            if (dx != prev_x || dy != prev_y) {
                prev_x = dx; prev_y = dy; prev_repeat = now - delay;
            }
            if ((dx || dy) && now - prev_repeat >= (Uint32)delay) {
                int step = SDL_GameControllerGetButton(a->pad, SDL_CONTROLLER_BUTTON_RIGHTSHOULDER)
                         ? 10 : 1;
                navigate(a, dx, dy, step);
                prev_repeat = now;
            }
        }
        render(a);
        SDL_Delay(16);
    }
    save(a);
    if (a->pad) SDL_GameControllerClose(a->pad);
    SDL_DestroyTexture(a->card_texture);
    SDL_DestroyTexture(a->button_texture);
    SDL_DestroyTexture(a->gate_texture);
    for (int i = 0; i < LAD_MAX_FRAMES; ++i)
        SDL_DestroyTexture(a->frame_previews[i]);
    font_free(&a->font);
    SDL_DestroyRenderer(a->renderer);
    SDL_DestroyWindow(a->window);
    free(a);
    IMG_Quit();
    SDL_Quit();
    return 0;
}
