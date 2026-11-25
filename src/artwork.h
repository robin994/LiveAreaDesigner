#ifndef LAD_ARTWORK_H
#define LAD_ARTWORK_H

#include "assets.h"

#include <SDL.h>

void lad_artwork_normalize(LadArtwork *art);
bool lad_artwork_edited(const LadArtwork *art);
SDL_Surface *lad_artwork_load(const char *path);
SDL_Rect lad_artwork_crop(const SDL_Surface *source, const LadArtwork *art);
SDL_Surface *lad_artwork_render(SDL_Surface *source, const LadArtwork *art,
                                int width, int height, SDL_Color fill,
                                bool transparent);
void lad_artwork_mask_bubble(SDL_Surface *surface);

#endif
