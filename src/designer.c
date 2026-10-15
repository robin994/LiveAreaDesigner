#include "assets.h"
#include "font.h"

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
#define CARD_H 480
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
    Font font;
    DesignerConfig cfg;
    FileBrowser browser;
    Screen screen;
    int setting_row;
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
static void normalize(App *a) {
    a->cfg.w = clampi(a->cfg.w, MIN_SIZE, CARD_W);
    a->cfg.h = clampi(a->cfg.h, MIN_SIZE, CARD_H);
    a->cfg.x = clampi(a->cfg.x, 0, CARD_W - a->cfg.w);
    a->cfg.y = clampi(a->cfg.y, 0, CARD_H - a->cfg.h);
    a->cfg.card_color = clampi(a->cfg.card_color, 0, LAD_PALETTE_COUNT - 1);
    a->cfg.button_color = clampi(a->cfg.button_color, 0, LAD_PALETTE_COUNT - 1);
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
static bool load_texture(App *a, const char *path, SDL_Texture **out) {
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
static void choose_image(App *a, const char *path) {
    char *chosen = a->browse_target == 0 ? a->cfg.card_image : a->cfg.button_image;
    SDL_Texture **tex = a->browse_target == 0 ?
                         &a->card_texture : &a->button_texture;
    if (!load_texture(a, path, tex)) return;
    snprintf(chosen, LAD_PATH_MAX, "%s", path);
    a->dirty = true;
    a->screen = SCREEN_SETTINGS;
    set_status(a, "IMAGE LOADED");
}
static void clear_image(App *a, int target) {
    if (target == 0) {
        a->cfg.card_image[0] = '\0';
        load_texture(a, "", &a->card_texture);
    } else {
        a->cfg.button_image[0] = '\0';
        load_texture(a, "", &a->button_texture);
    }
    a->dirty = true;
    set_status(a, "IMAGE CLEARED");
}
static void open_browser(App *a, int target) {
    a->browse_target = target;
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
    if (browser_activate(&a->browser, picked, sizeof(picked))) choose_image(a, picked);
}
static void editor_adjust(App *a, int dx, int dy, int step) {
    if (a->resize_mode) {
        a->cfg.w += dx * step;
        a->cfg.h += dy * step;
    } else {
        a->cfg.x += dx * step;
        a->cfg.y += dy * step;
    }
    normalize(a);
    a->dirty = true;
}
static void settings_adjust(App *a, int delta) {
    int *p = NULL;
    if (a->setting_row == 2) p = &a->cfg.card_color;
    if (a->setting_row == 3) p = &a->cfg.button_color;
    if (!p) return;
    *p = (*p + delta + LAD_PALETTE_COUNT) % LAD_PALETTE_COUNT;
    a->dirty = true;
}
static void settings_confirm(App *a) {
    if (a->setting_row == 0 || a->setting_row == 1)
        open_browser(a, a->setting_row);
    else if (a->setting_row == 2 || a->setting_row == 3)
        settings_adjust(a, 1);
    else settings_close(a);
}
static void settings_clear_selected(App *a) {
    if (a->setting_row == 0 || a->setting_row == 1)
        clear_image(a, a->setting_row);
}
static void browser_back(App *a) {
    if (!browser_parent(&a->browser)) a->screen = SCREEN_SETTINGS;
}
static void navigate(App *a, int dx, int dy, int step) {
    if (a->screen == SCREEN_EDITOR) {
        editor_adjust(a, dx, dy, step);
    } else if (a->screen == SCREEN_SETTINGS) {
        if (dy) a->setting_row = clampi(a->setting_row + dy, 0, 4);
        else if (dx) settings_adjust(a, dx);
    } else if (dy) {
        a->browser.selected = clampi(a->browser.selected + dy, 0,
                                     a->browser.count ? a->browser.count - 1 : 0);
        browser_scroll(&a->browser);
    }
}
static void pointer_down(App *a, int x, int y) {
    if (a->screen == SCREEN_SETTINGS) {
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

    if (hit(x, y, (Rect){810, 0, 150, 33})) {
        a->screen = SCREEN_SETTINGS;
        return;
    }
    Rect rectangle = {CARD_X + a->cfg.x, CARD_Y + a->cfg.y,
                      a->cfg.w, a->cfg.h};
    Rect grip = {rectangle.x + rectangle.w - 20,
                 rectangle.y + rectangle.h - 20, 40, 40};
    bool on_grip = hit(x, y, grip);
    if (!hit(x, y, rectangle) && !on_grip) return;
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
        a->cfg.w = clampi(b.w + dx, MIN_SIZE, CARD_W - b.x);
        a->cfg.h = clampi(b.h + dy, MIN_SIZE, CARD_H - b.y);
    } else {
        a->cfg.x = clampi(b.x + dx, 0, CARD_W - b.w);
        a->cfg.y = clampi(b.y + dy, 0, CARD_H - b.h);
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
        break;
    case SDL_CONTROLLER_BUTTON_B: /* Circle */
        if (a->screen == SCREEN_BROWSER) browser_back(a);
        else if (a->screen == SCREEN_SETTINGS) settings_close(a);
        else a->running = false;
        break;
    case SDL_CONTROLLER_BUTTON_X: /* Square */
        if (a->screen == SCREEN_SETTINGS) settings_clear_selected(a);
        break;
    case SDL_CONTROLLER_BUTTON_Y: /* Triangle */
        if (a->screen == SCREEN_EDITOR) a->resize_mode = !a->resize_mode;
        else if (a->screen == SCREEN_BROWSER) a->screen = SCREEN_SETTINGS;
        break;
    default: break;
    }
}
static void key(App *a, SDL_Keycode code) {
    if (code == SDLK_ESCAPE) {
        press(a, SDL_CONTROLLER_BUTTON_B);
    } else if (code == SDLK_TAB) {
        if (a->screen == SCREEN_EDITOR) a->resize_mode = !a->resize_mode;
    } else if (code == SDLK_F1 || code == SDLK_s) {
        press(a, SDL_CONTROLLER_BUTTON_START);
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
static void draw_card(App *a, Rect card, bool guides) {
    SDL_Renderer *r = a->renderer;
    box(r, card, palette[a->cfg.card_color], 255);
    draw_image(r, a->card_texture, card);
    outline(r, card, (SDL_Color){224, 185, 236, 255});

    Rect b = {
        card.x + a->cfg.x * card.w / CARD_W,
        card.y + a->cfg.y * card.h / CARD_H,
        clampi(a->cfg.w * card.w / CARD_W, 1, card.w),
        clampi(a->cfg.h * card.h / CARD_H, 1, card.h)
    };
    if (guides) {
        box(r, (Rect){card.x, b.y + b.h / 2, b.x - card.x, 2}, GOLD, 255);
        box(r, (Rect){b.x + b.w, b.y + b.h / 2,
                      card.x + card.w - b.x - b.w, 2}, GOLD, 255);
        box(r, (Rect){b.x + b.w / 2, card.y, 2, b.y - card.y}, GOLD, 255);
        box(r, (Rect){b.x + b.w / 2, b.y + b.h, 2,
                      card.y + card.h - b.y - b.h}, GOLD, 255);
    }
    box(r, b, palette[a->cfg.button_color], a->button_texture ? 255 : 228);
    draw_image(r, a->button_texture, b);
    outline(r, b, TEXT);
    if (guides) {
        box(r, (Rect){b.x + b.w - 9, b.y + b.h - 9, 18, 18}, GOLD, 255);
        if (!a->button_texture) label(a, b.x + 12, b.y + 12, "BUTTON", 2, TEXT, 0);
    }
}
static void draw_editor(App *a) {
    SDL_Renderer *r = a->renderer;
    box(r, (Rect){0, 0, SW, SH}, (SDL_Color){10, 12, 29, 255}, 255);
    draw_card(a, (Rect){CARD_X, CARD_Y, CARD_W, CARD_H}, true);
    box(r, (Rect){0, 0, SW, 34}, (SDL_Color){5, 8, 21, 255}, 245);
    char pos[120];
    snprintf(pos, sizeof(pos), "X:%d Y:%d W:%d H:%d R:%d B:%d",
             a->cfg.x, a->cfg.y, a->cfg.w, a->cfg.h,
             CARD_W - a->cfg.x - a->cfg.w,
             CARD_H - a->cfg.y - a->cfg.h);
    label(a, 12, 9, pos, 2, TEXT, 65);
    action_button(a, (Rect){807, 3, 148, 29}, "SETTINGS", false);
    box(r, (Rect){0, 512, SW, 32}, (SDL_Color){6, 9, 23, 255}, 250);
    label(a, 12, 520, a->resize_mode ? "MODE: RESIZE" : "MODE: MOVE", 2, GOLD, 0);
    label(a, 240, 520, "TRIANGLE:MODE  START:SETTINGS  R:10  O:EXIT",
          2, TEXT, 58);
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
static void draw_settings(App *a) {
    SDL_Renderer *r = a->renderer;
    box(r, (Rect){0, 0, SW, SH}, (SDL_Color){9, 13, 29, 255}, 255);
    box(r, (Rect){28, 44, 904, 450}, (SDL_Color){23, 29, 52, 255}, 255);
    outline(r, (Rect){28, 44, 904, 450}, MUTED);
    label(a, 52, 63, "SETTINGS", 3, TEXT, 0);
    label(a, 52, 96, "IMAGES PNG / JPG", 1, MUTED, 0);

    if (a->setting_row == 0)
        outline(r, (Rect){46, 103, 428, 70}, GOLD);
    if (a->setting_row == 1)
        outline(r, (Rect){46, 183, 428, 70}, GOLD);
    label(a, 57, 116, "CARD IMAGE", 2, TEXT, 0);
    action_button(a, (Rect){284, 106, 110, 35}, "BROWSE", a->setting_row == 0);
    action_button(a, (Rect){397, 106, 76, 35}, "CLEAR", false);
    label(a, 57, 148, file_basename(a->cfg.card_image), 1, MUTED, 66);

    label(a, 57, 195, "BUTTON IMAGE", 2, TEXT, 0);
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
    snprintf(desc, sizeof(desc), "BUTTON COLOR: %s", color_names[a->cfg.button_color]);
    label(a, 57, 345, desc, 2, TEXT, 36);
    for (int i = 0; i < LAD_PALETTE_COUNT; ++i) {
        draw_swatch(a, i, 55 + 40 * i, 282, i == a->cfg.card_color);
        draw_swatch(a, i, 55 + 40 * i, 368, i == a->cfg.button_color);
    }
    action_button(a, (Rect){52, 435, 400, 45}, "SAVE AND CLOSE", a->setting_row == 4);

    label(a, 520, 106, "LIVE PREVIEW", 2, TEXT, 0);
    draw_card(a, (Rect){524, 143, 378, 216}, false);
    snprintf(desc, sizeof(desc), "X:%d Y:%d W:%d H:%d",
             a->cfg.x, a->cfg.y, a->cfg.w, a->cfg.h);
    label(a, 524, 381, desc, 2, TEXT, 31);
    label(a, 524, 412, "COLORS FILL TRANSPARENT AREAS", 1, MUTED, 0);
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
    label(a, 41, 61,
          a->browse_target == 0 ? "SELECT CARD IMAGE" : "SELECT BUTTON IMAGE",
          3, TEXT, 0);
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
        label(a, 50, 162, "NO DIRECTORIES OR PNG/JPG FILES", 2, MUTED, 0);
    if (a->browser.error[0])
        label(a, 43, 474, a->browser.error, 1, GOLD, 100);
    else if (SDL_TICKS_PASSED(a->message_until, SDL_GetTicks()))
        label(a, 43, 474, a->message, 1, GOLD, 100);
    box(r, (Rect){0, 507, SW, 37}, (SDL_Color){5, 7, 19, 255}, 255);
    label(a, 24, 518, "DPAD:BROWSE  X:OPEN  O:UP  TRIANGLE:CANCEL",
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
    font_free(&a->font);
    SDL_DestroyRenderer(a->renderer);
    SDL_DestroyWindow(a->window);
    free(a);
    IMG_Quit();
    SDL_Quit();
    return 0;
}
