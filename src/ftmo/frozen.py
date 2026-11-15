"""Execute the archived feature/signal expressions, never the optimization grids."""
import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "reference"


def frozen_signal(frames):
    # The live frame provider replaces only the CSV loader. Original expressions stay unchanged.
    source = ROOT / "lab" / "recherche_m15.py"
    nodes = []
    for node in ast.parse(source.read_text(encoding="utf-8")).body:
        if isinstance(node, ast.FunctionDef) and node.name == "simulate":
            break
        if isinstance(node, ast.FunctionDef) and node.name == "load":
            continue
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Name) and node.value.func.id == "print":
            continue
        nodes.append(node)
    env = {"__name__": "ftmo_frozen_signals", "__file__": str(source),
           "load": lambda tf: frames[tf].astype("float32")}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), "exec"), env)
    filters = ROOT / "lab" / "run_filters.py"
    nodes = []
    for node in ast.parse(filters.read_text(encoding="utf-8")).body:
        if isinstance(node, ast.FunctionDef) and node.name == "measure":
            break
        if isinstance(node, ast.ImportFrom) and node.module == "moteur_sortie_M5":
            continue
        nodes.append(node)
    env["__file__"] = str(filters)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(filters), "exec"), env)
    go = env["masked"](("EMA50_200", "M30_CONFIRM"))
    return int(go[-1]), float(env["DIST"][-1]), env["idx"][-1]
