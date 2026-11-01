# Workshop vehicle integration

The six existing workshop road bodies now drive production rendering for 19 existing catalogue entries. The approved sports coupe, tank and motorcycles retain their own models. The workshop and production factory must remain byte-equivalent apart from their header comment; city-three-road-model-tests.cjs exercises the production copy.

Damage keeps authoritative CityDamage simulation and its existing backwards compatible packet. The production adapter disables local workshop debris emission and uses actual native assemblies when authoritative panels detach. Front/rear damage uploads modified positions to the GPU. The glass remains transparent and carries the owning door/hatch. Paint, aura, driver and wheel animation are retained. The art review stages remain open; gameplay integration does not certify reference fidelity or mobile performance.

The main menu exposes Mes véhicules directly. The garage includes vehicles recorded either in inventory or the saved garage and marks the active vehicle. Existing ownership validation and police pursuit restrictions stay in place.

Pedestrian movement is interpolated only for presentation, including source-sampled velocity for gait. Teleports, ragdolls and recovery changes snap immediately. Simulation and collision positions are unchanged. Automated tests cover 10 Hz source samples at 30/60/120 Hz display refresh, shortest yaw turns, stops and exception states.

Validation: city-menu-ui-tests.cjs, city-three-npc-motion-tests.cjs, city-three-road-model-tests.cjs, city-three-fleet-network-tests.cjs, city-road-overhaul-tests.cjs, city-three-motion-tests.cjs, city-damage-tests.cjs and city-guest-tests.cjs. Browser QA uses experiments/gameplay-3d-lab with no real account or saved-data mutation. Physical Android and live two-phone testing remain user validation.
