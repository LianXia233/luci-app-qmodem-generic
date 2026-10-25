#!/usr/bin/env python3
"""Exercise the built self-extracting installer without changing host packages."""

import base64
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[2]


class OfflineInstallTests(unittest.TestCase):
    package_format = "apk"

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="qm offline test ")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.tools = self.root / "bin"
        self.tools.mkdir()
        self.scratch = self.root / "tmp"
        self.scratch.mkdir()
        self.log = self.root / "apk-log.jsonl"
        self.env = dict(os.environ, PATH=str(self.tools) + os.pathsep + os.environ["PATH"],
                        TMPDIR=str(self.scratch), QM_TEST_LOG=str(self.log))
        self.write_tool("id", "#!/bin/sh\nprintf '0\\n'\n")
        self.write_tool("apk", """#!/usr/bin/env python3
import base64, json, os, sys
from pathlib import Path
args = sys.argv[1:]
record = {'args': args, 'tool': 'apk'}
if 'add' in args:
    record['packages'] = {Path(p).name: base64.b64encode(Path(p).read_bytes()).decode()
                          for p in args if p.endswith('.apk')}
with open(os.environ['QM_TEST_LOG'], 'a') as log:
    log.write(json.dumps(record) + '\\n')
if 'info' in args and args[-1] == os.environ.get('QM_TEST_MISSING'):
    sys.exit(1)
sys.exit(int(os.environ.get('QM_TEST_ADD_STATUS', 0)) if 'add' in args else 0)
""")
        self.write_tool("opkg", """#!/usr/bin/env python3
import base64, json, os, sys
from pathlib import Path
args = sys.argv[1:]
record = {'args': args, 'tool': 'opkg'}
if 'install' in args:
    record['packages'] = {Path(p).name: base64.b64encode(Path(p).read_bytes()).decode()
                          for p in args if p.endswith('.ipk')}
    conf_dir = os.environ.get('OPKG_CONF_DIR', '')
    record['isolated'] = bool(conf_dir) and Path(conf_dir).is_dir() and not list(Path(conf_dir).glob('*.conf'))
with open(os.environ['QM_TEST_LOG'], 'a') as log:
    log.write(json.dumps(record) + '\\n')
if args[0] == 'status':
    if args[-1] == os.environ.get('QM_TEST_MISSING'):
        print('Status: deinstall ok not-installed')
    else:
        print('Status: install ok installed')
sys.exit(int(os.environ.get('QM_TEST_ADD_STATUS', 0)) if 'install' in args else 0)
""")
        apk_packages = {
            "luci-app-qmodem-generic-2.5.0-r23.apk": b"test apk\x00\xff\n",
            "luci-i18n-qmodem-generic-zh-cn-2.5.0-r23.apk": b"translation payload\x00",
        }
        ipk_packages = {
            "luci-app-qmodem-generic_2.5.0-r25_all.ipk": b"test ipk\x00\xff\n",
            "luci-i18n-qmodem-generic-zh-cn_git-26.291.12345-abcd123_all.ipk": b"translation payload\x00",
        }
        self.packages = ipk_packages if self.package_format == "ipk" else apk_packages
        for name, data in self.packages.items():
            (self.root / name).write_bytes(data)
        self.installer = self.root / "QModem offline.run"
        self.build = [sys.executable, str(REPO / "scripts/build-offline-run.py"), str(self.installer)]
        subprocess.run(self.build + [str(self.root / name) for name in self.packages], check=True,
                       stdout=subprocess.DEVNULL)

    def write_tool(self, name, source):
        target = self.tools / name
        target.write_text(source)
        target.chmod(0o755)

    def install(self, **env):
        result = subprocess.run(["sh", str(self.installer)], env=dict(self.env, **env),
                                text=True, capture_output=True, timeout=15)
        self.calls = [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []
        for call in self.calls:
            self.assertEqual(call["tool"], self.package_format.replace("ipk", "opkg"))
            if call["tool"] == "apk":
                self.assertEqual(call["args"][:3], ["--no-network", "--repositories-file", "/dev/null"])
            elif "install" in call["args"]:
                self.assertEqual(call["args"][:3], ["--conf", "/dev/null", "install"])
                self.assertTrue(call["isolated"], "opkg 必须同时隔离额外配置目录")
        self.assertEqual(list(self.scratch.iterdir()), [], "临时文件必须在成功/失败后清理")
        return result

    def test_installs_main_and_translation_without_sources(self):
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stderr)
        additions = [call for call in self.calls if "packages" in call]
        self.assertEqual(len(additions), 1)
        self.assertEqual({name: base64.b64decode(data) for name, data in additions[0]["packages"].items()},
                         self.packages, "嵌入的每个安装包必须原样安装")
        self.assertIn("安装完成", result.stdout)

    def test_missing_dependency_stops_before_install(self):
        result = self.install(QM_TEST_MISSING="qmodem")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("缺少已安装依赖：qmodem", result.stderr)
        self.assertFalse(any("packages" in call for call in self.calls))

    def test_corrupt_payload_stops_before_install(self):
        source = self.installer.read_text()
        source = re.sub(r"[a-f0-9]{64}", "0" * 64, source, count=1)
        self.installer.write_text(source)
        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("安装包校验失败", result.stderr)
        self.assertFalse(any("packages" in call for call in self.calls))

    def test_apk_failure_is_not_reported_as_success(self):
        result = self.install(QM_TEST_ADD_STATUS="17")
        self.assertEqual(result.returncode, 17)
        self.assertNotIn("安装完成", result.stdout)

    def test_builder_rejects_missing_main_and_unrelated_packages(self):
        extra = self.root / ("unrelated." + self.package_format)
        extra.write_bytes(b"not a QModem package")
        for names in [[str(extra)], [str(self.root / next(iter(self.packages))), str(extra)]]:
            result = subprocess.run(self.build + names, text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0)

    def test_builder_rejects_mixed_formats_and_duplicate_main(self):
        other_name = ("luci-app-qmodem-generic_2.5.0-r25_all.ipk" if self.package_format == "apk"
                      else "luci-app-qmodem-generic-2.5.0-r25.apk")
        other = self.root / other_name
        other.write_bytes(b"opposite format")
        main = self.root / next(iter(self.packages))
        for packages in [[str(main), str(other)], [str(main), str(main)]]:
            result = subprocess.run(self.build + packages, text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0)

    def test_missing_package_manager_stops_before_install(self):
        manager = "opkg" if self.package_format == "ipk" else "apk"
        (self.tools / manager).unlink()
        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("需要使用", result.stderr)
        self.assertFalse(self.calls)

    def test_postinst_reloads_rpcd_and_preserves_user_data(self):
        source = (REPO / "luci-app-qmodem-generic/Makefile").read_text()
        script = source.split("define Package/luci-app-qmodem-generic/postinst\n", 1)[1].split("\nendef", 1)[0]
        script = script.replace("$$", "$")
        device = tempfile.TemporaryDirectory(prefix="qm-device-")
        self.addCleanup(device.cleanup)
        stage = Path(device.name)
        for directory in ["etc/init.d", "tmp/luci-modulecache", "etc/qmodem-stats"]:
            (stage / directory).mkdir(parents=True, exist_ok=True)
        for name in ["rpcd", "qmodem-stats-collect", "qmodem-modem-support"]:
            service = stage / "etc/init.d" / name
            service.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$0.log"\n')
            service.chmod(0o755)
        cache = stage / "tmp/luci-indexcache.test"
        cache.touch()
        user_data = stage / "etc/qmodem-stats/existing.json"
        user_data.write_text('{"total":123}')
        # Execute the actual package hook with absolute paths redirected into the fixture.
        script = re.sub(r"/(?:usr|etc|tmp)(?=/)", lambda match: str(stage) + match.group(), script)
        result = subprocess.run(["sh", "-c", script], env=dict(self.env, IPKG_INSTROOT=""),
                                text=True, capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((stage / "etc/init.d/rpcd.log").read_text(), "reload\n")
        self.assertFalse(cache.exists())
        self.assertFalse((stage / "tmp/luci-modulecache").exists())
        self.assertEqual(user_data.read_text(), '{"total":123}')
        # Image assembly must not run host services or initialization.
        (stage / "etc/init.d/rpcd.log").unlink()
        subprocess.run(["sh", "-c", script], env=dict(self.env, IPKG_INSTROOT="/image-root"), check=True)
        self.assertFalse((stage / "etc/init.d/rpcd.log").exists())


class IpkOfflineInstallTests(OfflineInstallTests):
    package_format = "ipk"


if __name__ == "__main__":
    unittest.main()
