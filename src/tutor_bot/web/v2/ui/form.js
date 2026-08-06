/* Состояние формы: значения, связывание полей и отправка.
 *
 * Форма ничего не знает про API — submit приходит снаружи. Это позволяет
 * держать все обращения к серверу в core/api.js.
 */
import { el } from "./dom.js";
import { Button } from "./button.js";

export function createForm(initial = {}) {
  const values = { ...initial };
  const errors = {};
  return {
    values,
    get: (name) => values[name],
    set(name, value) { values[name] = value; },
    /** Пропсы для Field/Select: значение + запись обратно. */
    bind(name, { transform } = {}) {
      return {
        value: values[name] ?? "",
        state: errors[name] ? "error" : (values[name] ? "filled" : "empty"),
        hint: errors[name] || "",
        onInput: (v) => { values[name] = transform ? transform(v) : v; },
        onChange: (v) => { values[name] = transform ? transform(v) : v; },
      };
    },
    setError(name, message) { errors[name] = message; },
    clearErrors() { for (const k of Object.keys(errors)) delete errors[k]; },
    /** Только заполненные поля: сервер трактует отсутствие как «не менять». */
    payload(keys) {
      const out = {};
      for (const key of keys ?? Object.keys(values)) {
        const v = values[key];
        if (v === "" || v === undefined || v === null) continue;
        out[key] = v;
      }
      return out;
    },
  };
}

/** Кнопки модалки с индикацией отправки и понятной ошибкой. */
export function FormActions({ submitLabel, onSubmit, onCancel } = {}) {
  const error = el("p", { class: "modal-note form-error", hidden: true });
  const submit = Button({ kind: "main", label: submitLabel, full: true });
  const cancel = Button({ kind: "second", label: "Отмена", full: true, onClick: onCancel });

  submit.addEventListener("click", async () => {
    error.hidden = true;
    submit.disabled = true;
    submit.textContent = "Сохраняю…";
    try {
      await onSubmit();
    } catch (e) {
      error.textContent = e?.detail || e?.message || "Не удалось сохранить";
      error.hidden = false;
      submit.disabled = false;
      submit.textContent = submitLabel;
    }
  });

  return el("div", {}, [error, el("div", { class: "modal-actions" }, [cancel, submit])]);
}
