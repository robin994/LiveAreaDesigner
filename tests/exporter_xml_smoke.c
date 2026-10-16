#include "exporter.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

int main(void) {
    DesignerConfig cfg = {0};
    cfg.x = 276; cfg.y = 112; cfg.w = 286; cfg.h = 168;
    cfg.frame_id = 3;
    snprintf(cfg.frame_target, sizeof(cfg.frame_target), "https://example.org?a=1&b=<x>");
    snprintf(cfg.frame_text, sizeof(cfg.frame_text), "A <B> & \"C\"");
    snprintf(cfg.frame_lang, sizeof(cfg.frame_lang), "en");
    cfg.vita_only = 1;
    cfg.age_limit = 3;

    assert(lad_center_x(&cfg) == -1);
    assert(lad_center_y(&cfg) == 54);
    cfg.w = 285;
    cfg.h = 167;
    assert(lad_center_x(&cfg) == -1); /* Browser rounds .5 upward. */
    assert(lad_center_y(&cfg) == 54);
    cfg.y = 166; cfg.h = 168;
    assert(lad_center_y(&cfg) == 0);
    cfg.y = 186;
    assert(lad_center_y(&cfg) == -20);
    cfg.y = 146;
    assert(lad_center_y(&cfg) == 20);
    cfg.y = 112;
    cfg.w = 286;
    cfg.h = 168;
    FILE *file = tmpfile();
    assert(file);
    assert(lad_write_template(file, &cfg));
    rewind(file);
    char xml[8192] = {0};
    size_t bytes = fread(xml, 1, sizeof(xml) - 1, file);
    assert(bytes > 300);
    fclose(file);
    assert(strstr(xml, "<livearea style=\"a1\" format-ver=\"01.00\"") != NULL);
    assert(strstr(xml, "<image>bg0.png</image>") != NULL);
    assert(strstr(xml, "<startup-image>startup.png</startup-image>") != NULL);
    assert(strstr(xml, "width=\"286\" height=\"168\" x=\"-1\" y=\"225\"") != NULL);
    assert(strstr(xml, "frame1.png") != NULL);
    assert(strstr(xml, "frame2.png") != NULL);
    assert(strstr(xml, "frame3.png") != NULL);
    assert(strstr(xml, "button.png") == NULL);
    assert(strstr(xml, "<frame id=\"frame1\"") != NULL);
    assert(strstr(xml, "<frame id=\"frame2\"") != NULL);
    assert(strstr(xml, "https://example.org?a=1&amp;b=&lt;x&gt;") != NULL);
    assert(strstr(xml, "A &lt;B&gt; &amp; &quot;C&quot;") != NULL);
    assert(strstr(xml, "<model>vita</model>") != NULL);

    cfg.template_style = 16;  /* psmobile */
    cfg.frame_id = 2;
    file = tmpfile();
    assert(file && lad_write_template(file, &cfg));
    rewind(file);
    memset(xml, 0, sizeof(xml));
    fread(xml, 1, sizeof(xml) - 1, file);
    fclose(file);
    assert(strstr(xml, "style=\"psmobile\"") != NULL);
    assert(strstr(xml, "id=\"frame2\"") != NULL);
    assert(strstr(xml, "width=\"286\" height=\"168\" x=\"162\" y=\"109\"") != NULL);
    assert(strstr(xml, "frame4.png") != NULL);

    /* Verify an independent liveitem for a different native slot. */
    cfg.template_style = 0;
    cfg.frame_id = 3;
    DesignerFrame *first = &cfg.frames[0][0];
    memset(first, 0, sizeof(*first));
    first->initialized = 1;
    first->x = 36;
    first->y = 135;
    first->w = 132;
    first->h = 75;
    snprintf(first->target, sizeof(first->target), "https://example.org/first?a=1&b=2");
    snprintf(first->text, sizeof(first->text), "FIRST FRAME");
    file = tmpfile();
    assert(file && lad_write_template(file, &cfg));
    rewind(file);
    memset(xml, 0, sizeof(xml));
    fread(xml, 1, sizeof(xml) - 1, file);
    fclose(file);
    assert(strstr(xml, "FIRST FRAME") != NULL);
    assert(strstr(xml, "https://example.org/first?a=1&amp;b=2") != NULL);
    assert(strstr(xml, "width=\"132\" height=\"75\"") != NULL);
    assert(strstr(xml, "width=\"286\" height=\"168\"") != NULL);
    puts("Native template.xml smoke tests passed");
    return 0;
}
