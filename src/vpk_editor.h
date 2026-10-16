#ifndef LAD_VPK_EDITOR_H
#define LAD_VPK_EDITOR_H

#include "assets.h"
#include <stdbool.h>
#include <stddef.h>

/* Never edit the user's VPK in place. Import selected assets into an isolated
   directory; save produces an independent modified_livearea.vpk. */
bool lad_import_existing_vpk(const char *source, DesignerConfig *cfg,
                             char *message, size_t size);
bool lad_write_modified_vpk(const char *source, const DesignerConfig *cfg,
                            char *message, size_t size);

#define LAD_MODIFIED_VPK "ux0:data/LiveAreaDesigner/export/modified_livearea.vpk"
#endif
