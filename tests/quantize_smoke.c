#include "quantize.h"
#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void) {
    uint8_t flat[64 * 4] = {0};
    for (int i = 0; i < 64; i++) {
        flat[i * 4] = (uint8_t)((i * 37) & 255);
        flat[i * 4 + 1] = (uint8_t)((i * 71) & 255);
        flat[i * 4 + 2] = (uint8_t)((i * 97) & 255);
        flat[i * 4 + 3] = 255;
    }
    LadIndexed exact = {0};
    assert(lad_quantize_rgba(flat, 8, 8, false, 256, .45f, &exact));
    assert(exact.colors == 64);
    for (int i = 0; i < 64; i++)
        for (int channel = 0; channel < 3; channel++)
            assert(flat[i * 4 + channel] == exact.rgb[exact.indices[i]][channel]);
    lad_indexed_free(&exact);

    flat[0] = flat[1] = flat[2] = 255;
    flat[3] = 0;
    assert(lad_quantize_rgba(flat, 8, 8, true, 256, .45f, &exact));
    assert(exact.transparent && exact.indices[0] == 0);
    assert(exact.colors == 64);
    lad_indexed_free(&exact);

    enum { WIDTH = 320, HEIGHT = 240 };
    uint8_t *gradient = malloc(WIDTH * HEIGHT * 4);
    assert(gradient);
    double legacy_error = 0.;
    for (int y = 0; y < HEIGHT; y++) {
        for (int x = 0; x < WIDTH; x++) {
            const int p = (y * WIDTH + x) * 4;
            gradient[p] = (uint8_t)(x * 255 / (WIDTH - 1));
            gradient[p + 1] = (uint8_t)((x + y) * 255 / (WIDTH + HEIGHT - 2));
            gradient[p + 2] = (uint8_t)(y * 255 / (HEIGHT - 1));
            gradient[p + 3] = 255;
            const int old_r = ((gradient[p] * 6 + 127) / 255) * 255 / 6;
            const int old_g = ((gradient[p + 1] * 7 + 127) / 255) * 255 / 7;
            const int old_b = ((gradient[p + 2] * 3 + 127) / 255) * 255 / 3;
            const int er = gradient[p] - old_r;
            const int eg = gradient[p + 1] - old_g;
            const int eb = gradient[p + 2] - old_b;
            legacy_error += 3. * er * er + 4. * eg * eg + 2. * eb * eb;
        }
    }
    assert(lad_quantize_rgba(gradient, WIDTH, HEIGHT, false, 256, .45f, &exact));
    assert(exact.colors == 256);
    double adaptive_error = 0.;
    for (int p = 0; p < WIDTH * HEIGHT; p++) {
        const uint8_t *color = exact.rgb[exact.indices[p]];
        const int er = gradient[p * 4] - color[0];
        const int eg = gradient[p * 4 + 1] - color[1];
        const int eb = gradient[p * 4 + 2] - color[2];
        adaptive_error += 3. * er * er + 4. * eg * eg + 2. * eb * eb;
    }
    const double ratio = adaptive_error / legacy_error;
    printf("Native gradient color error compared to fixed palette: %.3fx\n", ratio);
    assert(ratio < .09);
    lad_indexed_free(&exact);
    free(gradient);
    puts("Adaptive palette host smoke tests passed");
    return 0;
}
