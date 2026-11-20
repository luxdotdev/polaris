import { type Cover, cover } from "./geometry";
import { isSceneName, SCENES, type SceneMap } from "./map";

/** The map of the scene an element shows, by the theme's `--scene-kind`. */
export const sceneMapOf = (scene: HTMLElement): SceneMap | null => {
  const kind = getComputedStyle(scene).getPropertyValue("--scene-kind").trim();

  return isSceneName(kind) ? SCENES[kind] : null;
};

/** Where the art lands: covering the window from its foot, as `bg-fixed` places it. */
export const windowCover = (map: SceneMap): Cover =>
  cover(window.innerWidth, window.innerHeight, map.width, map.height);

/**
 * The scene's art as background size and position for `target`, laid out as the scene's own
 * (pinned to the window). For an element that animates with transforms, which `bg-fixed` can't follow.
 */
export const windowArt = (scene: HTMLElement, target: HTMLElement) => {
  const map = sceneMapOf(scene);

  if (map === null) return null;
  const at = windowCover(map);
  const box = target.getBoundingClientRect();

  return {
    image: getComputedStyle(scene).backgroundImage,
    size: `${map.width * at.scale}px ${map.height * at.scale}px`,
    position: `${at.x - box.left}px ${at.y - box.top}px`,
  };
};
