"""Inspect existing evidence only: no strategy import, extraction or replay."""
import csv
import hashlib
import io
import json
import os
import sys
import zipfile
from pathlib import Path

FTMO = Path(__file__).resolve().parents[1] / "ftmo"
ARCHIVE_NAME = "TradeBot_FTMO_20K_EUR_Backtest_PAPER_2025_2026.zip"


def inspect_evidence(root, report_path, archived_report_bytes=None):
    reference = root / "reference"
    archive_path = reference / ARCHIVE_NAME
    result = {"historicalIntegrity": "UNVERIFIABLE", "verificationEvidence": "BLOCKED",
              "files": [], "errors": [], "verificationErrors": [], "ordersSent": False,
              "replaysRun": False, "authorizationToStart": False,
              "scope": "Egalite avec l'archive locale, pas une attestation externe de provenance. Le hash historique ne couvre pas toutes les protections actuelles."}
    expected = {}
    counts = {}
    try:
        archive_bytes = archive_path.read_bytes()
        result["archiveSha256"] = hashlib.sha256(archive_bytes).hexdigest()
        with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
            for year in (2025, 2026):
                for tp in ("2p5", "5"):
                    label = f"ftmo_20k_{year}_tp{tp}"
                    for suffix in (".json", "_trades.csv"):
                        name = f"resultats/{label}{suffix}"
                        if archive.namelist().count(name) != 1:
                            raise ValueError("Entree absente ou ambigue dans l'archive : " + name)
                        original = archive.read(name)
                        local = (reference / name).read_bytes()
                        equal = local == original
                        result["files"].append({"path": name, "sha256": hashlib.sha256(local).hexdigest(), "matchesArchive": equal})
                        if not equal:
                            raise ValueError("Resultat local different de l'archive : " + name)
                        if suffix == ".json":
                            expected[(year, 2.5 if tp == "2p5" else 5.0)] = json.loads(local.decode("utf-8-sig"))["summary"]
                        else:
                            counts[(year, 2.5 if tp == "2p5" else 5.0)] = sum(1 for _ in csv.DictReader(io.StringIO(local.decode("utf-8-sig"))))
        for key, summary in expected.items():
            if summary["year"] != key[0] or summary["tpR"] != key[1] or summary["spread"] != .3 or summary["phases_reset"] is not True or summary["trades"] != counts[key]:
                raise ValueError("Resume/transactions/parametres incoherents : " + str(key))
        result["historicalIntegrity"] = "MATCHES_LOCAL_ARCHIVE"
        # Exactly the legacy service's byte ordering; never import verify.py.
        digest = hashlib.sha256()
        for path in (root / "core.py", root / "frozen.py", root / "verify.py", root.parent / "mt5_bridge" / "ftmo_service.py"):
            digest.update(path.read_bytes())
        digest.update(archive_bytes)
        result["currentLegacyImplementationHash"] = digest.hexdigest()
    except (OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile) as error:
        result["errors"].append(str(error))
        return result

    try:
        report_bytes = report_path.read_bytes() if archived_report_bytes is None else archived_report_bytes
        report = json.loads(report_bytes.decode("utf-8-sig"))
        result["reportSha256"] = hashlib.sha256(report_bytes).hexdigest()
        result["existingStatus"] = report.get("status")
        if report.get("format") == "tradebot-external-backup-verification":
            raise ValueError("Attestation de sauvegarde externe, pas verification du moteur. VERIFIED ne signifie pas PASSED; aucune preuve de reproduction ou de controle MT5 supposee.")
        if report.get("status") != "PASSED" or report.get("unitPassed") is not True or type(report.get("unitTests")) is not int or report["unitTests"] < 12:
            raise ValueError("Rapport absent de succes prouve : status/unitPassed/unitTests invalides.")
        if report.get("implementationHash") != result["currentLegacyImplementationHash"] or report.get("archiveSha256") != result["archiveSha256"]:
            raise ValueError("Empreinte implementation/archive absente ou obsolete.")
        replays = report.get("replays")
        if not isinstance(replays, list) or len(replays) != 4:
            raise ValueError("Preuves des quatre replays historiques absentes/incompletes (aucun replay lance).")
        seen = set()
        for replay in replays:
            key = (replay["year"], replay["tpR"])
            if key not in expected or key in seen or replay.get("passed") is not True or replay.get("errors") != []:
                raise ValueError("Preuve replay invalide ou dupliquee.")
            seen.add(key)
            for field in ("trades", "net", "phase1_end", "phase2_end", "FTMO_equity_fail"):
                if replay["summary"][field] != expected[key][field]:
                    raise ValueError("Resume du rapport different de l'archive : " + field)
        signals = report.get("signalChecks")
        if not isinstance(signals, list) or not signals or any(check.get("passed") is not True for check in signals):
            raise ValueError("Preuves de correspondance des signaux absentes ou en echec.")
        result["verificationEvidence"] = "CORROBORATED_LEGACY_REPORT"
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        result["verificationErrors"].append(str(error))
    return result


def inspect_available_evidence(root, report_path):
    result = inspect_evidence(root, report_path)
    result["engineReportExists"] = report_path.is_file()
    result["archivedReports"] = []
    result["archiveSearchErrors"] = []
    reference = root / "reference"

    def inspect_candidate(source, content):
        if len(content) > 2_000_000:
            raise ValueError("Rapport archive trop volumineux : " + source)
        checked = inspect_evidence(root, report_path, content)
        result["archivedReports"].append({"source": source, "reportSha256": checked.get("reportSha256"),
                                          "verificationEvidence": checked["verificationEvidence"],
                                          "errors": checked["errors"] + checked["verificationErrors"]})

    try:
        paths = set(reference.rglob("verification*.json")) | set(root.glob("verification*.json")) | set(report_path.parent.glob("verification*.json"))
        for path in sorted(paths):
            if path.resolve() == report_path.resolve():
                continue
            if path.stat().st_size > 2_000_000:
                raise ValueError("Rapport archive trop volumineux : " + str(path))
            inspect_candidate(str(path), path.read_bytes())
        archive_path = reference / ARCHIVE_NAME
        with zipfile.ZipFile(archive_path) as archive:
            for entry in archive.infolist():
                name = Path(entry.filename).name
                if not entry.is_dir() and name.startswith("verification") and name.endswith(".json"):
                    if entry.file_size > 2_000_000:
                        raise ValueError("Rapport ZIP trop volumineux : " + entry.filename)
                    inspect_candidate("ZIP:" + entry.filename, archive.read(entry))
    except (OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile) as error:
        result["archiveSearchErrors"].append(str(error))
    result["reportRestored"] = False
    result["notRunExplanation"] = ("Rapport moteur present; lire ses preuves et son statut." if result["engineReportExists"] else
                                   "verification.json absent. Les resumes et transactions ne prouvent pas l'execution des controles du moteur. Aucun PASSED genere. Les candidats archives restent diagnostiques, sans restauration automatique ni autorisation START.")
    return result


if __name__ == "__main__":
    directory = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "TradeBotIA" / "ftmo20k"
    # Emit JSON only; never modify verification.json or the challenge ledger.
    json.dump(inspect_available_evidence(FTMO, directory / "verification.json"), sys.stdout, ensure_ascii=True)
