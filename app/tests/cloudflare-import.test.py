"""Local-only tests for the selective Cloudflare importer."""

import contextlib
import csv
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "cloudflare-import.py"
spec = importlib.util.spec_from_file_location("cloudflare_import", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FakeWorker(BaseHTTPRequestHandler):
    requests = []
    occupied = False

    def do_POST(self):
        self.__class__.requests.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
        request = self.__class__.requests[-1]
        if self.path != "/internal" or self.headers.get("Authorization") != "Bearer " + "x" * 32:
            self.send_error(401)
            return
        if request["op"] == "newsletter_state":
            result = {"id": "default", "revision": 0, "draft_id": None,
                      "current_draft": None, "draft_choices": [], "curated_stories": [],
                      "selected_ids": [], "research_reports": [], "wizard_state": None}
        elif request["op"] == "query":
            result = {"rows": [{name: int(self.occupied) for name in module.TABLES if name != "shared_news_selection"}], "changes": 0}
        elif request["op"] == "batch":
            result = [{"rows": [], "changes": 1} for _ in request["statements"]]
        else:
            self.send_error(400)
            return
        body = json.dumps({"ok": True, "result": result}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


class CloudflareImportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        required = ("current-studio-records.csv", "studio-style-packs.csv")
        if not all((module.DEFAULT_SOURCE / name).is_file() for name in required):
            raise unittest.SkipTest("Private source export is unavailable")

    def setUp(self):
        FakeWorker.requests = []
        FakeWorker.occupied = False

    def test_dry_run_includes_only_seven_reusable_records(self):
        statements, counts = module.plan(module.DEFAULT_SOURCE)
        self.assertEqual(len(statements), 7)
        self.assertEqual(counts, {"style_packs": 1, "style_assets": 3,
                                  "writing_examples": 3, "excluded_source_rows": 31})
        self.assertEqual([part["sql"].split("(")[0] for part in statements],
                         ["INSERT INTO studio_style_packs"] + ["INSERT INTO studio_assets"] * 3 +
                         ["INSERT INTO past_newsletters"] * 3)
        self.assertEqual(statements[0]["params"][4], 1)
        for statement in statements[:4]:
            self.assertTrue(any(isinstance(value, str) and value.startswith("{") for value in statement["params"]))
        output = io.StringIO()
        with contextlib.redirect_stdout(output), patch.dict(os.environ, {}, clear=True):
            module.run([])
        self.assertIn("dry-run style_packs=1 style_assets=3 writing_examples=3", output.getvalue())

    def test_pack_anchor_mismatch_fails_before_network(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            for name in ("current-studio-records.csv", "studio-style-packs.csv"):
                shutil.copyfile(module.DEFAULT_SOURCE / name, source / name)
            path = source / "current-studio-records.csv"
            with path.open(encoding="utf-8-sig", newline="") as handle:
                rows = list(csv.DictReader(handle))
            pack = next(row for row in rows if row["table_name"] == "studio_style_packs")
            value = json.loads(pack["payload"])
            value["payload"]["anchorIds"] = []
            pack["payload"] = json.dumps(value)
            with path.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=["table_name", "payload"])
                writer.writeheader()
                writer.writerows(rows)
            with self.assertRaises(module.ImportFailure):
                module.plan(source)

    def test_apply_requires_empty_target_and_sends_one_atomic_batch(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), FakeWorker)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            env = {"L8R_DATA_URL": f"http://127.0.0.1:{server.server_port}/internal",
                   "L8R_DATA_SECRET": "x" * 32}
            with patch.dict(os.environ, env), contextlib.redirect_stdout(io.StringIO()):
                module.run(["--apply"])
            self.assertEqual([item["op"] for item in FakeWorker.requests], ["newsletter_state", "query", "batch"])
            batch = FakeWorker.requests[-1]["statements"]
            self.assertEqual(len(batch), 9)
            self.assertTrue(all(len(item["params"]) <= 100 for item in batch))
            self.assertTrue(batch[-1]["sql"].startswith("INSERT INTO past_newsletters"))
            FakeWorker.requests = []
            FakeWorker.occupied = True
            with patch.dict(os.environ, env), self.assertRaises(module.ImportFailure):
                module.run(["--apply"])
            self.assertEqual([item["op"] for item in FakeWorker.requests], ["newsletter_state", "query"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


class CloudflareImportParserTests(unittest.TestCase):
    def test_rejects_invalid_json_without_private_export(self):
        with self.assertRaises(module.ImportFailure):
            module.decode('{"value": NaN}')
        with self.assertRaises(module.ImportFailure):
            module.decode('[]')

    def test_csv_header_validation_without_private_export(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "synthetic.csv"
            source.write_text("column\nvalue\n", encoding="utf-8")
            self.assertEqual(module.read_csv(source, ("column",)), [{"column": "value"}])
            with self.assertRaises(module.ImportFailure):
                module.read_csv(source, ("other",))


if __name__ == "__main__":
    unittest.main()
