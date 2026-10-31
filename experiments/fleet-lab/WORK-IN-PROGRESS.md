# Fleet workshop — review milestone, not an integration release

Only `experiments/fleet-lab/` is changed. No production vehicles, backend, account data or APK changed.
The user explicitly wants to see these models before they enter the game.

Current stages: sedan optimization open; compact material open; SUV/pickup/van/bus form open.
All five native family structural assemblies have passed their scoped review. Their destruction is deliberately disabled in the UI; do not enable stage 6 on them without implementing and testing their native semantic registration and hinge axes. The original sedan registration assumes rear-window/quarter/seat-rear nodes that a van and bus do not share.

Geometry and assembly checks: model-tests.cjs, compact-tests.cjs, family-structure-tests.cjs passed. Actual Cannon simulation of the sedan's 30 detached panel/glass fragments passed. These tests do not establish production mobile or multiplayer performance. Sedan is still 82 draws, and the other families are not optimized.

The model gallery shows real current browser captures and labels their unfinished stage. The dark band/roof/margins are still coarse on some bodies. Native wheel/door, cargo/hatch, rear lamps, roof rails, cab seating and bus entrance styles are implemented. Continue visual refinement before releasing them.

Compact material diagnostic remains failed (global per-part colour palette comparison). Do not mark its material pass accepted or lower thresholds. Raw reports and geometrical results remain separate. The same scope limitation already affects the sedan's hidden rear lamps in a front image.

Use the skill next.py with each family's state/spec before resuming. Current review helpers package transparent actual render, unlit map-stripped render, equal-aspect comparison and a second angle. From this revision each pass stores its own map-stripped PNG. Early entries reused capture-clay.png; that mutable path is not immutable archival clay evidence, so a release audit must re-capture any earlier pass that needs that independent evidence.

Camera fitting scripts are CPU geometry math only, not browser automation. fit-silhouette.cjs fits the camera to actual factory triangles without deforming the model or stretching an image. Isolated references are generated derivatives of the original concept sheets, not exact pixel extractions. Preserve the original sheets as design authority.

Before integration: finish family form/material reviews, verify rear and opposite-side views, finish family-specific part manifests and sockets, correct native hatch/tailgate/sliding/rear-door hinge motion, add glass and physical fragment tests per family, optimize and build real city traffic LODs, test mobile/host/guest. Do not overwrite the approved muscle car or tank during this prototype phase.
