"""Single-writer, atomic PAPER checkpoints. No trading or market access."""
import json
import math
import os
from copy import deepcopy
from pathlib import Path


class PaperStorage:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = self.path.with_suffix(".lock").open("a+b")
        try:
            if os.name == "nt":
                import msvcrt
                self.handle.seek(0)
                if not self.handle.read(1):
                    self.handle.write(b"0"); self.handle.flush()
                self.handle.seek(0)
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except Exception:
            self.handle.close()
            raise

    def close(self):
        if self.handle.closed:
            return
        if os.name == "nt":
            import msvcrt
            self.handle.seek(0)
            msvcrt.locking(self.handle.fileno(), msvcrt.LK_UNLCK, 1)
        self.handle.close()

    @staticmethod
    def validate(state):
        if not isinstance(state, dict) or state.get("version") != 1 or state.get("mode") != "PAPER" or state.get("liveEnabled") is not False:
            raise ValueError("Registre incompatible : PAPER / LIVE OFF requis.")
        for key in ("balance", "equity", "dayBase", "peak", "maxDrawdown"):
            value = state.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError("Capital du registre invalide : " + key)
        for key in ("trades", "cashEvents", "curve", "phases", "days", "interruptions"):
            if not isinstance(state.get(key), list):
                raise ValueError("Historique du registre invalide : " + key)
        if "position" not in state or (state["position"] is not None and not isinstance(state["position"], dict)):
            raise ValueError("Position virtuelle invalide.")
        positions = state["trades"] + ([state["position"]] if state["position"] else [])
        keys = set()
        for position in positions:
            key = (position["phase"], position["signalTime"])
            if key in keys:
                raise ValueError("Transaction dupliquee dans le registre.")
            keys.add(key)
        # Reject NaN/Infinity anywhere, including positions and historical events.
        json.dumps(state, allow_nan=False)
        return state

    def load(self, initial):
        try:
            with self.path.open("r", encoding="utf-8") as handle:
                state = json.load(handle)
        except FileNotFoundError:
            # A temporary file without a checkpoint is an interrupted first commit.
            if self.path.with_suffix(".tmp").exists():
                raise ValueError("Premier checkpoint interrompu : restauration manuelle requise.")
            state = initial()
        return deepcopy(self.validate(state))

    def commit(self, state):
        self.validate(state)
        data = json.dumps(state, ensure_ascii=False, allow_nan=False)
        tmp = self.path.with_suffix(".tmp")
        with tmp.open("w", encoding="utf-8") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, self.path)
        # POSIX directory fsync makes the rename durable; Windows uses atomic replace.
        if os.name != "nt":
            fd = os.open(self.path.parent, os.O_RDONLY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
