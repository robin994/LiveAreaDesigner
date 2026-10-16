#include "template_preview.h"
#include "template_slots.h"

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
    const LadTemplateLayout *layout = lad_template_layout(template_style);
    LadPreviewGate gate;
    gate.w = 280;
    gate.h = 158;
    gate.x = 420 + layout->gate_center_x - gate.w / 2;
    gate.y = 250 - layout->gate_center_y - gate.h / 2;
    gate.known_alignment = layout->has_gate;
    /* Actual gate center from firmware RCOF layout hints. */
    return gate;
}
