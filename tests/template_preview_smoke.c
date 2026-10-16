#include "template_preview.h"
#include "template_slots.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

int main(void) {
    LadPreviewGate center = lad_preview_gate(0);
    assert(center.x == 280 && center.y == 139);
    assert(center.w == 280 && center.h == 158);
    assert(center.known_alignment == 1);

    LadPreviewGate right = lad_preview_gate(16);
    assert(right.x == 520 && right.y == 155);
    assert(right.w == 280 && right.h == 158);
    assert(right.known_alignment == 1);
    assert(lad_preview_gate(5).known_alignment == 0); /* ad0: no gate */

    const int counts[] = {3, 3, 5, 5, 7};
    for (int style = 0; style < 5; ++style)
        assert(lad_template_frame_count(style) == counts[style]);

    const LadTemplateSlot *a1bottom = lad_template_frame(0, 3);
    assert(a1bottom && a1bottom->center_x == 0 &&
           a1bottom->center_y == -171 &&
           a1bottom->width == 840 && a1bottom->height == 150);
    const LadTemplateSlot *a2side = lad_template_frame(1, 1);
    assert(a2side && a2side->width == 260 && a2side->height == 400 &&
           a2side->center_y == -46);
    const LadTemplateSlot *a4last = lad_template_frame(3, 5);
    assert(a4last && a4last->width == 840 && a4last->height == 70);
    const LadTemplateSlot *a5seven = lad_template_frame(4, 7);
    assert(a5seven && a5seven->center_x == 240 &&
           a5seven->width == 360 && a5seven->height == 210);
    assert(!lad_template_frame(4, 8));
    assert(lad_template_frame_count(5) == 1);
    int x = 0, y = 0;
    lad_template_frame_offsets(0, 3, -1, 54, &x, &y);
    assert(x == -1 && y == 225);
    lad_template_frame_offsets(16, 2, -1, 54, &x, &y);
    assert(x == 162 && y == 109);

    LadPreviewGate schematic = lad_preview_gate(2);
    assert(schematic.known_alignment == 1);
    assert(schematic.x == 280 && schematic.y == 105);
    assert(strcmp(lad_preview_style_name(16), "PSMOBILE") == 0);
    assert(strcmp(lad_preview_style_name(2), "A3") == 0);
    assert(strcmp(lad_preview_style_name(100), "A1") == 0);
    puts("Native LiveArea template preview geometry tests passed");
    return 0;
}
