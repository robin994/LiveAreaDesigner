#ifndef LIVEAREA_FONT_H
#define LIVEAREA_FONT_H

#include <SDL.h>
#include <stdbool.h>

typedef struct {
    SDL_Texture *atlas;
} Font;

bool font_init(Font *font, SDL_Renderer *renderer);
void font_free(Font *font);
void font_draw(Font *font, SDL_Renderer *renderer, int x, int y,
               const char *s, int scale, SDL_Color color, int max_chars);

#endif
