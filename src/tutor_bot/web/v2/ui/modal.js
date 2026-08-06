/* Модалка.
 *
 * Закрытие: тапом по фону, кнопкой и свайпом вниз. Пороги свайпа заданы
 * дизайном: 110 px либо 48 px при скорости выше 0.55 px/мс.
 *
 * Скролл фона блокируется с сохранением позиции: body переводится в
 * position:fixed со сдвигом top, при закрытии позиция возвращается. Без
 * этого Telegram WebView отматывает список в начало.
 */

import { el } from "./dom.js";
import { IconButton } from "./button.js";

const SWIPE_CLOSE = 110;
const SWIPE_FAST = 48;
const SWIPE_VELOCITY = 0.55;

let savedScrollTop = 0;
let openCount = 0;

function lockScroll() {
  if (openCount++ > 0) return;
  savedScrollTop = window.scrollY || document.documentElement.scrollTop || 0;
  document.body.style.top = `-${savedScrollTop}px`;
  document.body.classList.add("is-modal-open");
}

function unlockScroll() {
  if (--openCount > 0) return;
  openCount = 0;
  document.body.classList.remove("is-modal-open");
  document.body.style.top = "";
  window.scrollTo(0, savedScrollTop);
}

function haptic() {
  globalThis.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("light");
}

export function Modal({ title, body, footer = null, onClose } = {}) {
  const sheet = el("section", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title });
  const backdrop = el("div", { class: "modal-backdrop" }, [sheet]);

  let closed = false;
  function close({ animate = true } = {}) {
    if (closed) return;
    closed = true;
    const finish = () => {
      backdrop.remove();
      unlockScroll();
      onClose?.();
    };
    if (!animate) return finish();
    backdrop.classList.add("is-closing");
    setTimeout(finish, 180);
  }

  sheet.append(
    el("span", { class: "modal__handle", "aria-hidden": "true" }),
    el("div", { class: "modal__head" }, [
      el("h2", { class: "modal__title", text: title }),
      IconButton({ glyph: "✕", label: "Закрыть", onClick: () => close() }),
    ]),
    el("div", { class: "modal__body" }, Array.isArray(body) ? body : [body]),
    footer ? el("div", { class: "modal__footer" }, Array.isArray(footer) ? footer : [footer]) : null,
  );

  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });

  document.addEventListener("keydown", function onKey(event) {
    if (event.key !== "Escape") return;
    if (!backdrop.isConnected) return document.removeEventListener("keydown", onKey);
    close();
  });

  // --- свайп вниз ---
  let startY = 0, lastY = 0, lastAt = 0, velocity = 0, dragging = false, canDrag = false;

  const reset = () => {
    dragging = false;
    canDrag = false;
    sheet.classList.remove("is-dragging");
    sheet.style.removeProperty("--drag-y");
  };

  sheet.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1) return;
    startY = lastY = event.touches[0].clientY;
    lastAt = performance.now();
    velocity = 0;
    // тянуть можно только от ручки или шапки и только с самого верха списка
    canDrag = sheet.scrollTop <= 1 && Boolean(event.target.closest(".modal__handle, .modal__head"));
  }, { passive: true });

  sheet.addEventListener("touchmove", (event) => {
    if (!canDrag || event.touches.length !== 1) return;
    const y = event.touches[0].clientY;
    const delta = y - startY;
    const now = performance.now();
    velocity = (y - lastY) / Math.max(now - lastAt, 1);
    lastY = y;
    lastAt = now;
    if (!dragging && delta <= 8) return;
    if (!dragging && sheet.scrollTop > 1) return reset();
    dragging = true;
    event.preventDefault();
    sheet.classList.add("is-dragging");
    sheet.style.setProperty("--drag-y", `${Math.max(0, delta)}px`);
  }, { passive: false });

  sheet.addEventListener("touchend", () => {
    if (!dragging) return reset();
    const dragY = Math.max(0, lastY - startY);
    if (dragY >= SWIPE_CLOSE || (dragY > SWIPE_FAST && velocity > SWIPE_VELOCITY)) {
      haptic();
      return close();
    }
    reset();
  }, { passive: true });

  sheet.addEventListener("touchcancel", reset, { passive: true });

  return {
    node: backdrop,
    close,
    open(parent = document.body) {
      lockScroll();
      parent.append(backdrop);
      requestAnimationFrame(() => { sheet.scrollTop = 0; });
      return backdrop;
    },
  };
}
