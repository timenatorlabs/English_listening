"""Run the browser unit tests (tests/index.html) in a headless Microsoft Edge.

Usage (from the project root):
    .venv\\Scripts\\python.exe tools\\run_tests.py

Starts a local web server for the project folder (localhost only), opens the test
page in headless Edge with a throwaway profile, and waits until the page posts its
results back. Exit code 0 = all passed. Nothing is installed; no internet access.
"""
import functools
import json
import shutil
import subprocess
import sys
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EDGE_PATHS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]
TIMEOUT = 180


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        if self.path != "/__results":
            self.send_error(404)
            return
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        self.server.results = json.loads(body.decode("utf-8"))
        self.send_response(204)
        self.end_headers()
        self.server.done.set()


def main() -> int:
    edge = next((p for p in EDGE_PATHS if Path(p).exists()), None)
    if not edge:
        print("Microsoft Edge not found")
        return 2
    server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(ROOT)))
    server.done = threading.Event()
    server.results = None
    threading.Thread(target=server.serve_forever, daemon=True).start()
    profile = tempfile.mkdtemp(prefix="edge-test-")
    url = f"http://127.0.0.1:{server.server_port}/tests/index.html"
    # fake microphone for the recording test; autoplay allowed because test clicks are not
    # real taps (mobile tap/autoplay rules must still be checked on a real phone)
    proc = subprocess.Popen([edge, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
                             "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
                             "--autoplay-policy=no-user-gesture-required", "--mute-audio",
                             f"--user-data-dir={profile}", url],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        finished = server.done.wait(TIMEOUT)
    finally:
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
        server.shutdown()
        shutil.rmtree(profile, ignore_errors=True)

    if not finished:
        print(f"tests did not report within {TIMEOUT}s")
        return 1
    r = server.results
    # Tests named "(network)" depend on outside servers (publishers' audio). Their failures
    # are reported as warnings so an outage elsewhere is not mistaken for a bug in the app.
    warn = [ln for ln in r["lines"] if ln.startswith("FAIL") and "(network)" in ln]
    fail = r["fail"] - len(warn)
    for line in r["lines"]:
        print(("WARN" + line[4:]) if line in warn else line)
    print(f"PASS {r['pass']} FAIL {fail}" + (f" WARN {len(warn)} (outside servers)" if warn else ""))
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
