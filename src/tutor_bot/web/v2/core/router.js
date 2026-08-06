/* Роутер вкладок.
 *
 * Правило волны: в DOM живёт ТОЛЬКО активная вкладка. В старом мини-аппе все
 * экраны всех ролей отрисовывались сразу и прятались стилями — при сотне
 * учеников это давало заметные тормоза.
 *
 * Экран регистрируется фабрикой, которая возвращает
 * { mount(container), unmount?() }. Роутер гарантирует, что unmount
 * предыдущего экрана вызван до mount следующего.
 */

export function createRouter({ container, onChange } = {}) {
  const screens = new Map();
  let current = null;   // { id, instance }

  function register(id, factory) {
    screens.set(id, factory);
    return api;
  }

  function unmountCurrent() {
    if (!current) return;
    try {
      current.instance?.unmount?.();
    } catch (error) {
      console.error(`unmount ${current.id} failed`, error);
    }
    current = null;
    if (container) container.replaceChildren();
  }

  function go(id, params = {}) {
    if (!screens.has(id)) {
      throw new Error(`Неизвестный экран: ${id}`);
    }
    if (current?.id === id && current.instance?.update) {
      current.instance.update(params);
      onChange?.(id, params);
      return;
    }
    unmountCurrent();
    const factory = screens.get(id);
    const instance = factory(params) || {};
    if (container) instance.mount?.(container, params);
    current = { id, instance };
    onChange?.(id, params);
  }

  const api = {
    register,
    go,
    destroy: unmountCurrent,
    get active() {
      return current?.id ?? null;
    },
    get registered() {
      return [...screens.keys()];
    },
  };

  return api;
}
