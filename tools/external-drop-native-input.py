"""Explicitly consented desktop automation. Never a synthetic DOM drop.
Call only from the isolated harness. --help does not open windows or inject input.
Uses Shell.Application for exact folder identity and MSAA for the selected file
rectangle; inability to obtain either is NEEDS_HUMAN, never guessed coordinates.
"""
import argparse, ctypes, json, os, pathlib, subprocess, sys, time
from urllib.parse import unquote, urlparse
from ctypes import wintypes


def main():
    diagnostic_root = None
    if len(sys.argv) == 3 and sys.argv[1] == '--diagnose-own-consent':
        diagnostic_root = pathlib.Path(sys.argv[2]).resolve()
        prior = json.loads((diagnostic_root / 'native-input-report.json').read_text(encoding='utf8'))
        manifest = json.loads((diagnostic_root / 'native-input-consent.json').read_text(encoding='utf8'))
        if prior.get('newExplorerHwndVerified') is not True or not prior.get('explorerHwnd') or not prior.get('explorerPid'):
            raise RuntimeError('Prior verified owned HWND/PID missing; no discovery or input allowed')
        sys.argv = [sys.argv[0], '--consent-physical-input', '--root', str(diagnostic_root), '--source', manifest['source'],
                    '--target-hwnd', str(manifest['targetHwnd']), '--target-pid', str(manifest['targetPid']),
                    '--target-client-x', '0', '--target-client-y', '0', '--report', str(diagnostic_root / 'native-accessibility-diagnostic.json')]
    p = argparse.ArgumentParser(description=__doc__ + '\nRead-only diagnostic: --diagnose-own-consent ROOT (requires prior verified Explorer HWND/PID).')
    p.add_argument('--consent-physical-input', action='store_true')
    p.add_argument('--root', required=True)
    p.add_argument('--source', required=True)
    p.add_argument('--target-hwnd', type=int, required=True)
    p.add_argument('--target-pid', type=int, required=True)
    p.add_argument('--target-client-x', type=int, required=True)
    p.add_argument('--target-client-y', type=int, required=True)
    p.add_argument('--report', required=True)
    p.add_argument('--close-owned-explorer', action='store_true')
    args = p.parse_args()
    if not args.consent_physical_input:
        p.error('Explicit physical-input consent is required')
    import pythoncom, win32com.client, win32gui, win32process, win32con
    u = ctypes.WinDLL('user32', use_last_error=True)
    # Physical pixels on mixed-DPI desktops, not the caller process virtualization.
    try:
        u.SetProcessDpiAwarenessContext.argtypes = [ctypes.c_void_p]
        u.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    except AttributeError:
        u.SetProcessDPIAware()
    root, source, report_path = map(lambda x: pathlib.Path(x).resolve(), (args.root, args.source, args.report))
    def owned(f):
        return f.is_relative_to(root) and f != root
    if not owned(source) or not owned(report_path) or not source.is_file() or not (root / 'native-input-consent.json').is_file():
        raise RuntimeError('Refuse non-owned fixture/report or absent consent manifest')
    consent = json.loads((root / 'native-input-consent.json').read_text(encoding='utf8'))
    if consent.get('targetPid') != args.target_pid or consent.get('targetHwnd') != args.target_hwnd or consent.get('source') != str(source):
        raise RuntimeError('Consent manifest identity mismatch')
    sources = [pathlib.Path(x).resolve() for x in consent.get('sources', [str(source)])]
    max_sources = 21 if consent.get('purpose') == 'native-overcount-rejection' and consent.get('expectedCount') == 21 else 20
    if not sources or sources[0] != source or len(sources) > max_sources or len(set(sources)) != len(sources) or any(not owned(x) or not x.is_file() or x.parent != source.parent for x in sources):
        raise RuntimeError('Batch sources must be unique owned files in the exact source folder')
    result = {'status': 'NEEDS_HUMAN', 'mechanism': 'Explorer Shell file selection + MSAA rectangle + Win32 SendInput OLE drag', 'targetPid': args.target_pid, 'targetHwnd': args.target_hwnd, 'events': []}
    pressed = False
    explorer = None
    started = time.monotonic()
    def deadline():
        if (root / 'stop-input').exists() or time.monotonic() - started > 35:
            raise RuntimeError('Desktop phase deadline exceeded')
    def target_check():
        h = args.target_hwnd
        if not win32gui.IsWindow(h) or not win32gui.IsWindowVisible(h) or win32process.GetWindowThreadProcessId(h)[1] != args.target_pid:
            raise RuntimeError('Target window identity invalid')
        if win32gui.IsIconic(h):
            raise RuntimeError('Target window minimized')
    ULONG_PTR = ctypes.c_size_t
    class MI(ctypes.Structure):
        _fields_ = [('dx', wintypes.LONG), ('dy', wintypes.LONG), ('mouseData', wintypes.DWORD), ('dwFlags', wintypes.DWORD), ('time', wintypes.DWORD), ('dwExtraInfo', ULONG_PTR)]
    class KI(ctypes.Structure):
        _fields_ = [('wVk', wintypes.WORD), ('wScan', wintypes.WORD), ('dwFlags', wintypes.DWORD), ('time', wintypes.DWORD), ('dwExtraInfo', ULONG_PTR)]
    class U(ctypes.Union):
        _fields_ = [('mi', MI), ('ki', KI)]
    class INPUT(ctypes.Structure):
        _anonymous_ = ('data',)
        _fields_ = [('type', wintypes.DWORD), ('data', U)]
    u.SendInput.argtypes = [wintypes.UINT, ctypes.POINTER(INPUT), ctypes.c_int]
    u.SendInput.restype = wintypes.UINT
    def mouse(flags, x=0, y=0):
        a = INPUT(type=0, mi=MI(x, y, 0, flags, 0, 0))
        if u.SendInput(1, ctypes.byref(a), ctypes.sizeof(a)) != 1:
            raise RuntimeError('SendInput failed: ' + str(ctypes.get_last_error()))
    def move(x, y):
        vx, vy, vw, vh = [u.GetSystemMetrics(i) for i in (76, 77, 78, 79)]
        if not (vx <= x < vx + vw and vy <= y < vy + vh):
            raise RuntimeError('Pointer outside virtual desktop')
        mouse(0x0001 | 0x8000 | 0x4000, round((x-vx)*65535/(vw-1)), round((y-vy)*65535/(vh-1)))
    def top_at(x, y):
        return win32gui.GetAncestor(win32gui.WindowFromPoint((x, y)), 2)
    native_accessibles = {}
    native_refs = []
    native_objects = []
    def wrap_native(ptr):
        obj = win32com.client.Dispatch(pythoncom.ObjectFromAddress(ptr, pythoncom.IID_IDispatch))
        import uuid
        iid = (ctypes.c_ubyte * 16).from_buffer_copy(uuid.UUID('618736e0-3c3d-11cf-810c-00aa00389b71').bytes_le)
        table = ctypes.cast(ptr, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
        out = ctypes.c_void_p()
        query = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p))(table[0])
        hr = query(ptr, ctypes.byref(iid), ctypes.byref(out))
        if hr == 0 and out.value:
            native_accessibles[id(obj)] = out.value
            native_refs.append(out.value)
        native_refs.append(ptr)
        native_objects.append(obj)
        return obj
    def release_native_refs():
        for ptr in native_refs:
            table = ctypes.cast(ptr, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
            ctypes.WINFUNCTYPE(ctypes.c_ulong, ctypes.c_void_p)(table[2])(ptr)
        native_refs.clear()
    class VARIANT(ctypes.Structure):
        _fields_ = [('vt', ctypes.c_ushort), ('r1', ctypes.c_ushort), ('r2', ctypes.c_ushort), ('r3', ctypes.c_ushort), ('value', ctypes.c_uint64), ('extra', ctypes.c_uint64)]
    def accessible(hwnd):
        # Obtain IDispatch of IAccessible without running any downloaded package.
        class GUID(ctypes.Structure):
            _fields_ = [('a', ctypes.c_uint32), ('b', ctypes.c_uint16), ('c', ctypes.c_uint16), ('d', ctypes.c_ubyte*8)]
        iid = GUID(0x618736e0, 0x3c3d, 0x11cf, (ctypes.c_ubyte*8)(0x81,0x0c,0,0xaa,0,0x38,0x9b,0x71))
        ptr = ctypes.c_void_p()
        fn = ctypes.OleDLL('oleacc').AccessibleObjectFromWindow
        fn.argtypes = [wintypes.HWND, wintypes.DWORD, ctypes.POINTER(GUID), ctypes.POINTER(ctypes.c_void_p)]
        hr = fn(hwnd, 0xfffffffc, ctypes.byref(iid), ctypes.byref(ptr))
        if hr != 0 or not ptr.value:
            raise RuntimeError('MSAA client unavailable')
        return wrap_native(ptr.value)
    def find_selected_rect(hwnd):
        names = {source.name, source.stem}
        found = []
        visited = 0
        diag = {'visited': 0, 'nameMatches': 0, 'selectedMatches': 0, 'errors': [], 'rectangles': [], 'ownChildWindows': 0}
        result['accessibility'] = diag
        def note(operation, error):
            if len(diag['errors']) < 20:
                diag['errors'].append({'operation': operation, 'type': type(error).__name__, 'hresult': getattr(error, 'hresult', None), 'scode': error.excepinfo[5] if getattr(error, 'excepinfo', None) else None, 'argerror': getattr(error, 'argerror', None)})
        def get(a, dispid, *params):
            if params:
                return a._oleobj_.InvokeTypes(dispid, 0, pythoncom.DISPATCH_PROPERTYGET, (pythoncom.VT_VARIANT, 0), ((pythoncom.VT_VARIANT, 1),), win32com.client.VARIANT(pythoncom.VT_I4, params[0]))
            return a._oleobj_.Invoke(dispid, 0, pythoncom.DISPATCH_PROPERTYGET, True)
        def walk(a, depth=0):
            nonlocal visited
            visited += 1
            diag['visited'] = visited
            if visited > 2500 or depth > 30:
                raise RuntimeError('MSAA traversal budget')
            deadline()
            try:
                count = int(get(a, -5001))
            except Exception as error:
                note('childCount', error)
                return
            try:
                selection = get(a, -5012)
                if selection is not None and not isinstance(selection, (int, str, tuple, list)):
                    walk(win32com.client.Dispatch(selection), depth+1)
            except RuntimeError:
                raise
            except Exception:
                pass
            child_ids = [0]
            native = native_accessibles.get(id(a))
            if native and count:
                count = min(count, 1500)
                values = (VARIANT * count)()
                obtained = ctypes.c_long()
                enum = ctypes.OleDLL('oleacc').AccessibleChildren
                enum.argtypes = [ctypes.c_void_p, ctypes.c_long, ctypes.c_long, ctypes.POINTER(VARIANT), ctypes.POINTER(ctypes.c_long)]
                hr = enum(native, 0, count, values, ctypes.byref(obtained))
                if hr not in (0, 1):
                    raise RuntimeError('AccessibleChildren HRESULT ' + str(hr))
                for v in values[:obtained.value]:
                    if v.vt == pythoncom.VT_I4:
                        child_ids.append(ctypes.c_int32(v.value & 0xffffffff).value)
                    elif v.vt == pythoncom.VT_DISPATCH and v.value:
                        walk(wrap_native(v.value), depth+1)
            else:
                child_ids.extend(range(1, min(count, 1500)+1))
            for child in child_ids:
                operation = 'name'
                try:
                    name = str(get(a, -5003, child) or '')
                    if name in names:
                        diag['nameMatches'] += 1
                        operation = 'state'
                        state = int(get(a, -5007, child))
                        if state & 2:  # STATE_SYSTEM_SELECTED
                            diag['selectedMatches'] += 1
                            operation = 'location'
                            rect = a._oleobj_.InvokeTypes(-5015, 0, pythoncom.DISPATCH_METHOD,
                                (pythoncom.VT_VOID, 0),
                                ((pythoncom.VT_I4 | pythoncom.VT_BYREF, 2),)*4 + ((pythoncom.VT_VARIANT, 1),),
                                None, None, None, None, child)
                            if len(rect) == 4 and rect[2] > 0 and rect[3] > 0:
                                found.append(tuple(map(int, rect)))
                except Exception as error:
                    note(operation, error)
                if child:
                    try:
                        obj = get(a, -5002, child)
                        if obj is not None and not isinstance(obj, int):
                            walk(win32com.client.Dispatch(obj), depth+1)
                    except RuntimeError:
                        raise
                    except Exception:
                        pass
        walk(accessible(hwnd))
        if not found:
            own_pid = win32process.GetWindowThreadProcessId(hwnd)[1]
            children = []
            def collect(ch, _):
                if len(children) < 128 and win32process.GetWindowThreadProcessId(ch)[1] == own_pid and win32gui.GetAncestor(ch, 2) == hwnd:
                    children.append(ch)
                return True
            win32gui.EnumChildWindows(hwnd, collect, None)
            diag['ownChildWindows'] = len(children)
            for ch in children:
                deadline()
                try:
                    walk(accessible(ch))
                except RuntimeError:
                    raise
                except Exception as error:
                    note('childWindowClient', error)
        rects = list(set(found))
        diag['rectangles'] = rects[:8]
        if len(rects) != 1:
            raise RuntimeError('Selected fixture MSAA rectangle unavailable/ambiguous; no coordinate guessing')
        return rects[0]
    pythoncom.CoInitialize()
    if diagnostic_root is not None:
        # No Explorer launch, activation, selection, move or input in diagnostic mode.
        try:
            eh = int(prior['explorerHwnd'])
            if not win32gui.IsWindow(eh) or win32process.GetWindowThreadProcessId(eh)[1] != prior['explorerPid']:
                raise RuntimeError('Previously owned window no longer exists with same PID')
            matches = []
            for candidate in win32com.client.Dispatch('Shell.Application').Windows():
                if int(candidate.HWND) == eh:
                    url = urlparse(str(candidate.LocationURL))
                    if pathlib.Path(candidate.Document.Folder.Self.Path).resolve() == source.parent and url.scheme == 'file' and not url.netloc and pathlib.Path(unquote(url.path).lstrip('/')).resolve() == source.parent:
                        matches.append(candidate)
            if len(matches) != 1:
                raise RuntimeError('Owned window folder identity no longer exact')
            selected = matches[0].Document.SelectedItems()
            if selected.Count != len(sources) or {pathlib.Path(selected.Item(i).Path).resolve() for i in range(selected.Count)} != set(sources):
                raise RuntimeError('Selection changed; diagnostics never alter selection')
            result['selectedRect'] = find_selected_rect(eh)
            result['status'] = 'DIAGNOSTIC_OK'
        except Exception as error:
            result['reason'] = type(error).__name__ + ': ' + str(error)[:500]
        finally:
            report_path.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
            release_native_refs()
            native_objects.clear()
            pythoncom.CoUninitialize()
        print(json.dumps({'status':result['status'],'report':str(report_path)},ensure_ascii=False))
        return 0 if result['status'] == 'DIAGNOSTIC_OK' else 3
    try:
        target_check()
        # Do not interfere when a user is holding mouse/modifier keys.
        if any(u.GetAsyncKeyState(k) & 0x8000 for k in (1,2,4,16,17,18,91,92)):
            raise RuntimeError('User input active; refusing desktop automation')
        shell = win32com.client.Dispatch('Shell.Application')
        existing_hwnds = {int(candidate.HWND) for candidate in shell.Windows()}
        result['preexistingExplorerWindowCount'] = len(existing_hwnds)
        # /n requests a new window; verification below, not this flag, grants ownership.
        subprocess.Popen([os.path.join(os.environ['WINDIR'], 'explorer.exe'), '/n,', str(source.parent)], close_fds=True)
        while explorer is None:
            deadline()
            for candidate in shell.Windows():
                try:
                    folder = pathlib.Path(candidate.Document.Folder.Self.Path).resolve()
                    url = urlparse(str(candidate.LocationURL))
                    location = unquote(url.path).lstrip('/')
                    if folder == source.parent and url.scheme == 'file' and not url.netloc and pathlib.Path(location).resolve() == source.parent:
                        explorer = candidate
                        break
                except Exception:
                    continue
            if explorer is None:
                time.sleep(.15)
        eh = int(explorer.HWND)
        if eh in existing_hwnds:
            raise RuntimeError('Explorer reused preexisting window; refusing movement or activation')
        result['newExplorerHwndVerified'] = True
        result['explorerHwnd'] = eh
        result['explorerPid'] = win32process.GetWindowThreadProcessId(eh)[1]
        if win32gui.GetClassName(eh) not in ('CabinetWClass', 'ExploreWClass'):
            raise RuntimeError('Unexpected Explorer window class')
        # Only move the exact UUID folder window. Never touch unrelated Explorer windows.
        target_check()
        tr = win32gui.GetWindowRect(args.target_hwnd)
        screen = (u.GetSystemMetrics(76), u.GetSystemMetrics(77), u.GetSystemMetrics(78), u.GetSystemMetrics(79))
        ex = tr[0] - 620
        if ex < screen[0]:
            ex = tr[2] + 12
        if ex + 600 > screen[0] + screen[2]:
            raise RuntimeError('No non-overlapping Explorer placement; arrange desktop manually')
        win32gui.SetWindowPos(eh, 0, ex, max(screen[1], tr[1]), 600, min(650, screen[3]), 0x0014)
        win32gui.ShowWindow(eh, win32con.SW_RESTORE)
        item = explorer.Document.Folder.ParseName(source.name)
        if item is None or pathlib.Path(item.Path).resolve() != source:
            raise RuntimeError('Shell fixture identity mismatch')
        explorer.Document.SelectItem(item, 1 | 4 | 8 | 16)
        for extra in sources[1:]:
            extra_item = explorer.Document.Folder.ParseName(extra.name)
            if extra_item is None or pathlib.Path(extra_item.Path).resolve() != extra:
                raise RuntimeError('Batch Shell fixture identity mismatch')
            explorer.Document.SelectItem(extra_item, 1)
        result['selectedSourceCount'] = len(sources)
        win32gui.SetForegroundWindow(eh)
        time.sleep(.35)
        if win32gui.GetForegroundWindow() != eh:
            raise RuntimeError('Cannot foreground owned Explorer; ask human')
        selected = explorer.Document.SelectedItems()
        if selected.Count != len(sources) or {pathlib.Path(selected.Item(i).Path).resolve() for i in range(selected.Count)} != set(sources):
            raise RuntimeError('Shell selection is not exclusively the owned fixture')
        x,y,w,h = find_selected_rect(eh)
        # Explorer Details view exposes the entire row, including offscreen columns.
        # Use only the geometrically visible intersection of that actual item and
        # this exact Explorer client; WindowFromPoint below still proves ownership.
        ec = win32gui.GetClientRect(eh)
        ex0,ey0 = win32gui.ClientToScreen(eh,(ec[0],ec[1]))
        ex1,ey1 = win32gui.ClientToScreen(eh,(ec[2],ec[3]))
        left,top,right,bottom = max(x,ex0),max(y,ey0),min(x+w,ex1),min(y+h,ey1)
        if right-left < 4 or bottom-top < 4:
            raise RuntimeError('Selected item has no visible client intersection')
        result['sourceItemRect'] = [x,y,w,h]
        result['sourceVisibleRect'] = [left,top,right,bottom]
        sx,sy = (left+right)//2, (top+bottom)//2
        target_check()
        cx,cy = args.target_client_x,args.target_client_y
        client = win32gui.GetClientRect(args.target_hwnd)
        if not (0 <= cx < client[2] and 0 <= cy < client[3]):
            raise RuntimeError('Target point outside client area')
        tx,ty = win32gui.ClientToScreen(args.target_hwnd,(cx,cy))
        source_top, target_top = top_at(sx,sy), top_at(tx,ty)
        result['preDragOwnership'] = {'sourcePoint': [sx,sy], 'targetPoint': [tx,ty], 'sourceTopHwnd': source_top, 'targetTopHwnd': target_top, 'sourceTopPid': win32process.GetWindowThreadProcessId(source_top)[1] if source_top else None, 'targetTopPid': win32process.GetWindowThreadProcessId(target_top)[1] if target_top else None, 'foregroundHwnd': win32gui.GetForegroundWindow(), 'actualTargetRect': win32gui.GetWindowRect(args.target_hwnd)}
        if source_top != eh or target_top != args.target_hwnd:
            raise RuntimeError('Source or destination occluded; no activation of other windows')
        result.update(explorerHwnd=eh, explorerPid=win32process.GetWindowThreadProcessId(eh)[1], sourcePoint=[sx,sy], targetPoint=[tx,ty], targetRect=tr)
        move(sx,sy)
        deadline()
        if win32gui.GetForegroundWindow() != eh:
            raise RuntimeError('Foreground changed before mouse down')
        mouse(0x0002);pressed=True
        result['events'].append({'kind':'left-down','at':time.time(),'point':[sx,sy]})
        for i in range(1,26):
            deadline();target_check()
            if win32gui.GetForegroundWindow() not in (eh,args.target_hwnd):
                raise RuntimeError('Unexpected foreground during drag')
            if top_at(tx,ty) != args.target_hwnd:
                raise RuntimeError('Destination changed during drag')
            move(round(sx+(tx-sx)*i/25),round(sy+(ty-sy)*i/25));time.sleep(.035)
        time.sleep(.3)
        deadline();target_check()
        if top_at(tx,ty) != args.target_hwnd or win32gui.GetForegroundWindow() not in (eh,args.target_hwnd):
            raise RuntimeError('Destination/foreground changed before release')
        mouse(0x0004);pressed=False
        result['events'].append({'kind':'left-up','at':time.time(),'point':[tx,ty]})
        result['status']='INPUT_SENT'  # Only renderer/main evidence can make a GUI PASS.
    except Exception as e:
        result['reason'] = (type(e).__name__+': '+str(e))[:1500]
    finally:
        if pressed:
            try:
                mouse(0x0004)
                result['events'].append({'kind':'emergency-left-up','at':time.time()})
            except Exception:
                result['releaseFailed']=True
        if args.close_owned_explorer and explorer is not None and result.get('newExplorerHwndVerified'):
            try:
                eh = result['explorerHwnd']
                if win32gui.IsWindow(eh) and win32process.GetWindowThreadProcessId(eh)[1] == result['explorerPid'] and int(explorer.HWND) == eh and pathlib.Path(explorer.Document.Folder.Self.Path).resolve() == source.parent:
                    url = urlparse(str(explorer.LocationURL))
                    if url.scheme == 'file' and not url.netloc and pathlib.Path(unquote(url.path).lstrip('/')).resolve() == source.parent:
                        win32gui.PostMessage(eh, win32con.WM_CLOSE, 0, 0)
                        result['closedOwnNewExplorerWindow'] = True
            except Exception:
                result['closedOwnNewExplorerWindow'] = False
        release_native_refs()
        native_objects.clear()
        pythoncom.CoUninitialize()
        report_path.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({'status':result['status'],'report':str(report_path)},ensure_ascii=False))
    return 0 if result['status']=='INPUT_SENT' else 3

if __name__ == '__main__':
    sys.exit(main())
