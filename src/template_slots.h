/* Auto-generated from data/livearea-layouts.json. Do not edit by hand. */
#ifndef LAD_TEMPLATE_SLOTS_H
#define LAD_TEMPLATE_SLOTS_H

typedef struct {
    int center_x;  /* X is positive right from the card center. */
    int center_y;  /* Y is positive UP from the card center. */
    int width;
    int height;
} LadTemplateSlot;

typedef struct {
    const char *style;
    int has_gate;
    int gate_center_x;
    int gate_center_y;
    const LadTemplateSlot *frames;
    int frame_count;
} LadTemplateLayout;

const LadTemplateLayout *lad_template_layout(int style_index);
int lad_template_frame_count(int style_index);
const LadTemplateSlot *lad_template_frame(int style_index, int frame_id);
void lad_template_frame_offsets(int style_index, int frame_id,
                                int card_center_x, int card_center_y,
                                int *offset_x, int *offset_y);

#endif
