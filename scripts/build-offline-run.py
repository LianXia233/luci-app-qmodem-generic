#!/usr/bin/env python3
"""Build an iStore-compatible offline .run from local APK or IPK files."""

import argparse
import base64
import hashlib
import io
from pathlib import Path
import re
import tarfile


def build(output: Path, packages: list[Path]) -> None:
    names = [package.name for package in packages]
    formats = {package.suffix for package in packages}
    if len(formats) != 1 or not formats <= {".apk", ".ipk"}:
        raise ValueError("必须使用同一种格式的 APK 或 IPK，不能混装")
    package_format = next(iter(formats))[1:]
    if package_format == "apk":
        main_pattern = r"luci-app-qmodem-generic-[\w.+~\-]+\.apk"
        package_pattern = r"luci-(?:app|i18n)-qmodem-generic-[\w.+~\-]+\.apk"
    else:
        main_pattern = r"luci-app-qmodem-generic_[\w.+~\-]+_all\.ipk"
        package_pattern = r"luci-(?:app-qmodem-generic|i18n-qmodem-generic-[a-z0-9\-]+)_[\w.+~\-]+_all\.ipk"
    if len(names) != len(set(names)):
        raise ValueError("安装包文件名重复")
    if sum(bool(re.fullmatch(main_pattern, name)) for name in names) != 1:
        raise ValueError("必须包含且仅包含一个 luci-app-qmodem-generic 主包")
    archive = io.BytesIO()
    with tarfile.open(fileobj=archive, mode="w:gz", format=tarfile.USTAR_FORMAT) as bundle:
        for package in packages:
            if not re.fullmatch(package_pattern, package.name):
                raise ValueError(f"不支持的文件：{package.name}")
            data = package.read_bytes()
            if not data:
                raise ValueError(f"安装包为空：{package.name}")
            entry = tarfile.TarInfo(package.name)
            entry.size = len(data)
            entry.mode = 0o644
            bundle.addfile(entry, io.BytesIO(data))
    payload = archive.getvalue()
    template = Path(__file__).with_name("offline-install.sh.in").read_text(encoding="utf-8")
    script = template.replace("@PAYLOAD_SHA256@", hashlib.sha256(payload).hexdigest())
    script = script.replace("@PACKAGE_FORMAT@", package_format)
    script = script.replace("@PAYLOAD@", base64.encodebytes(payload).decode("ascii").rstrip())
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(script, encoding="utf-8")
    output.chmod(0o755)
    print(f"离线安装包：{output.name}（包含 {len(packages)} 个 {package_format.upper()}）")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("packages", nargs="+", type=Path)
    args = parser.parse_args()
    try:
        build(args.output, args.packages)
    except (OSError, ValueError) as error:
        parser.exit(1, f"生成失败：{error}\n")


if __name__ == "__main__":
    main()
