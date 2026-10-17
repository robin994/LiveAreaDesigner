#include "quantize.h"

#include <math.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>

#define LAD_HIST_BINS 32768
#define LAD_EXACT_HASH 1024

typedef struct {
    uint32_t count;
    uint32_t sum_r, sum_g, sum_b;
} Histogram;

typedef struct {
    float r, g, b;
    uint32_t count;
} ColorBin;

typedef struct {
    int begin, end, axis;
    double total;
    float r, g, b;
    double priority;
} ColorBox;

static int sort_axis;

static int compare_bin(const void *left, const void *right) {
    const ColorBin *a = (const ColorBin *)left;
    const ColorBin *b = (const ColorBin *)right;
    const float a_value = sort_axis == 0 ? a->r : sort_axis == 1 ? a->g : a->b;
    const float b_value = sort_axis == 0 ? b->r : sort_axis == 1 ? b->g : b->b;
    return a_value < b_value ? -1 : a_value > b_value ? 1 : 0;
}

static int rgb_key(int r, int g, int b) {
    return ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
}

static uint8_t byte_clamp(float value) {
    if (value <= 0.f) return 0;
    if (value >= 255.f) return 255;
    return (uint8_t)(value + .5f);
}

static float clamp_error(float value) {
    if (value < -32.f) return -32.f;
    if (value > 32.f) return 32.f;
    return value;
}

static int nearest_color(float r, float g, float b,
                         const uint8_t palette[256][3], int count,
                         int start) {
    int best = start;
    float best_distance = HUGE_VALF;
    for (int i = start; i < count; i++) {
        const float dr = r - palette[i][0];
        const float dg = g - palette[i][1];
        const float db = b - palette[i][2];
        const float distance = 3.f * dr * dr + 4.f * dg * dg + 2.f * db * db;
        if (distance < best_distance) {
            best_distance = distance;
            best = i;
        }
    }
    return best;
}

static ColorBox box_stats(ColorBin *bins, int begin, int end) {
    ColorBox box = {.begin = begin, .end = end};
    double total = 0., sr = 0., sg = 0., sb = 0.;
    for (int i = begin; i < end; i++) {
        const double weight = bins[i].count;
        total += weight;
        sr += bins[i].r * weight;
        sg += bins[i].g * weight;
        sb += bins[i].b * weight;
    }
    box.total = total;
    box.r = (float)(sr / total);
    box.g = (float)(sg / total);
    box.b = (float)(sb / total);
    double variations[3] = {0., 0., 0.};
    for (int i = begin; i < end; i++) {
        const double weight = bins[i].count;
        const double dr = bins[i].r - box.r;
        const double dg = bins[i].g - box.g;
        const double db = bins[i].b - box.b;
        variations[0] += 3. * dr * dr * weight;
        variations[1] += 4. * dg * dg * weight;
        variations[2] += 2. * db * db * weight;
    }
    box.axis = 0;
    if (variations[1] > variations[box.axis]) box.axis = 1;
    if (variations[2] > variations[box.axis]) box.axis = 2;
    box.priority = end > begin + 1 ?
        variations[box.axis] / sqrt(total) : -1.;
    return box;
}

static int adaptive_palette(ColorBin *bins, int bins_count, int requested,
                            uint8_t palette[256][3], int reserve) {
    ColorBox boxes[256];
    boxes[0] = box_stats(bins, 0, bins_count);
    int boxes_count = 1;
    while (boxes_count < requested) {
        int best = -1;
        for (int i = 0; i < boxes_count; i++)
            if (boxes[i].priority > 0. &&
                (best < 0 || boxes[i].priority > boxes[best].priority))
                best = i;
        if (best < 0) break;
        ColorBox box = boxes[best];
        sort_axis = box.axis;
        qsort(bins + box.begin, (size_t)(box.end - box.begin),
              sizeof(*bins), compare_bin);
        double weight = 0.;
        int split = box.begin;
        while (split < box.end - 1 && weight < box.total / 2.)
            weight += bins[split++].count;
        if (split == box.begin) split++;
        boxes[best] = box_stats(bins, box.begin, split);
        boxes[boxes_count++] = box_stats(bins, split, box.end);
    }

    for (int i = 0; i < boxes_count; i++) {
        palette[reserve + i][0] = byte_clamp(boxes[i].r);
        palette[reserve + i][1] = byte_clamp(boxes[i].g);
        palette[reserve + i][2] = byte_clamp(boxes[i].b);
    }
    // Two weighted Lloyd refinement passes preserve common colors and
    // correct median-cut boundaries without exceeding PNG8's palette size.
    for (int pass = 0; pass < 2; pass++) {
        double sums[256][4] = {{0.}};
        for (int i = 0; i < bins_count; i++) {
            const ColorBin *bin = &bins[i];
            const int index = nearest_color(bin->r, bin->g, bin->b,
                                            (const uint8_t (*)[3])palette,
                                            reserve + boxes_count, reserve);
            sums[index][0] += bin->r * bin->count;
            sums[index][1] += bin->g * bin->count;
            sums[index][2] += bin->b * bin->count;
            sums[index][3] += bin->count;
        }
        for (int i = reserve; i < reserve + boxes_count; i++) {
            if (sums[i][3] == 0.) continue;
            for (int channel = 0; channel < 3; channel++)
                palette[i][channel] = byte_clamp(
                    (float)(sums[i][channel] / sums[i][3]));
        }
    }
    return boxes_count;
}

