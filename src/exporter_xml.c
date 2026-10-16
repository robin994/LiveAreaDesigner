#include "exporter.h"

#include <stdio.h>
#include <string.h>

static const char *styles[] = {
    "a1", "a2", "a3", "a4", "a5", "ad0", "ad1", "ad2", "ad3", "ad4",
    "browser", "content_manager", "kids", "music", "nsx1",
    "ps1emu", "psmobile", "pspemu", "vd"
};

int lad_center_x(const DesignerConfig *config) {
    /* Card center: X=0 at 420 px, left negative and right positive. */
    return config->x + config->w / 2 - 420;
}
int lad_center_y(const DesignerConfig *config) {
    /* Card center: Y=0 at 250 px, up negative and down positive. */
    return config->y + config->h / 2 - 250;
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
    int frame = c->frame_id;
    if (frame < 1 || frame > 3) frame = 3;
    fprintf(out,
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
        "<livearea style=\"%s\" format-ver=\"01.00\" content-rev=\"1\">\n"
        "  <livearea-background>\n"
        "    <image>bg0.png</image>\n"
        "  </livearea-background>\n"
        "  <gate>\n"
        "    <startup-image>startup.png</startup-image>\n"
        "  </gate>\n"
        "  <frame id=\"frame%d\" multi=\"o\" autoflip=\"%d\" rev=\"1\">\n"
        "    <liveitem default=\"on\">\n",
        styles[style], frame, c->autoflip ? 1 : 0);
    if (c->frame_lang[0]) {
        fputs("      <lang>", out);
        xml_escape(out, c->frame_lang);
        fputs("</lang>\n", out);
    }
    if (c->age_limit > 0) {
        int age = c->age_limit > 18 ? 18 : c->age_limit;
        fprintf(out, "      <age-limit>%d</age-limit>\n", age);
    }
    if (c->vita_only) fputs("      <model>vita</model>\n", out);
    fprintf(out,
        "      <image align=\"center\" valign=\"center\" origin=\"frame\" "
        "width=\"%d\" height=\"%d\" x=\"%d\" y=\"%d\">button.png</image>\n",
        c->w, c->h, lad_center_x(c), lad_center_y(c));
    if (c->frame_target[0]) {
        fputs("      <target>", out);
        xml_escape(out, c->frame_target);
        fputs("</target>\n", out);
    }
    if (c->frame_text[0]) {
        fputs("      <text align=\"center\" valign=\"bottom\">\n"
              "        <str size=\"22\" color=\"#ffffff\" bold=\"on\">", out);
        xml_escape(out, c->frame_text);
        fputs("</str>\n      </text>\n", out);
    }
    fputs("    </liveitem>\n  </frame>\n</livearea>\n", out);
    return ferror(out) == 0;
}
