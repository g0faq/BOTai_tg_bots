from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUNDLE_JS = ROOT / "src" / "tutor_bot" / "web" / "v2" / "bundle.js"
BUNDLE_CSS = ROOT / "src" / "tutor_bot" / "web" / "v2" / "bundle.css"


def test_bundle_is_up_to_date(tmp_path: Path) -> None:
    """Сборка коммитится, а не строится на сервере — значит она может
    отстать от исходников. Тест ловит именно это."""
    before_js = BUNDLE_JS.read_text(encoding="utf-8")
    before_css = BUNDLE_CSS.read_text(encoding="utf-8")

    subprocess.run([sys.executable, str(ROOT / "tools" / "build_v2.py")], check=True, capture_output=True)

    assert BUNDLE_JS.read_text(encoding="utf-8") == before_js, (
        "bundle.js отстал от модулей — запустите python3 tools/build_v2.py"
    )
    assert BUNDLE_CSS.read_text(encoding="utf-8") == before_css, (
        "bundle.css отстал от стилей — запустите python3 tools/build_v2.py"
    )


def test_bundle_has_no_module_syntax() -> None:
    """Файл подключается обычным <script>, модульного синтаксиса быть не должно."""
    source = BUNDLE_JS.read_text(encoding="utf-8")
    offenders = [
        line for line in source.splitlines()
        if line.lstrip().startswith(("import ", "export "))
    ]
    assert not offenders, offenders[:3]
