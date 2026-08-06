/* Bootstrap v2.
 *
 * В этой волне экранов продукта нет — index показывает состояние ядра и
 * ссылку на витрину. Здесь важна только проверка, что ядро и роутер
 * поднимаются в реальном WebView, а шрифты и токены применяются.
 */

import { el } from "./ui/dom.js";
import { createRouter } from "./core/router.js";
import { getState, subscribe, setState } from "./core/state.js";
import { Header, TabBar } from "./ui/shell.js";
import { Button } from "./ui/button.js";
import { EmptyState } from "./ui/feedback.js";
import * as format from "./core/format.js";
import * as dict from "./core/dict.js";

const TABS = [
  { value: "overview", label: "Обзор" },
  { value: "students", label: "Ученики" },
  { value: "calendar", label: "Кален." },
  { value: "homeworks", label: "ДЗ" },
  { value: "finances", label: "Фин." },
];

function placeholderScreen(title) {
  return () => ({
    mount(container) {
      container.append(EmptyState({
        title,
        description: "Экран появится в следующей волне. Сейчас собран фундамент: токены, ядро и примитивы.",
        action: el("a", { class: "btn btn--second", href: "./kit.html", text: "Открыть витрину" }),
      }));
    },
  });
}

function boot() {
  const root = document.getElementById("root");
  if (!root) return;

  globalThis.Telegram?.WebApp?.ready?.();
  globalThis.Telegram?.WebApp?.expand?.();

  const screen = el("main", { class: "screen", id: "screen" });
  const tabbarHost = el("div", { id: "tabbar-host" });

  const router = createRouter({
    container: screen,
    onChange: (id) => {
      setState({ activeTab: id });
      renderTabs();
    },
  });

  for (const tab of TABS) router.register(tab.value, placeholderScreen(tab.label));

  function renderTabs() {
    tabbarHost.replaceChildren(TabBar({
      items: TABS,
      value: getState().activeTab,
      onSelect: (value) => router.go(value),
    }));
  }

  root.replaceChildren(
    Header({
      subtitle: "фундамент v2",
      actions: [Button({ label: "Витрина", kind: "second", onClick: () => { location.href = "./kit.html"; } })],
    }),
    screen,
    tabbarHost,
  );

  router.go("overview");

  // Полезно при отладке в WebView: ядро доступно из консоли.
  globalThis.botai = { router, format, dict, subscribe, getState };
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
