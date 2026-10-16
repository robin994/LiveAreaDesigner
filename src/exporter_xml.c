#include "exporter.h"
#include "template_slots.h"

#include <stdio.h>
#include <string.h>

static const char *styles[] = {
    "a1", "a2", "a3", "a4", "a5", "ad0", "ad1", "ad2", "ad3", "ad4",
    "browser", "content_manager", "kids", "music", "nsx1",
    "ps1emu", "psmobile", "pspemu", "vd"
};

int lad_center_x(const DesignerConfig *config) {
    /* Card center: X=0 at 420 px, left negative and right positive. */
    /* Match browser Math.round() for odd positive image dimensions. */
    return config->x + (config->w + 1) / 2 - 420;
}
int lad_center_y(const DesignerConfig *config) {
    /* Card center: Y=0 at 250 px, up positive and down negative. */
    return 250 - config->y - (config->h + 1) / 2;
}
int lad_editor_center_x(const DesignerConfig *config) {
    const int x = lad_center_x(config);
    return config->invert_x ? -x : x;
}
int lad_editor_center_y(const DesignerConfig *config) {
    const int y = lad_center_y(config);
    return config->invert_y ? -y : y;
}

void lad_resolve_frame(const DesignerConfig *cfg, int frame_id,
                       DesignerFrame *out) {
    memset(out, 0, sizeof(*out));
    if (cfg->frame_id == frame_id) {
        out->initialized = 1;
        out->x = cfg->x; out->y = cfg->y;
        out->w = cfg->w; out->h = cfg->h;
        out->button_color = cfg->button_color;
        out->aspect_lock = cfg->aspect_lock;
        out->aspect_width = cfg->aspect_width;
        out->aspect_height = cfg->aspect_height;
        out->transparent_button = cfg->transparent_button;
        out->age_limit = cfg->age_limit;
        out->vita_only = cfg->vita_only;
        out->autoflip = cfg->autoflip;
        snprintf(out->image, sizeof(out->image), "%s", cfg->button_image);
        snprintf(out->target, sizeof(out->target), "%s", cfg->frame_target);
        snprintf(out->text, sizeof(out->text), "%s", cfg->frame_text);
        snprintf(out->lang, sizeof(out->lang), "%s", cfg->frame_lang);
        return;
    }
    const DesignerFrame *existing =
        &cfg->frames[cfg->template_style][frame_id - 1];
    if (existing->initialized) {
        *out = *existing;
        return;
    }
    const LadTemplateSlot *slot =
        lad_template_frame(cfg->template_style, frame_id);
    const int fw = slot && slot->width >= 24 ? slot->width : 120;
    const int fh = slot && slot->height >= 24 ? slot->height : 80;
    out->initialized = 1;
    out->w = fw < 286 ? fw : 286;
    out->h = fh < 168 ? fh : 168;
    const int cx = slot ? slot->center_x : 0;
    const int cy = slot ? slot->center_y : 0;
    out->x = 420 + cx - out->w / 2;
    out->y = 250 - cy - out->h / 2;
    if (out->x < 0) out->x = 0;
    if (out->y < 44) out->y = 44;
    out->button_color = cfg->button_color;
    out->aspect_width = out->w;
    out->aspect_height = out->h;
}

static void xml_escape(FILE *out, const char *s) {
    for (; *s; ++s) {
        switch (*s) {
        case '&': fputs("&amp;", out); break;
        case '<': fputs("&lt;", out); break;
        case '>': fputs("&gt;", out); break;
        case '"': fputs("&quot;", out); break;
        case '\'': fputs("&apos;", out); break;
        default: if ((unsigned char)*s >= 32 || *s == '\t') fputc(*s, out); break;
        }
    }
}

bool lad_write_template(FILE *out, const DesignerConfig *c) {
    if (!out || !c) return false;
    int style = c->template_style;
    if (style < 0 || style >= LAD_STYLE_COUNT) style = 0;
    const int max_frame = lad_template_frame_count(style);
    fprintf(out,
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
        "<livearea style=\"%s\" format-ver=\"01.00\" content-rev=\"1\">\n"
        "  <livearea-background>\n"
        "    <image>bg0.png</image>\n"
        "  </livearea-background>\n"
        "  <gate>\n"
        "    <startup-image>startup.png</startup-image>\n"
        "  </gate>\n",
        styles[style]);
    for (int frame = 1; frame <= max_frame; ++frame) {
        DesignerFrame item;
        lad_resolve_frame(c, frame, &item);
        int xml_x, xml_y;
        lad_template_frame_offsets(style, frame,
            item.x + (item.w + 1) / 2 - 420,
            250 - item.y - (item.h + 1) / 2,
            &xml_x, &xml_y);
        fprintf(out,
            "  <frame id=\"frame%d\" multi=\"o\" autoflip=\"%d\" rev=\"1\">\n"
            "    <liveitem default=\"on\">\n",
            frame, item.autoflip ? 1 : 0);
        if (item.lang[0]) {
            fputs("      <lang>", out);
            xml_escape(out, item.lang);
            fputs("</lang>\n", out);
        }
        if (item.age_limit > 0) {
            int age = item.age_limit > 18 ? 18 : item.age_limit;
            fprintf(out, "      <age-limit>%d</age-limit>\n", age);
        }
        if (item.vita_only) fputs("      <model>vita</model>\n", out);
        fprintf(out,
            "      <image align=\"center\" valign=\"center\" origin=\"frame\" "
            "width=\"%d\" height=\"%d\" x=\"%d\" y=\"%d\">frame%d.png</image>\n",
            item.w, item.h, xml_x, xml_y, frame);
        if (item.target[0]) {
            fputs("      <target>", out);
            xml_escape(out, item.target);
            fputs("</target>\n", out);
        }
        if (item.text[0]) {
            fputs("      <text align=\"center\" valign=\"bottom\">\n"
              "        <str size=\"22\" color=\"#ffffff\" bold=\"on\">", out);
            xml_escape(out, item.text);
            fputs("</str>\n      </text>\n", out);
        }
        fputs("    </liveitem>\n  </frame>\n", out);
    }
    fputs("</livearea>\n", out);
    return ferror(out) == 0;
}
