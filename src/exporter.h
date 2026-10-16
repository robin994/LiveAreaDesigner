#ifndef LIVEAREA_EXPORTER_H
#define LIVEAREA_EXPORTER_H

#include "assets.h"
#include <stdbool.h>
#include <stddef.h>
#include <stdio.h>

#define LAD_EXPORT_DIR "ux0:data/LiveAreaDesigner/export"

/* Common, host-testable LiveArea template writer. */
bool lad_write_template(FILE *out, const DesignerConfig *config);
int lad_center_x(const DesignerConfig *config);
int lad_center_y(const DesignerConfig *config);

/* Vita-specific PNG8 asset writer + template.xml output directory. */
bool lad_export_bundle(const DesignerConfig *config, char *error, size_t error_size);

#endif
