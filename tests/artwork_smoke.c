#include "artwork.h"

#include <psp2/io/dirent.h>
#include <assert.h>
#include <stdio.h>
#include <string.h>

/* The smoke test uses in-memory artwork. It links the production assets module
   for file type detection and never accesses Vita storage. */
SceUID sceIoDopen(const char *path) { (void)path; return -1; }
int sceIoDread(SceUID fd, SceIoDirent *entry) {
    (void)fd; (void)entry; return 0;
}
int sceIoDclose(SceUID fd) { (void)fd; return 0; }
int sceIoMkdir(const char *path, unsigned int mode) {
    (void)path; (void)mode; return 0;
}

int main(void) {
    SDL_Surface *source = SDL_CreateRGBSurfaceWithFormat(0, 4, 2, 32,
                                                         SDL_PIXELFORMAT_RGBA32);
    assert(source);
    assert(SDL_SetSurfaceBlendMode(source, SDL_BLENDMODE_NONE) == 0);
    const SDL_Rect left = {0, 0, 2, 2}, right = {2, 0, 2, 2};
    SDL_FillRect(source, &left, SDL_MapRGBA(source->format, 255, 0, 0, 255));
    SDL_FillRect(source, &right, SDL_MapRGBA(source->format, 0, 0, 200, 128));

    const SDL_Color matte = {10, 20, 30, 255};
    LadArtwork edit = { .crop_width = 50, .crop_x = 100 };
    SDL_Rect crop = lad_artwork_crop(source, &edit);
    assert(crop.x == 2 && crop.y == 0 && crop.w == 2 && crop.h == 2);
    SDL_Surface *result = lad_artwork_render(source, &edit, 2, 2, matte, true);
    assert(result && !memcmp(result->pixels, (Uint8[]){0, 0, 200, 128}, 4));
    SDL_FreeSurface(result);

    edit.contrast = -50;
    assert(lad_artwork_edited(&(LadArtwork){.contrast = -50}));
    result = lad_artwork_render(source, &edit, 2, 2, matte, true);
    assert(result && !memcmp(result->pixels, (Uint8[]){64, 64, 164, 128}, 4));
    SDL_FreeSurface(result);
    edit.contrast = 0;

    edit.saturation = -100;
    edit.brightness = 10;
    result = lad_artwork_render(source, &edit, 2, 2, matte, true);
    assert(result && !memcmp(result->pixels, (Uint8[]){40, 40, 40, 128}, 4));
    SDL_FreeSurface(result);
    result = lad_artwork_render(source, &edit, 2, 2, matte, false);
    assert(result && !memcmp(result->pixels, (Uint8[]){25, 30, 35, 255}, 4));
    SDL_FreeSurface(result);

    edit = (LadArtwork){ .crop_width = 50, .crop_x = -100, .hue = 180 };
    result = lad_artwork_render(source, &edit, 2, 2, matte, true);
    assert(result && !memcmp(result->pixels, (Uint8[]){0, 109, 109, 255}, 4));
    SDL_FreeSurface(result);

    edit = (LadArtwork){ .solid = 1, .red = 166, .green = 100, .blue = 40 };
    const SDL_Rect hole = {0, 0, 1, 1};
    SDL_FillRect(source, &hole, 0);
    result = lad_artwork_render(source, &edit, 4, 2, matte, true);
    assert(result && !memcmp(result->pixels, (Uint8[]){0, 0, 0, 0,
        166, 100, 40, 255, 166, 100, 40, 128}, 12));
    SDL_FreeSurface(result);
    result = lad_artwork_render(source, &edit, 4, 2, matte, false);
    assert(result && !memcmp(result->pixels, (Uint8[]){10, 20, 30, 255,
        166, 100, 40, 255, 88, 60, 35, 255}, 12));
    SDL_FreeSurface(result);

    result = lad_artwork_render(NULL, &edit, 128, 128, matte, false);
    assert(result && !memcmp(result->pixels, (Uint8[]){166, 100, 40, 255}, 4));
    lad_artwork_mask_bubble(result);
    assert(!memcmp(result->pixels, (Uint8[]){166, 100, 40, 0}, 4));
    const Uint8 *center = (const Uint8 *)result->pixels + 64 * result->pitch + 64 * 4;
    assert(center[3] == 255);
    SDL_FreeSurface(result);
    SDL_FreeSurface(source);
    puts("Artwork crop, color, compositing and bubble mask passed");
}
