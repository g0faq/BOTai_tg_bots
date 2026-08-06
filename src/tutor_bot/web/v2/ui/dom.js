/* Минимальный помощник построения DOM.
 *
 * Никаких innerHTML со склейкой строк: всё строится узлами, поэтому нет
 * места для инъекции и не нужен escapeHtml в каждом компоненте.
 */

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key === "style" && typeof value === "object") Object.assign(node.style, value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in node && key !== "list") {
      node[key] = value;
    } else {
      node.setAttribute(key, value === true ? "" : value);
    }
  }
  append(node, children);
  return node;
}

export function append(parent, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child == null || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

/** Число моноширинным с табличными цифрами — правило цифр из дизайна. */
export function num(value, extraClass = "") {
  return el("span", { class: `num ${extraClass}`.trim(), text: String(value) });
}

export function clear(node) {
  node.replaceChildren();
  return node;
}
