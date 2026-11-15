"""Read-only backup of the project, browser export and Windows FTMO registry."""
import hashlib
import json
import os
from pathlib import Path
import tempfile
import uuid
import zipfile
from datetime import datetime, timezone

PROJECT = Path(__file__).resolve().parents[2]
EXCLUDED = {".git", ".dyad", "node_modules", ".venv", ".venv-mt5", "__pycache__", ".output", "dist", ".vite"}


def digest(path):
    sha = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            sha.update(chunk)
    return sha.hexdigest()


def files_under(directory):
    for base, directories, filenames in os.walk(directory, followlinks=False):
        for name in directories + filenames:
            path = Path(base) / name
            if path.is_symlink():
                if name in EXCLUDED:
                    continue
                raise ValueError(f"Lien symbolique non portable : {path}. Sauvegarde complète refusée.")
        directories[:] = sorted(name for name in directories if name not in EXCLUDED)
        for name in sorted(filenames):
            yield Path(base) / name


def validate_browser(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("format") != "tradebot-browser-full" or data.get("version") != 1 or data.get("cloneVerified") is not True:
        raise ValueError("Sélectionnez le nouvel export 'toutes les données du navigateur', pas l'ancien JSON de sauvegarde partielle.")
    expected = {"tradebot-backtest-history", "tradebot-safety-backups"}
    databases = data.get("databases")
    if not isinstance(databases, list) or len(databases) != 2 or {d.get("name") for d in databases} != expected:
        raise ValueError("Inventaire des bases navigateur incomplet.")
    if not isinstance(data.get("storage"), list) or not isinstance(data.get("sessions"), dict):
        raise ValueError("Configurations ou sessions navigateur manquantes.")
    counts = {}
    for database in databases:
        if not isinstance(database.get("exists"), bool) or not isinstance(database.get("stores"), list):
            raise ValueError("Inventaire IndexedDB invalide.")
        for store in database["stores"]:
            if not isinstance(store.get("keys"), list) or not isinstance(store.get("values"), list) or len(store["keys"]) != len(store["values"]):
                raise ValueError("Une table IndexedDB est incomplète.")
            counts[f'{database["name"]}/{store["name"]}'] = len(store["values"])
    return {"exportCreatedAt": data["createdAt"], "origin": data["origin"], "records": counts,
            "storageEntries": len(data["storage"]), "restorationOfBrowserCopyVerifiedAtExport": True,
            "limitations": data.get("limitations", [])}


def validate_ftmo(directory):
    file = directory / "challenge.json"
    if not directory.exists():
        return "DOSSIER_ABSENT_SUR_CE_PC"
    if not file.is_file():
        raise ValueError("Dossier FTMO présent sans challenge.json : sauvegarde complète non certifiable.")
    state = json.loads(file.read_text(encoding="utf-8"))
    if state.get("version") != 1 or state.get("mode") != "PAPER" or state.get("liveEnabled") is not False or state.get("running") is not False:
        raise ValueError("Le registre FTMO doit être PAPER, STOPPED et LIVE désactivé. Aucun état n'a été modifié.")
    return "REGISTRE_PRESENT_PAPER_STOPPED_LIVE_OFF"


def main():
    if os.name != "nt":
        raise ValueError("Cet utilitaire doit être exécuté sur le PC Windows où fonctionne la passerelle FTMO/MT5.")
    from tkinter import Tk, filedialog, messagebox
    root = Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    try:
        if not messagebox.askokcancel("Sauvegarde externe — sans trading", "Exportez d'abord toutes les données du navigateur, bots arrêtés. Ne rafraîchissez pas l'aperçu avant cet export.\n\nFermez ensuite la passerelle locale sans démarrer de simulation. Cette sauvegarde ne ferme aucun trade et n'envoie aucun ordre.\n\nL'archive inclura vos configurations et éventuels fichiers .env : gardez-la privée et hors du projet. Ne partagez que le rapport de vérification."):
            return
        browser_name = filedialog.askopenfilename(title="Choisir TradeBot-navigateur-complet-…json", filetypes=[("Export navigateur JSON", "*.json")])
        if not browser_name:
            return
        browser = Path(browser_name).resolve()
        browser_info = validate_browser(browser)
        local = os.environ.get("LOCALAPPDATA")
        if not local:
            raise ValueError("LOCALAPPDATA absent : impossible d'identifier le registre FTMO Windows.")
        ftmo = Path(local) / "TradeBotIA" / "ftmo20k"
        ftmo_status = validate_ftmo(ftmo)
        chosen = filedialog.askdirectory(title="Choisir un dossier privé EXTERIEUR au projet pour la sauvegarde")
        if not chosen:
            return
        parent = Path(chosen).resolve()
        if parent == PROJECT or PROJECT in parent.parents:
            raise ValueError("Destination à l'intérieur du projet interdite. Choisissez un autre dossier.")
        registry = ftmo.resolve()
        if parent == registry or registry in parent.parents:
            raise ValueError("Destination dans le registre FTMO interdite. Choisissez un dossier indépendant.")
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        destination = parent / f"TradeBotIA-avant-etape-B-{stamp}-{uuid.uuid4().hex[:8]}"
        destination.mkdir(exist_ok=False)
        archive = destination / "TradeBotIA-complet.zip"
        report_file = destination / "verification.json"
        report = {"format": "tradebot-external-backup-verification", "version": 1, "status": "IN_PROGRESS",
                  "createdAt": datetime.now(timezone.utc).isoformat(), "externalToProject": True,
                  "projectPath": str(PROJECT), "archivePath": str(archive), "browser": browser_info,
                  "ftmoRegistry": ftmo_status, "excludedRegenerableOrToolMetadataDirectories": sorted(EXCLUDED),
                  "sourceOrRegistryModified": False, "mt5WindowsConnectionVerified": False,
                  "backtestReproductionVerified": False}
        try:
            sources = [(path, "project/" + path.relative_to(PROJECT).as_posix()) for path in files_under(PROJECT)]
            sources.append((browser, "browser/export-complet.json"))
            if ftmo.exists():
                sources.extend((path, "windows-ftmo20k/" + path.relative_to(ftmo).as_posix()) for path in files_under(ftmo))
            records = []
            with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED) as zipped:
                for path, name in sources:
                    sha = digest(path)
                    size = path.stat().st_size
                    zipped.write(path, name)
                    records.append({"path": name, "size": size, "sha256": sha})
                zipped.writestr("manifest.json", json.dumps({"version": 1, "files": records}, ensure_ascii=False, indent=2))
            with zipfile.ZipFile(archive, "r") as zipped:
                bad = zipped.testzip()
                if bad:
                    raise ValueError(f"Archive corrompue : {bad}")
                if set(zipped.namelist()) != {r["path"] for r in records} | {"manifest.json"}:
                    raise ValueError("Inventaire de l'archive différent de la copie attendue.")
                # Restore only into a new, temporary directory outside the project.
                with tempfile.TemporaryDirectory(prefix="verification-", dir=destination) as copy:
                    copied = Path(copy)
                    zipped.extractall(copied)
                    if json.loads((copied / "manifest.json").read_text(encoding="utf-8"))["files"] != records:
                        raise ValueError("Manifeste de restauration différent.")
                    for record in records:
                        path = copied / record["path"]
                        if path.stat().st_size != record["size"] or digest(path) != record["sha256"]:
                            raise ValueError(f'Restauration différente : {record["path"]}')
                    if validate_browser(copied / "browser/export-complet.json") != browser_info:
                        raise ValueError("Export navigateur différent après restauration.")
                    if ftmo.exists() and validate_ftmo(copied / "windows-ftmo20k") != ftmo_status:
                        raise ValueError("Registre FTMO différent après restauration.")
            # A live file change during backup invalidates certification, not the original.
            for (path, _), record in zip(sources, records):
                if digest(path) != record["sha256"]:
                    raise ValueError(f'Un fichier a changé pendant la sauvegarde : {record["path"]}. Réessayez lorsque les applications sont au repos.')
            if list(files_under(PROJECT)) != [path for path, name in sources if name.startswith("project/")]:
                raise ValueError("L'inventaire du projet a changé pendant la sauvegarde.")
            if ftmo.exists() and list(files_under(ftmo)) != [path for path, name in sources if name.startswith("windows-ftmo20k/")]:
                raise ValueError("L'inventaire FTMO a changé pendant la sauvegarde.")
            report.update(status="VERIFIED", archiveSha256=digest(archive), fileCount=len(records),
                          extractedFilesVerifiedWithSha256=True, verificationFinishedAt=datetime.now(timezone.utc).isoformat())
        except Exception as error:
            report.update(status="FAILED", error=str(error))
            raise
        finally:
            report_file.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        messagebox.showinfo("Sauvegarde externe vérifiée", f"Archive créée et extraite pour contrôle :\n{archive}\n\nChaque fichier a été comparé en SHA-256.\n\nTransmettez uniquement verification.json à Dyad pour débloquer l'étape B. La connexion MT5 et les backtests Windows ne sont PAS validés par cette sauvegarde.")
        print(f"SAUVEGARDE VERIFIEE — rapport : {report_file}")
    finally:
        root.destroy()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"SAUVEGARDE NON CERTIFIEE : {error}")
        raise SystemExit(1)
