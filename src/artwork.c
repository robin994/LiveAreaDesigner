#include "artwork.h"

#include <SDL_image.h>
#include <math.h>

#define MAX_IMAGE_BYTES (12 * 1024 * 1024)
#define MAX_IMAGE_EDGE 2048

static int clamp(int value, int low, int high) {
    return value < low ? low : value > high ? high : value;
}

void lad_artwork_normalize(LadArtwork *art) {
    art->crop_width = clamp(art->crop_width, 0, 95);
    art->crop_height = clamp(art->crop_height, 0, 95);
    art->crop_x = clamp(art->crop_x, -100, 100);
    art->crop_y = clamp(art->crop_y, -100, 100);
    art->hue = clamp(art->hue, -180, 180);
    art->saturation = clamp(art->saturation, -100, 100);
    art->brightness = clamp(art->brightness, -100, 100);
    art->solid = art->solid != 0;
    art->red = clamp(art->red, 0, 255);
    art->green = clamp(art->green, 0, 255);
    art->blue = clamp(art->blue, 0, 255);
}

bool lad_artwork_edited(const LadArtwork *art) {
    return art->solid || art->crop_width || art->crop_height || art->hue ||
           art->saturation || art->brightness;
}

SDL_Surface *lad_artwork_load(const char *path) {
    if (!lad_is_image(path)) return NULL;
    SDL_RWops *file = SDL_RWFromFile(path, "rb");
    if (!file) return NULL;
    Sint64 size = SDL_RWsize(file);
    if (size <= 0 || size > MAX_IMAGE_BYTES) {
        SDL_RWclose(file);
        return NULL;
    }
    SDL_Surface *source = IMG_Load_RW(file, 1);
    if (!source || source->w <= 0 || source->h <= 0 ||
        source->w > MAX_IMAGE_EDGE || source->h > MAX_IMAGE_EDGE) {
        SDL_FreeSurface(source);
        return NULL;
    }
    SDL_Surface *rgba = SDL_ConvertSurfaceFormat(source, SDL_PIXELFORMAT_RGBA32, 0);
    SDL_FreeSurface(source);
    if (rgba) SDL_SetSurfaceBlendMode(rgba, SDL_BLENDMODE_NONE);
    return rgba;
}

SDL_Rect lad_artwork_crop(const SDL_Surface *source, const LadArtwork *art) {
    const int w = clamp((source->w * (100 - clamp(art->crop_width, 0, 95)) + 50) / 100,
                        1, source->w);
    const int h = clamp((source->h * (100 - clamp(art->crop_height, 0, 95)) + 50) / 100,
                        1, source->h);
    return (SDL_Rect){
        ((source->w - w) * (100 + clamp(art->crop_x, -100, 100)) + 100) / 200,
        ((source->h - h) * (100 + clamp(art->crop_y, -100, 100)) + 100) / 200,
        w, h
    };
}

static Uint8 channel(float value) {
    return (Uint8)clamp((int)(value + 0.5f), 0, 255);
}

static void adjust_color(SDL_Surface *image, const LadArtwork *art) {
    if (!art->hue && !art->saturation && !art->brightness) return;
    const float angle = art->hue * (3.14159265f / 180.0f);
    const float c = cosf(angle), s = sinf(angle);
    const float saturation = 1.0f + art->saturation / 100.0f;
    const float brightness = art->brightness * (255.0f / 100.0f);
    for (int y = 0; y < image->h; ++y) {
        Uint8 *pixel = (Uint8 *)image->pixels + y * image->pitch;
        for (int x = 0; x < image->w; ++x, pixel += 4) {
            const float r = pixel[0], g = pixel[1], b = pixel[2];
            const float luma = .213f * r + .715f * g + .072f * b;
            /* Rotate hue around luminance, then scale distance from gray. */
            pixel[0] = channel(luma + saturation *
                (c * (r - luma) + s * (b - luma)) + brightness);
            pixel[1] = channel(luma + saturation *
                (c * (g - luma) + s * (.143f * r + .140f * g - .283f * b)) + brightness);
            pixel[2] = channel(luma + saturation *
                (c * (b - luma) + s * (-.787f * r + .715f * g + .072f * b)) + brightness);
        }
    }
}

SDL_Surface *lad_artwork_render(SDL_Surface *source, const LadArtwork *requested,
                                int width, int height, SDL_Color fill,
                                bool transparent) {
    LadArtwork art = *requested;
    lad_artwork_normalize(&art);
    if (width <= 0 || height <= 0 || width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE)
        return NULL;
    SDL_Surface *result = SDL_CreateRGBSurfaceWithFormat(0, width, height, 32,
                                                        SDL_PIXELFORMAT_RGBA32);
    if (!result) return NULL;
    if (!source) {
        const Uint32 color = art.solid ?
            SDL_MapRGBA(result->format, art.red, art.green, art.blue, 255) :
            SDL_MapRGBA(result->format, fill.r, fill.g, fill.b, transparent ? 0 : 255);
        SDL_FillRect(result, NULL, color);
        return result;
    }
    SDL_Rect crop = lad_artwork_crop(source, &art);
    if (SDL_BlitScaled(source, &crop, result, NULL) < 0) {
        SDL_FreeSurface(result);
        return NULL;
    }
    if (art.solid) {
        for (int y = 0; y < height; ++y) {
            Uint8 *pixel = (Uint8 *)result->pixels + y * result->pitch;
            for (int x = 0; x < width; ++x, pixel += 4) {
                if (!pixel[3]) continue;
                pixel[0] = art.red;
                pixel[1] = art.green;
                pixel[2] = art.blue;
            }
        }
    } else {
        adjust_color(result, &art);
    }
    if (!transparent) {
        for (int y = 0; y < height; ++y) {
            Uint8 *pixel = (Uint8 *)result->pixels + y * result->pitch;
            for (int x = 0; x < width; ++x, pixel += 4) {
                const int alpha = pixel[3], background = 255 - alpha;
                pixel[0] = (pixel[0] * alpha + fill.r * background + 127) / 255;
                pixel[1] = (pixel[1] * alpha + fill.g * background + 127) / 255;
                pixel[2] = (pixel[2] * alpha + fill.b * background + 127) / 255;
                pixel[3] = 255;
            }
        }
    }
    return result;
}

void lad_artwork_mask_bubble(SDL_Surface *surface) {
    const int radius = surface->w < surface->h ? surface->w : surface->h;
    const int radius_squared = radius * radius;
    for (int y = 0; y < surface->h; ++y) {
        Uint8 *pixel = (Uint8 *)surface->pixels + y * surface->pitch;
        const int dy = 2 * y + 1 - surface->h;
        for (int x = 0; x < surface->w; ++x, pixel += 4) {
            const int dx = 2 * x + 1 - surface->w;
            const int coverage = clamp(radius_squared - dx * dx - dy * dy, 0, 4 * radius);
            pixel[3] = pixel[3] * coverage / (4 * radius);
        }
    }
}
