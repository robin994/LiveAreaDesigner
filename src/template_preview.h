#ifndef LIVEAREA_TEMPLATE_PREVIEW_H
#define LIVEAREA_TEMPLATE_PREVIEW_H

typedef struct {
    int x, y, w, h; /* Relative to the 840x500 card. */
    int known_alignment; /* Center/right known, precise offsets unverified. */
} LadPreviewGate;

LadPreviewGate lad_preview_gate(int template_style);
const char *lad_preview_style_name(int template_style);

#endif
