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
    assert(lad_center_y(&cfg) == -54);
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
    assert(strstr(xml, "width=\"286\" height=\"168\" x=\"-1\" y=\"-54\"") != NULL);
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
    puts("Native template.xml smoke tests passed");
    return 0;
}
