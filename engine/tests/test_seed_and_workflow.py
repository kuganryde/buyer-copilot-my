import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_seed_sql_in_sync_with_json():
    r = subprocess.run([sys.executable, str(ROOT / "scripts" / "gen_seed.py"), "--check"],
                       capture_output=True, text=True, check=False)
    assert r.returncode == 0, r.stderr


def test_seed_entries_honest_verification_status():
    rows = json.loads((ROOT / "db" / "directory_seed.json").read_text())
    assert len(rows) >= 15
    assert all(r["official_url"].startswith("https://") for r in rows)
    assert any(r["is_proposed_pending_gazette"] for r in rows)
    for r in rows:  # a date may only be set once a human actually verified the source
        assert r["last_verified_date"] is None or re.fullmatch(r"\d{4}-\d{2}-\d{2}", r["last_verified_date"])


def test_n8n_workflow_structure_and_no_embedded_secrets():
    raw = (ROOT / "n8n" / "workflow.json").read_text()
    wf = json.loads(raw)
    names = {n["name"] for n in wf["nodes"]}
    for src, outs in wf["connections"].items():
        assert src in names, src
        for branch in outs["main"]:
            for edge in branch:
                assert edge["node"] in names, edge
    types = {n["type"] for n in wf["nodes"]}
    assert {"n8n-nodes-base.webhook", "n8n-nodes-base.wait", "n8n-nodes-base.postgres",
            "n8n-nodes-base.switch", "n8n-nodes-base.scheduleTrigger"} <= types
    wait = next(n for n in wf["nodes"] if n["type"] == "n8n-nodes-base.wait")
    assert wait["parameters"]["resume"] == "webhook" and wait["parameters"]["incomingAuthentication"] == "headerAuth"
    for n in wf["nodes"]:
        if n["type"] == "n8n-nodes-base.webhook":
            assert n["parameters"].get("authentication") == "headerAuth", n["name"]
        if n["type"] == "n8n-nodes-base.postgres":
            q = n["parameters"].get("query", "")
            assert "{{" not in q, f"{n['name']}: use $1 query parameters, never string interpolation"
    assert not re.search(r"(?i)(password|bearer\s+[a-z0-9]{20,}|secret\s*[:=]\s*['\"][^'\"]{8,})", raw)
    switch = next(n for n in wf["nodes"] if n["type"] == "n8n-nodes-base.switch")
    assert {"APPROVED", "CHANGES_REQUESTED", "REJECTED"} <= set(re.findall(r"[A-Z_]{8,}", json.dumps(switch)))
