import { useEffect, useRef } from "react";

import { reducedMotion } from "../../../lib/motion";
import type { Pixel } from "./actors";
import { type Cover, cover, toScene } from "./geometry";
import { SCENES, type SceneMap } from "./map";
import { frameKey, SceneMotion } from "./motion";

declare global {
  interface Window {
    /** Scripts call a meteor or a flock on demand: `window.__polarisScene?.summon()`. */
    __polarisScene?: {
      readonly summon: () => void;
      readonly flying: () => { readonly meteor: boolean; readonly flock: boolean };
    };
  }
}

/**
 * How long until the next step: ambient life (twinkles, lamp, smoke) changes slowly, so two steps
 * a second; a meteor needs its own pace, and birds a pixel every 110ms. Each step that changes a
 * pixel costs a whole frame across Chromium's processes, so fewer steps is the saving.
 */
const stepMs = (model: SceneMotion) => (model.meteor.flying ? 33 : model.flock.flying ? 110 : 500);

const INPUT = ["pointermove", "pointerdown", "keydown", "wheel"] as const;

/** With no input in the window for this long the scene rests (still) until the next input. */
const REST_AFTER_MS = 180_000;

const sceneKind = (scene: HTMLElement): SceneMap | null => {
  const kind = getComputedStyle(scene).getPropertyValue("--scene-kind").trim();

  return kind === "night" || kind === "dawn" ? SCENES[kind] : null;
};

/** The scene's content (headline, setup card) as scene-pixel boxes that visitors keep clear of. */
const contentBoxes = (scene: HTMLElement, layer: HTMLElement, at: Cover) => {
  const origin = scene.getBoundingClientRect();

  return [...scene.children].flatMap((child) => {
    if (child === layer) return [];
    const r = child.getBoundingClientRect();

    return [
      toScene(
        { left: r.left - origin.left, top: r.top - origin.top, width: r.width, height: r.height },
        at
      ),
    ];
  });
};

/**
 * Runs one scene's motion; returns a function that stops it. The canvas is the scene's own size
 * (one canvas pixel per scene pixel), scaled and placed as the background is, inside `layer`,
 * which is pinned to the scene's visible box and clips it.
 */
const runScene = (layer: HTMLElement, canvas: HTMLCanvasElement, scene: HTMLElement) => {
  // A 360×225 bitmap: a software context uploads it cheaply and keeps no GPU canvas around.
  const context = canvas.getContext("2d", { willReadFrequently: true });
  let epoch = performance.now();
  let model: SceneMotion | null = null;
  let at: Cover = { scale: 1, x: 0, y: 0 };
  let drawn: readonly Pixel[] = [];
  let key = "";
  let timer = 0;
  let onScreen = true;
  let lastInput = performance.now();

  const clear = () => {
    context?.clearRect(0, 0, canvas.width, canvas.height);
    drawn = [];
    key = "";
  };

  const draw = () => {
    if (context === null || model === null) return;
    const pixels = model.pixels();
    const next = frameKey(pixels);

    if (next === key) return;

    for (const p of drawn) context.clearRect(p.x, p.y, 1, 1);

    for (const p of pixels) {
      context.globalAlpha = p.alpha;
      context.fillStyle = p.color;
      context.fillRect(p.x, p.y, 1, 1);
    }

    context.globalAlpha = 1;
    drawn = pixels;
    key = next;
  };

  const measure = () => {
    const width = scene.clientWidth;
    const height = scene.clientHeight;
    const map = model?.map;

    layer.style.width = `${width}px`;
    layer.style.height = `${height}px`;
    layer.style.transform = `translateY(${scene.scrollTop}px)`;
    clear();

    if (map === undefined) return;
    at = cover(width, height, map.width, map.height);
    canvas.width = map.width;
    canvas.height = map.height;
    canvas.style.width = `${map.width * at.scale}px`;
    canvas.style.height = `${map.height * at.scale}px`;
    canvas.style.transform = `translate(${at.x}px, ${at.y}px)`;
    model?.setKeepOut(contentBoxes(scene, layer, at));
    draw();
  };

  const tick = () => {
    timer = 0;

    if (model === null) return;

    if (performance.now() - lastInput > REST_AFTER_MS) {
      update();

      return;
    }

    model.advance(performance.now() - epoch);
    draw();
    timer = window.setTimeout(tick, stepMs(model));
  };

  // Runs only while it can be seen and motion is allowed; otherwise the still scene shows.
  const update = () => {
    const awake = performance.now() - lastInput <= REST_AFTER_MS;

    const run =
      awake &&
      onScreen &&
      document.visibilityState === "visible" &&
      !reducedMotion() &&
      model !== null;

    if (run && timer === 0) tick();

    if (run) return;
    window.clearTimeout(timer);
    timer = 0;
    clear();
  };

  const setup = () => {
    const map = sceneKind(scene);

    epoch = performance.now();
    model = map === null ? null : new SceneMotion(map, Date.now() % 2 ** 31);
    measure();
    update();
  };

  const wake = () => {
    lastInput = performance.now();

    if (timer === 0) update();
  };

  const visibility = new IntersectionObserver((entries) => {
    onScreen = entries.some((entry) => entry.isIntersecting);
    update();
  });

  const sizes = new ResizeObserver(measure);
  const themes = new MutationObserver(setup);
  const scheme = matchMedia("(prefers-color-scheme: dark)");
  const motion = matchMedia("(prefers-reduced-motion: reduce)");

  visibility.observe(scene);
  sizes.observe(scene);

  for (const child of scene.children) if (child !== canvas) sizes.observe(child);
  themes.observe(document.documentElement, {
    attributeFilter: ["data-theme", "data-reduce-motion"],
  });
  scheme.addEventListener("change", setup);
  motion.addEventListener("change", update);
  document.addEventListener("visibilitychange", update);
  scene.addEventListener("scroll", measure, { passive: true });

  for (const kind of INPUT) window.addEventListener(kind, wake, { passive: true });
  setup();
  window.__polarisScene = {
    summon: () => model?.summon(),
    flying: () => ({ meteor: model?.meteor.flying ?? false, flock: model?.flock.flying ?? false }),
  };

  return () => {
    delete window.__polarisScene;
    window.clearTimeout(timer);
    visibility.disconnect();
    sizes.disconnect();
    themes.disconnect();
    scheme.removeEventListener("change", setup);
    motion.removeEventListener("change", update);
    document.removeEventListener("visibilitychange", update);
    scene.removeEventListener("scroll", measure);

    for (const kind of INPUT) window.removeEventListener(kind, wake);
  };
};

/**
 * The scene's ambient life (DESIGN.md, Pixel scenes): one scene-sized canvas under the content,
 * stepped four times a second (faster only while a meteor or birds pass), painting only on change. Still under Reduce Motion, while the
 * window is hidden or the scene is off screen.
 */
export function SceneLayer() {
  const layerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const layer = layerRef.current;
    const canvas = canvasRef.current;
    const scene = layer?.parentElement;

    if (layer === null || canvas === null || scene === null || scene === undefined) return;

    return runScene(layer, canvas, scene);
  }, []);

  return (
    <div
      ref={layerRef}
      aria-hidden="true"
      data-slot="scene-motion"
      className="pointer-events-none absolute top-0 left-0 -z-20 overflow-hidden"
    >
      <canvas ref={canvasRef} className="pixelated absolute top-0 left-0 origin-top-left" />
    </div>
  );
}