static int cached_nearest(int r, int g, int b,
                          const uint8_t palette[256][3], int colors,
                          int start, int16_t *cache) {
    const int key = rgb_key(r, g, b);
    if (cache[key] >= 0) return cache[key];
    const int index = nearest_color((float)r, (float)g, (float)b,
                                    palette, colors, start);
    cache[key] = (int16_t)index;
    return index;
}

static void diffuse(float *row, int width, int x,
                    float er, float eg, float eb, float weight) {
    if (x < 0 || x >= width) return;
    const int at = (x + 1) * 3;
    row[at] += er * weight;
    row[at + 1] += eg * weight;
    row[at + 2] += eb * weight;
}

void lad_indexed_free(LadIndexed *image) {
    if (!image) return;
    free(image->indices);
    image->indices = NULL;
    image->colors = 0;
}

bool lad_quantize_rgba(const uint8_t *rgba, int width, int height,
                       bool transparency, int max_colors, float dither,
                       LadIndexed *output) {
    if (!output) return false;
    memset(output, 0, sizeof(*output));
    if (!rgba || width <= 0 || height <= 0 || width > 4096 || height > 4096 ||
        max_colors < 2 || max_colors > 256) return false;
    const int reserve = transparency ? 1 : 0;
    const int palette_limit = max_colors - reserve;
    const size_t total_pixels = (size_t)width * height;
    Histogram *histogram = (Histogram *)calloc(LAD_HIST_BINS, sizeof(*histogram));
    uint8_t *indices = (uint8_t *)malloc(total_pixels);
    if (!histogram || !indices) { free(histogram); free(indices); return false; }
    uint32_t exact_keys[LAD_EXACT_HASH];
    uint16_t exact_values[LAD_EXACT_HASH];
    uint32_t exact_colors[256];
    for (int i = 0; i < LAD_EXACT_HASH; i++) exact_keys[i] = UINT32_MAX;
    int exact_count = 0;
    bool overflow = false;
    int bins_count = 0;
    for (size_t pixel = 0; pixel < total_pixels; pixel++) {
        const uint8_t *src = rgba + pixel * 4;
        if (transparency && src[3] < 128) continue;
        const int r = src[0], g = src[1], b = src[2];
        const uint32_t rgb = ((uint32_t)r << 16) | ((uint32_t)g << 8) | (uint32_t)b;
        if (!overflow) {
            int slot = (int)((rgb * 2654435761u) >> 22);
            while (exact_keys[slot] != UINT32_MAX && exact_keys[slot] != rgb)
                slot = (slot + 1) & (LAD_EXACT_HASH - 1);
            if (exact_keys[slot] == UINT32_MAX) {
                if (exact_count >= palette_limit) overflow = true;
                else {
                    exact_keys[slot] = rgb;
                    exact_values[slot] = (uint16_t)(exact_count + reserve);
                    exact_colors[exact_count++] = rgb;
                }
            }
        }
        const int key = rgb_key(r, g, b);
        Histogram *cell = &histogram[key];
        if (!cell->count) bins_count++;
        cell->count++;
        cell->sum_r += (uint32_t)r;
        cell->sum_g += (uint32_t)g;
        cell->sum_b += (uint32_t)b;
    }

    output->indices = indices;
    output->transparent = transparency;
    if (!overflow) {
        output->colors = exact_count + reserve;
        for (int i = 0; i < exact_count; i++) {
            const uint32_t key = exact_colors[i];
            output->rgb[reserve + i][0] = (uint8_t)(key >> 16);
            output->rgb[reserve + i][1] = (uint8_t)(key >> 8);
            output->rgb[reserve + i][2] = (uint8_t)key;
        }
        for (size_t pixel = 0; pixel < total_pixels; pixel++) {
            const uint8_t *src = rgba + pixel * 4;
            if (transparency && src[3] < 128) { indices[pixel] = 0; continue; }
            const uint32_t rgb = ((uint32_t)src[0] << 16) |
                                 ((uint32_t)src[1] << 8) | (uint32_t)src[2];
            int slot = (int)((rgb * 2654435761u) >> 22);
            while (exact_keys[slot] != rgb)
                slot = (slot + 1) & (LAD_EXACT_HASH - 1);
            indices[pixel] = (uint8_t)exact_values[slot];
        }
        if (!output->colors) output->colors = 1;
        free(histogram);
        return true;
    }

    ColorBin *bins = (ColorBin *)malloc((size_t)bins_count * sizeof(*bins));
    if (!bins) { free(histogram); lad_indexed_free(output); return false; }
    int next = 0;
    for (int i = 0; i < LAD_HIST_BINS; i++) {
        const Histogram *cell = &histogram[i];
        if (!cell->count) continue;
        bins[next++] = (ColorBin){
            .r = (float)cell->sum_r / cell->count,
            .g = (float)cell->sum_g / cell->count,
            .b = (float)cell->sum_b / cell->count,
            .count = cell->count
        };
    }
    free(histogram);
    const int count = adaptive_palette(bins, bins_count, palette_limit, output->rgb, reserve);
    output->colors = reserve + count;
    free(bins);

    int16_t *cache = (int16_t *)malloc(LAD_HIST_BINS * sizeof(*cache));
    if (!cache) { lad_indexed_free(output); return false; }
    memset(cache, 0xff, LAD_HIST_BINS * sizeof(*cache));
    if (dither < 0.f) dither = 0.f;
    if (dither > 1.f) dither = 1.f;
    float *current = NULL;
    float *following = NULL;
    if (dither > 0.f) {
        current = (float *)calloc((size_t)(width + 2) * 3, sizeof(float));
        following = (float *)calloc((size_t)(width + 2) * 3, sizeof(float));
        if (!current || !following) {
            free(current); free(following); free(cache);
            lad_indexed_free(output);
            return false;
        }
    }
    for (int y = 0; y < height; y++) {
        const bool forward = !(y & 1);
        for (int j = 0; j < width; j++) {
            const int x = forward ? j : width - 1 - j;
            const size_t pixel = (size_t)y * width + x;
            const uint8_t *src = rgba + pixel * 4;
            if (transparency && src[3] < 128) {
                indices[pixel] = 0;
                continue;
            }
            const int at = (x + 1) * 3;
            const int r = current ? byte_clamp(src[0] + clamp_error(current[at])) : src[0];
            const int g = current ? byte_clamp(src[1] + clamp_error(current[at + 1])) : src[1];
            const int b = current ? byte_clamp(src[2] + clamp_error(current[at + 2])) : src[2];
            const int color = cached_nearest(r, g, b,
                                              (const uint8_t (*)[3])output->rgb,
                                              output->colors, reserve, cache);
            indices[pixel] = (uint8_t)color;
            if (!current) continue;
            const float er = (r - output->rgb[color][0]) * dither;
            const float eg = (g - output->rgb[color][1]) * dither;
            const float eb = (b - output->rgb[color][2]) * dither;
            const int dir = forward ? 1 : -1;
            diffuse(current, width, x + dir, er, eg, eb, 7.f / 16.f);
            diffuse(following, width, x - dir, er, eg, eb, 3.f / 16.f);
            diffuse(following, width, x, er, eg, eb, 5.f / 16.f);
            diffuse(following, width, x + dir, er, eg, eb, 1.f / 16.f);
        }
        if (current) {
            float *swap = current;
            current = following;
            following = swap;
            memset(following, 0, (size_t)(width + 2) * 3 * sizeof(float));
        }
    }
    free(current);
    free(following);
    free(cache);
    return true;
}
