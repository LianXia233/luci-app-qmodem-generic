#!/usr/bin/env python3
"""Exercise the real task runner against the legacy QModem stdin failure.

The reduced RPC fixture preserves the two reads in FUjr/QModem
2e4c1c80a6d95a525168b888be0c1857e4bd1453:
application/qmodem/files/usr/libexec/rpcd/qmodem (call / delete_sms).
The official Lua SMS controller instead invokes modem_ctrl.sh with argv.
Only external modem/ubus operations are stubbed; task dispatch, validation,
timeouts, results and locks use the installed package sources.
"""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


PACKAGE = Path(__file__).resolve().parents[1]
TASK = PACKAGE / "root/usr/bin/qmodem-task"
BROKEN_RPCD = """#!/bin/sh
case "$1" in
    call)
        read -r input
        config_section=$(printf '%s' "$input" | jsonfilter -e '@.config_section')
        case "$2" in
            delete_sms)
                read -r input
                index=$(printf '%s' "$input" | jsonfilter -e '@.index')
                if [ -n "$index" ]; then
                    printf '%s\\n' "$index" >> "$SMS_RPC_LOG"
                    printf '%s\\n' '{"result":{"status":"1"}}'
                else
                    printf '%s\\n' '{"result":{}}'
                fi
                ;;
        esac
        ;;
esac
"""


class LegacySmsDeleteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="qmodem-sms-test-")
        self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name)
        self.bin = self.work / "bin"
        self.bin.mkdir()
        self.env = dict(os.environ)
        self.env.update({
            "PATH": str(self.bin) + os.pathsep + self.env["PATH"],
            "QMODEM_LIB_DIR": str(PACKAGE / "root/usr/lib/qmodem"),
            "QMODEM_SBIN_DIR": str(self.bin),
            "QMODEM_CACHE_DIR": str(self.work / "cache"),
            "QMODEM_STATS_DIR": str(self.work / "stats"),
            "QMODEM_OFFICIAL_RPCD": str(self.work / "official-rpcd"),
            "QMODEM_MODEM_CTRL": str(self.work / "modem_ctrl.sh"),
            "SMS_HELPER_LOG": str(self.work / "helper.log"),
            "SMS_RPC_LOG": str(self.work / "rpc.log"),
            "SMS_UBUS_LOG": str(self.work / "ubus.log"),
            "SMS_WORKER_LOG": str(self.work / "worker.log"),
        })
        self.put("official-rpcd", BROKEN_RPCD)
        self.put("bin/jsonfilter", "#!/bin/sh\nexec python3 " +
                 str(PACKAGE / "tests/mocks/jsonfilter.py") + ' "$@"\n')
        self.put("bin/uci", """#!/bin/sh
case "$*" in
    '-q get qmodem.8_1') echo modem-device ;;
    '-q get qmodem.8_1.at_port') echo /dev/ttyMOCK0 ;;
    '-q get qmodem.8_1.state') printf '%s' "${SMS_MODEM_STATE:-enabled}" ;;
    *) exit 1 ;;
esac
""")
        self.put("modem_ctrl.sh", """#!/bin/sh
python3 - "$@" <<'PY'
import json, os, sys
with open(os.environ['SMS_HELPER_LOG'], 'a') as log:
    log.write(json.dumps(sys.argv[1:]) + '\\n')
print(json.dumps({'result': {'status': os.environ.get('SMS_DELETE_STATUS', '1')}}))
PY
exit "${SMS_HELPER_EXIT:-0}"
""")
        self.put("bin/ubus", """#!/bin/sh
[ "$1" != -t ] || shift 2
[ "$1" = call ] || exit 1
printf '%s|%s\\n' "$2" "$3" >> "$SMS_UBUS_LOG"
if [ "$2" = qmodem ] && [ "$3" = delete_sms ]; then
    printf '%s\\n' "$4" | sh "$QMODEM_OFFICIAL_RPCD" call delete_sms
else
    printf '%s\\n' '{"status":"success"}'
fi
""")
        self.put("bin/qmodem-worker", """#!/bin/sh
printf '%s\\n' "$*" >> "$SMS_WORKER_LOG"
printf '%s\\n' '{}'
""")

    def put(self, name, content):
        path = self.work / name
        path.write_text(content)
        path.chmod(0o755)
        return path

    def run_task(self, index="3 2 1", section="8_1", arg_section=None,
                 obj="qmodem", method="delete_sms"):
        args = {"config_section": section if arg_section is None else arg_section,
                "index": index}
        payload = {"object": obj, "method": method, "args": args}
        subprocess.run(["sh", str(TASK), "_run", "sms-test", "action", section,
                        json.dumps(payload)], env=self.env, check=True,
                       capture_output=True, text=True, timeout=15)
        result = json.loads((self.work / "cache/tasks/sms-test.json").read_text())
        self.assertFalse(list((self.work / "cache/locks").iterdir()))
        return result

    def test_official_failure_is_reproduced_then_uses_official_helper(self):
        before = subprocess.run(
            ["sh", self.env["QMODEM_OFFICIAL_RPCD"], "call", "delete_sms"],
            input='{"config_section":"8_1","index":"3 2 1"}\n',
            env=self.env, capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(before.stdout), {"result": {}})
        self.assertFalse((self.work / "rpc.log").exists())
        result = self.run_task()
        self.assertEqual(result["state"], "success")
        self.assertEqual(result["result"], {"result": {"status": "1"}})
        self.assertEqual(json.loads((self.work / "helper.log").read_text()),
                         ["delete_sms", "8_1", "3 2 1"])
        self.assertFalse((self.work / "ubus.log").exists())
        self.assertFalse((self.work / "worker.log").exists())

    def test_zero_is_a_valid_modem_storage_index(self):
        self.assertEqual(self.run_task(index="0")["state"], "success")
        self.assertEqual(json.loads((self.work / "helper.log").read_text())[-1], "0")

    def test_fixed_rpc_keeps_ubus_without_helper(self):
        self.put("official-rpcd", BROKEN_RPCD.replace(
            "                read -r input\n", ""))
        self.assertEqual(self.run_task()["state"], "success")
        self.assertEqual((self.work / "rpc.log").read_text(), "3 2 1\n")
        self.assertFalse((self.work / "helper.log").exists())

    def test_other_objects_keep_their_original_api(self):
        self.assertEqual(self.run_task(obj="qmodem.sms", method="delete")["state"],
                         "success")
        self.assertFalse((self.work / "helper.log").exists())
        self.assertIn("qmodem.sms|delete", (self.work / "ubus.log").read_text())

    def test_missing_helper_fails_without_replaying_the_broken_rpc(self):
        (self.work / "modem_ctrl.sh").unlink()
        result = self.run_task()
        self.assertEqual(result["state"], "failed")
        self.assertIn("helper is missing", result["error"])
        self.assertFalse((self.work / "ubus.log").exists())

    def test_helper_failure_is_not_automatically_retried(self):
        self.env["SMS_HELPER_EXIT"] = "1"
        self.assertEqual(self.run_task()["state"], "failed")
        self.assertEqual(len((self.work / "helper.log").read_text().splitlines()), 1)
        self.assertFalse((self.work / "ubus.log").exists())

    def test_helper_rejection_is_preserved_for_frontend_validation(self):
        self.env["SMS_DELETE_STATUS"] = "0"
        result = self.run_task()
        self.assertEqual(result["result"]["result"]["status"], "0")

    def test_invalid_indexes_never_reach_the_helper(self):
        for index in ["", "-1", "1;reboot", "1\n2", "1  2", " 1", "1 "]:
            with self.subTest(index=index):
                self.assertEqual(self.run_task(index=index)["state"], "failed")
        self.assertFalse((self.work / "helper.log").exists())

    def test_target_must_match_a_live_modem_section(self):
        for kwargs in [{"section": "unknown"}, {"arg_section": "8_2"},
                       {"section": "8_1;reboot"}]:
            with self.subTest(kwargs=kwargs):
                self.assertEqual(self.run_task(**kwargs)["state"], "failed")
        self.env["SMS_MODEM_STATE"] = "disabled"
        self.assertEqual(self.run_task()["state"], "failed")
        self.assertFalse((self.work / "helper.log").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
