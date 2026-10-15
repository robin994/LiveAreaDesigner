#include "font.h"

#include <ctype.h>
#include <string.h>

/* Five columns x seven rows. The atlas is created only once, not every frame. */
static const char *glyph(char ch) {
    switch (toupper((unsigned char)ch)) {
    case 'A': return "01110""10001""10001""11111""10001""10001""10001";
    case 'B': return "11110""10001""10001""11110""10001""10001""11110";
    case 'C': return "01111""10000""10000""10000""10000""10000""01111";
    case 'D': return "11110""10001""10001""10001""10001""10001""11110";
    case 'E': return "11111""10000""10000""11110""10000""10000""11111";
    case 'F': return "11111""10000""10000""11110""10000""10000""10000";
    case 'G': return "01111""10000""10000""10111""10001""10001""01111";
    case 'H': return "10001""10001""10001""11111""10001""10001""10001";
    case 'I': return "11111""00100""00100""00100""00100""00100""11111";
    case 'J': return "00111""00010""00010""00010""10010""10010""01100";
    case 'K': return "10001""10010""10100""11000""10100""10010""10001";
    case 'L': return "10000""10000""10000""10000""10000""10000""11111";
    case 'M': return "10001""11011""10101""10101""10001""10001""10001";
    case 'N': return "10001""11001""10101""10011""10001""10001""10001";
    case 'O': return "01110""10001""10001""10001""10001""10001""01110";
    case 'P': return "11110""10001""10001""11110""10000""10000""10000";
    case 'Q': return "01110""10001""10001""10001""10101""10010""01101";
    case 'R': return "11110""10001""10001""11110""10100""10010""10001";
    case 'S': return "01111""10000""10000""01110""00001""00001""11110";
    case 'T': return "11111""00100""00100""00100""00100""00100""00100";
    case 'U': return "10001""10001""10001""10001""10001""10001""01110";
    case 'V': return "10001""10001""10001""10001""10001""01010""00100";
    case 'W': return "10001""10001""10001""10101""10101""10101""01010";
    case 'X': return "10001""10001""01010""00100""01010""10001""10001";
    case 'Y': return "10001""10001""01010""00100""00100""00100""00100";
    case 'Z': return "11111""00001""00010""00100""01000""10000""11111";
    case '0': return "01110""10001""10011""10101""11001""10001""01110";
    case '1': return "00100""01100""00100""00100""00100""00100""01110";
    case '2': return "01110""10001""00001""00010""00100""01000""11111";
    case '3': return "11110""00001""00001""01110""00001""00001""11110";
    case '4': return "00010""00110""01010""10010""11111""00010""00010";
    case '5': return "11111""10000""10000""11110""00001""00001""11110";
    case '6': return "01111""10000""10000""11110""10001""10001""01110";
    case '7': return "11111""00001""00010""00100""01000""01000""01000";
    case '8': return "01110""10001""10001""01110""10001""10001""01110";
    case '9': return "01110""10001""10001""01111""00001""00001""11110";
    case ':': return "00000""00100""00100""00000""00100""00100""00000";
    case '/': return "00001""00001""00010""00100""01000""10000""10000";
    case '.': return "00000""00000""00000""00000""00000""01100""01100";
    case '-': return "00000""00000""00000""11111""00000""00000""00000";
    case '_': return "00000""00000""00000""00000""00000""00000""11111";
    case '?': return "01110""10001""00001""00010""00100""00000""00100";
    case '[': return "01110""01000""01000""01000""01000""01000""01110";
    case ']': return "01110""00010""00010""00010""00010""00010""01110";
    case '(': return "00010""00100""01000""01000""01000""00100""00010";
    case ')': return "01000""00100""00010""00010""00010""00100""01000";
    case '+': return "00000""00100""00100""11111""00100""00100""00000";
    case '=': return "00000""11111""00000""11111""00000""00000""00000";
    default:  return "00000""00000""00000""00000""00000""00000""00000";
    }
}

bool font_init(Font *font, SDL_Renderer *renderer) {
    font->atlas = NULL;
    SDL_Surface *surface = SDL_CreateRGBSurfaceWithFormat(0, 16 * 6, 8 * 8,
                                                          32, SDL_PIXELFORMAT_RGBA8888);
    if (!surface) return false;
    SDL_FillRect(surface, NULL, SDL_MapRGBA(surface->format, 0, 0, 0, 0));
    if (SDL_MUSTLOCK(surface) && SDL_LockSurface(surface) != 0) {
        SDL_FreeSurface(surface);
        return false;
    }
    Uint32 white = SDL_MapRGBA(surface->format, 255, 255, 255, 255);
    for (int ch = 32; ch < 128; ++ch) {
        const char *bits = glyph((char)ch);
        int ox = (ch % 16) * 6, oy = (ch / 16) * 8;
        for (int row = 0; row < 7; ++row) {
            Uint32 *pixels = (Uint32 *)((Uint8 *)surface->pixels +
                                        (oy + row) * surface->pitch);
            for (int col = 0; col < 5; ++col) {
                if (bits[row * 5 + col] == '1') pixels[ox + col] = white;
            }
        }
    }
    if (SDL_MUSTLOCK(surface)) SDL_UnlockSurface(surface);
    font->atlas = SDL_CreateTextureFromSurface(renderer, surface);
    SDL_FreeSurface(surface);
    if (!font->atlas) return false;
    SDL_SetTextureBlendMode(font->atlas, SDL_BLENDMODE_BLEND);
    return true;
}

void font_free(Font *font) {
    if (font->atlas) SDL_DestroyTexture(font->atlas);
    font->atlas = NULL;
}

void font_draw(Font *font, SDL_Renderer *renderer, int x, int y,
               const char *s, int scale, SDL_Color col, int max_chars) {
    if (!font->atlas || !s || scale <= 0) return;
    SDL_SetTextureColorMod(font->atlas, col.r, col.g, col.b);
    SDL_SetTextureAlphaMod(font->atlas, col.a);
    for (int i = 0; s[i] && (max_chars <= 0 || i < max_chars); ++i) {
        unsigned char ch = (unsigned char)s[i];
        if (ch < 32 || ch > 127) ch = '?';
        SDL_Rect src = {(ch % 16) * 6, (ch / 16) * 8, 5, 7};
        SDL_Rect dst = {x + i * 6 * scale, y, 5 * scale, 7 * scale};
        SDL_RenderCopy(renderer, font->atlas, &src, &dst);
    }
}
