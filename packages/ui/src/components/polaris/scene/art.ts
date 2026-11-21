import { type Cover, cover } from "./geometry";
import { isSceneName, SCENES, type SceneMap } from "./map";

/** The map of the scene an element shows, by the theme's `--scene-kind`. */
export const sceneMapOf = (scene: HTMLElement): SceneMap | null => {
  const kind = getComputedStyle(scene).getPropertyValue("--scene-kind").trim();

  return isSceneName(kind) ? SCENES[kind] : null;
};

/** The stage's box (assets.css): the window less the sidebar's `--scene-inset-x` and the bars' `-y`. */
const inset = (root: CSSStyleDeclaration, name: string) =>
  Number.parseFloat(root.getPropertyValue(name)) || 0;

/** Where the art lands, in window coordinates: covering the stage's box from its foot, as assets.css places it. */
export const windowCover = (map: SceneMap): Cover => {
  const root = getComputedStyle(document.documentElement);
  const left = inset(root, "--scene-inset-x");
  const top = inset(root, "--scene-inset-y");
  const at = cover(window.innerWidth - left, window.innerHeight - top, map.width, map.height);

  return { scale: at.scale, x: at.x + left, y: at.y + top };
};

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
