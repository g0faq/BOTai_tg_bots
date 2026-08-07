#!/usr/bin/env python3
"""Сборка v2 в один файл.

Зачем. Edge Amvera обрывает примерно каждый восьмой запрос — это видно
одинаково на всех адресах, включая /healthz и старый фронт. Старому
интерфейсу нужно два запроса, и обрыв там почти незаметен. Новый грузил
около тридцати ES-модулей, и вероятность, что дойдут все, оказывалась
близкой к нулю: пользователь видел пустой экран.

Что делает. Обходит граф импортов от точки входа и склеивает модули в один
файл с крошечным реестром. Сборка запускается вручную и коммитится: в
контейнере Amvera нет node и никакого шага сборки, там лежит уже готовый
файл.

Запуск:  python3 tools/build_v2.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "src" / "tutor_bot" / "web" / "v2"
ENTRY = "app.js"
OUT_JS = ROOT / "bundle.js"
OUT_CSS = ROOT / "bundle.css"
CSS_PARTS = ["styles/tokens.css", "styles/base.css", "styles/ui.css"]

IMPORT_NAMED = re.compile(r'^\s*import\s+\{([^}]*)\}\s+from\s+["\']([^"\']+)["\'];?\s*$', re.M)
IMPORT_STAR = re.compile(r'^\s*import\s+\*\s+as\s+(\w+)\s+from\s+["\']([^"\']+)["\'];?\s*$', re.M)
IMPORT_BARE = re.compile(r'^\s*import\s+["\']([^"\']+)["\'];?\s*$', re.M)
EXPORT_LIST = re.compile(r'^\s*export\s+\{([^}]*)\};?\s*$', re.M)
EXPORT_DECL = re.compile(r'^(\s*)export\s+(async\s+function|function|const|let|class)\s+(\w+)', re.M)



def _resolve(spec: str, base: str) -> str:
    target = (ROOT / Path(base).parent / spec).resolve()
    return target.relative_to(ROOT.resolve()).as_posix()


def transform(path: str, source: str) -> tuple[str, list[str]]:
    """Модуль → тело функции реестра. Возвращает код и список зависимостей."""
    deps: list[str] = []
    exported: list[str] = []

    def named(match: re.Match) -> str:
        names, spec = match.group(1), match.group(2)
        dep = _resolve(spec, path)
        deps.append(dep)
        binding = ", ".join(
            f"{a.strip()}: {b.strip()}" if " as " in part else part.strip()
            for part in names.split(",")
            if part.strip()
            for a, b in [part.split(" as ") if " as " in part else (part, part)]
        )
        return f'const {{ {binding} }} = __req("{dep}");'

    def star(match: re.Match) -> str:
        alias, spec = match.group(1), match.group(2)
        dep = _resolve(spec, path)
        deps.append(dep)
        return f'const {alias} = __req("{dep}");'

    def bare(match: re.Match) -> str:
        dep = _resolve(match.group(1), path)
        deps.append(dep)
        return f'__req("{dep}");'

    code = IMPORT_NAMED.sub(named, source)
    code = IMPORT_STAR.sub(star, code)
    code = IMPORT_BARE.sub(bare, code)

    def decl(match: re.Match) -> str:
        exported.append(match.group(3))
        return f"{match.group(1)}{match.group(2)} {match.group(3)}"

    code = EXPORT_DECL.sub(decl, code)

    def export_list(match: re.Match) -> str:
        for part in match.group(1).split(","):
            name = part.strip().split(" as ")[-1].strip()
            if name:
                exported.append(name)
        return ""

    code = EXPORT_LIST.sub(export_list, code)

    if "export " in code:
        leftover = [line for line in code.splitlines() if line.lstrip().startswith("export ")]
        raise SystemExit(f"{path}: не разобран экспорт:\n  " + "\n  ".join(leftover))

    assigns = "\n".join(f'  __x.{name} = {name};' for name in dict.fromkeys(exported))
    return code + "\n" + assigns + "\n", deps


def collect(entry: str) -> list[str]:
    order: list[str] = []
    seen: set[str] = set()

    def visit(path: str) -> None:
        if path in seen:
            return
        seen.add(path)
        source = (ROOT / path).read_text(encoding="utf-8")
        _, deps = transform(path, source)
        for dep in deps:
            visit(dep)
        order.append(path)

    visit(entry)
    return order


def build() -> None:
    order = collect(ENTRY)
    chunks = [
        "/* СГЕНЕРИРОВАНО tools/build_v2.py — не редактировать руками.",
        "   Источник: web/v2/**. Пересобрать: python3 tools/build_v2.py */",
        "(() => {",
        '  "use strict";',
        "  const __mods = {}, __cache = {};",
        "  const __def = (id, fn) => { __mods[id] = fn; };",
        "  const __req = (id) => {",
        "    if (__cache[id]) return __cache[id];",
        "    const __x = __cache[id] = {};",
        "    __mods[id](__x, __req);",
        "    return __x;",
        "  };",
    ]
    for path in order:
        code, _ = transform(path, (ROOT / path).read_text(encoding="utf-8"))
        chunks.append(f'  __def("{path}", (__x, __req) => {{')
        chunks.append(code)
        chunks.append("  });")
    chunks.append(f'  __req("{ENTRY}");')
    chunks.append("})();")
    OUT_JS.write_text("\n".join(chunks) + "\n", encoding="utf-8")

    css = ["/* СГЕНЕРИРОВАНО tools/build_v2.py — не редактировать руками. */"]
    for part in CSS_PARTS:
        css.append(f"\n/* --- {part} --- */")
        css.append((ROOT / part).read_text(encoding="utf-8"))
    OUT_CSS.write_text("\n".join(css), encoding="utf-8")

    print(f"модулей: {len(order)}")
    print(f"bundle.js:  {OUT_JS.stat().st_size / 1024:.1f} КБ")
    print(f"bundle.css: {OUT_CSS.stat().st_size / 1024:.1f} КБ")


if __name__ == "__main__":
    sys.exit(build())
