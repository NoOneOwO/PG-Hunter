/**
 * Barrel for the pixel engine.
 *
 * Importing this module registers every scene, which is what `mountScenesIn`
 * needs in order to resolve `data-pixel-scene="street"` and friends.
 * Components import from here rather than from `./core` directly, so a scene
 * can never be missing at runtime.
 */

import "./scenes-impl";

export { mountScene, mountScenesIn } from "./core";
export type { Painter, Rgb, Scene } from "./core";