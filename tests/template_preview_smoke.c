#include "template_preview.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

int main(void) {
    LadPreviewGate center = lad_preview_gate(0);
    assert(center.x == 280 && center.y == 171);
    assert(center.w == 280 && center.h == 158);
    assert(center.known_alignment == 1);

    LadPreviewGate right = lad_preview_gate(16);
    assert(right.x == 536 && right.y == 171);
    assert(right.w == 280 && right.h == 158);
    assert(right.known_alignment == 1);

    LadPreviewGate schematic = lad_preview_gate(2);
    assert(schematic.known_alignment == 0);
    assert(strcmp(lad_preview_style_name(16), "PSMOBILE") == 0);
    assert(strcmp(lad_preview_style_name(2), "A3") == 0);
    assert(strcmp(lad_preview_style_name(100), "A1") == 0);
    puts("Native LiveArea template preview geometry tests passed");
    return 0;
}
