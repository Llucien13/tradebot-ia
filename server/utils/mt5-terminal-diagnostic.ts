// Windows process metadata only: no account data, command lines or credentials.
export const MT5_TERMINAL_DIAGNOSTIC = String.raw`
import os, ctypes
from ctypes import wintypes

def running_terminals():
    class ProcessEntry(ctypes.Structure):
        _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD),
            ("th32ProcessID", wintypes.DWORD), ("th32DefaultHeapID", ctypes.c_size_t),
            ("th32ModuleID", wintypes.DWORD), ("cntThreads", wintypes.DWORD),
            ("th32ParentProcessID", wintypes.DWORD), ("pcPriClassBase", wintypes.LONG),
            ("dwFlags", wintypes.DWORD), ("szExeFile", wintypes.WCHAR * 260)]
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    kernel.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(ProcessEntry)]
    kernel.Process32FirstW.restype = wintypes.BOOL
    kernel.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(ProcessEntry)]
    kernel.Process32NextW.restype = wintypes.BOOL
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    kernel.QueryFullProcessImageNameW.restype = wintypes.BOOL
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL
    snapshot = kernel.CreateToolhelp32Snapshot(2, 0)
    if snapshot == ctypes.c_void_p(-1).value:
        return [], False
    terminals = []
    complete = True
    try:
        entry = ProcessEntry()
        entry.dwSize = ctypes.sizeof(entry)
        found = kernel.Process32FirstW(snapshot, ctypes.byref(entry))
        if not found and ctypes.get_last_error() != 18:
            complete = False
        while found:
            if entry.szExeFile.lower() == "terminal64.exe":
                process = kernel.OpenProcess(0x1000, False, entry.th32ProcessID)
                path = None
                if process:
                    try:
                        buffer = ctypes.create_unicode_buffer(32768)
                        size = wintypes.DWORD(len(buffer))
                        if kernel.QueryFullProcessImageNameW(process, 0, buffer, ctypes.byref(size)):
                            path = buffer.value
                    finally:
                        kernel.CloseHandle(process)
                if path:
                    terminals.append({"pid": int(entry.th32ProcessID), "path": path})
                else:
                    complete = False
            found = kernel.Process32NextW(snapshot, ctypes.byref(entry))
        if ctypes.get_last_error() != 18:
            complete = False
    finally:
        kernel.CloseHandle(snapshot)
    return terminals, complete

def normalized_path(path):
    return os.path.normcase(os.path.realpath(path))

def initialization_context(path, terminals, complete):
    target = "Chemin ciblé : " + (path or "détection officielle sans chemin") + ". "
    if terminals:
        target += "Terminaux ouverts lisibles : " + "; ".join(item["path"] + " (PID " + str(item["pid"]) + ")" for item in terminals[:3]) + ". "
    elif complete:
        target += "Aucun processus terminal64.exe ouvert détecté. "
    if not complete:
        target += "Inspection des processus incomplète : certaines instances peuvent être inaccessibles. "
    return target
`;
