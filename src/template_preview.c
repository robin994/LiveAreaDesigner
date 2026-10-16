#include "template_preview.h"

static const char *const STYLES[] = {
    "A1", "A2", "A3", "A4", "A5", "AD0", "AD1", "AD2", "AD3", "AD4",
    "BROWSER", "CONTENT_MANAGER", "KIDS", "MUSIC", "NSX1",
    "PS1EMU", "PSMOBILE", "PSPEMU", "VD"
};

const char *lad_preview_style_name(int style) {
    if (style < 0 || style >= (int)(sizeof(STYLES) / sizeof(STYLES[0])))
        return "A1";
    return STYLES[style];
}

LadPreviewGate lad_preview_gate(int template_style) {
    LadPreviewGate gate;
    gate.w = 280;
    gate.h = 158;
    gate.y = (500 - gate.h) / 2;
    gate.x = (840 - gate.w) / 2;
    gate.known_alignment = 0;
    if (template_style == 0) {
        gate.known_alignment = 1; /* a1: centered. */
    } else if (template_style == 16) {
        gate.x = 840 - gate.w - 24;
        gate.known_alignment = 1; /* psmobile: right aligned. */
    }
    /* Exact pixel offsets are illustrative, never read from system resources. */
    return gate;
}
