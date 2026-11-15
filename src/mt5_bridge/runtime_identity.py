"""Identity of the Python source actually loaded by the local bridge."""
import hashlib
import json
from pathlib import Path

RELEASE = "V92"
ROOT = Path(__file__).resolve().parent
FILES = (ROOT / "bridge.py", ROOT / "ftmo_service.py", ROOT / "paper_trial.py", ROOT / "time_basis.py",
         ROOT / "paper_monitor.py", ROOT / "monitor_metrics.py", ROOT / "monitor_store.py",
         ROOT / "monitor_telegram.py", ROOT / "monitor_routes.py", ROOT / "manual_positions.py",
         ROOT / "paper_time.py", ROOT / "paper_time_config.json", ROOT / "mt5_availability.py",
         ROOT / "server_clock.py", ROOT / "preparation_evidence_v76.py", ROOT / "clock_evidence.py", ROOT / "ipc_diagnostic_v91.py",
         ROOT / "paper_storage.py", ROOT / "quote_time.py", ROOT / "runtime_identity.py", ROOT / "historical_evidence.py",
         ROOT.parent / "ftmo/core.py", ROOT.parent / "ftmo/frozen.py", ROOT.parent / "ftmo/verify.py")


def source_hash():
    digest = hashlib.sha256()
    for path in FILES:
        digest.update(path.name.encode("utf-8"))
        digest.update(path.read_bytes())
    return digest.hexdigest()


if __name__ == "__main__":
    print(json.dumps({"sourceSha256": source_hash()}))
