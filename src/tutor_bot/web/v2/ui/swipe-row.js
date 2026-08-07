/* Свайп по строке справа налево.
 *
 * Под строкой лежит одно действие. Пороги те же, что у модалки: 110 px
 * либо 48 px при скорости выше 0.55 px/мс — чтобы жест ощущался одинаково
 * во всём продукте.
 *
 * Действие выполняется сразу, но вызывающий обязан дать отмену: свайп
 * легко сделать случайно, а речь о деньгах.
 */
import { el } from "./dom.js";

const COMMIT = 110;
const FAST = 48;
const VELOCITY = 0.55;

function haptic() {
  globalThis.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("medium");
}

export function SwipeRow({ content, actionLabel = "Готово", tone = "debt", onCommit } = {}) {
  const surface = el("div", { class: "swipe__surface" }, [content]);
  const action = el("button", {
    type: "button",
    class: `swipe__action swipe__action--${tone}`,
    text: actionLabel,
    onClick: () => commit(),
  });
  const root = el("div", { class: "swipe" }, [action, surface]);

  let startX = 0, lastX = 0, lastAt = 0, velocity = 0, dragging = false, done = false;

  function reset() {
    dragging = false;
    surface.classList.remove("is-dragging");
    surface.style.removeProperty("--swipe-x");
  }

  function commit() {
    if (done) return;
    done = true;
    haptic();
    surface.style.setProperty("--swipe-x", "-100%");
    root.classList.add("is-committed");
    onCommit?.();
  }

  surface.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1 || done) return;
    startX = lastX = event.touches[0].clientX;
    lastAt = performance.now();
    velocity = 0;
  }, { passive: true });

  surface.addEventListener("touchmove", (event) => {
    if (event.touches.length !== 1 || done) return;
    const x = event.touches[0].clientX;
    const delta = x - startX;
    const now = performance.now();
    velocity = (lastX - x) / Math.max(now - lastAt, 1);
    lastX = x;
    lastAt = now;
    if (delta > 0 && !dragging) return;      // тянут вправо — не наш жест
    if (!dragging && delta > -8) return;
    dragging = true;
    event.preventDefault();
    surface.classList.add("is-dragging");
    surface.style.setProperty("--swipe-x", `${Math.max(delta, -160)}px`);
  }, { passive: false });

  surface.addEventListener("touchend", () => {
    if (!dragging) return reset();
    const dragX = Math.max(0, startX - lastX);
    if (dragX >= COMMIT || (dragX > FAST && velocity > VELOCITY)) return commit();
    reset();
  }, { passive: true });

  surface.addEventListener("touchcancel", reset, { passive: true });

  return root;
}
