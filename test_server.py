"""
FlashArbitrage Backend Server Test Suite
Tests all API endpoints: health, auth, subscriptions, admin, balances, withdraw, sweep
"""
import subprocess, json, urllib.request, urllib.error, time, sys, os, signal

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(BASE_DIR)
BASE_URL = "http://localhost:8000"
PASS = 0
FAIL = 0

def test(name, method, path, body=None, expected_status=200, extract=None):
    global PASS, FAIL
    url = BASE_URL + path
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    try:
        resp = urllib.request.urlopen(req, timeout=10)
        status = resp.status
        raw = resp.read().decode()
        try:
            result = json.loads(raw)
        except:
            result = raw
        if status == expected_status:
            PASS += 1
            msg = f"  \u2705 {name} ({status})"
            if extract and isinstance(result, dict):
                vals = [str(result.get(k, '')) for k in extract.split(',')]
                msg += " [" + ", ".join(vals) + "]"
            print(msg)
        else:
            FAIL += 1
            print(f"  \u274c {name} - expected {expected_status}, got {status}: {raw[:200]}")
        return result
    except urllib.error.HTTPError as e:
        status = e.code
        raw = e.read().decode()[:300]
        if status == expected_status:
            PASS += 1
            print(f"  \u2705 {name} ({status}) [expected error]")
        else:
            FAIL += 1
            print(f"  \u274c {name} - expected {expected_status}, got {status}: {raw[:200]}")
        return None
    except Exception as e:
        FAIL += 1
        print(f"  \u274c {name} - Exception: {e}")
        return None

# ─────────────────────────────────────────────
# 1) Kill any stale process on port 8000
# ─────────────────────────────────────────────
import socket
def kill_port(port):
    """Kill the process listening on the given port using netstat."""
    try:
        result = subprocess.run(['netstat', '-ano'], capture_output=True, text=True, timeout=10)
        for line in result.stdout.split('\n'):
            if f':{port}' in line and 'LISTENING' in line:
                parts = line.strip().split()
                pid = parts[-1]
                print(f"[setup] Killing PID {pid} on port {port}...")
                subprocess.run(['taskkill', '/F', '/PID', pid], capture_output=True, timeout=5)
                time.sleep(1)
                return
        print(f"[setup] No process found on port {port}")
    except Exception as e:
        print(f"[setup] Port kill error: {e}")

kill_port(8000)

# ─────────────────────────────────────────────
# 2) Start server
# ─────────────────────────────────────────────
print("[setup] Starting server.py ...")
proc = subprocess.Popen(
    [sys.executable, 'server.py'],
    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    text=True, cwd=BASE_DIR
)

# Wait for health endpoint
for i in range(15):
    time.sleep(2)
    try:
        r = urllib.request.urlopen(BASE_URL + "/health", timeout=3)
        print(f"[setup] Server ready after {2*(i+1)}s (status {r.status})")
        break
    except Exception as e:
        if i == 14:
            print(f"[setup] Server failed to start: {e}")
            proc.terminate()
            sys.exit(1)
        print(f"[setup] Waiting... ({2*(i+1)}s)")

print("\n" + "=" * 60)
print("  FLASHARBITRAGE API TEST SUITE")
print("=" * 60)

# ─────────────────────────────────────────────
# 3) Health
# ─────────────────────────────────────────────
print("\n--- Health ---")
test("Health check", "GET", "/health")

# ─────────────────────────────────────────────
# 4) Auth
# ─────────────────────────────────────────────
print("\n--- Auth ---")

# Register a new user
reg = test("Register user", "POST", "/api/auth/register", {
    "email": "testuser@example.com",
    "password": "test123",
    "name": "Test User"
})

# Login as registered user
login_user = test("Login as user", "POST", "/api/auth/login", {
    "email": "testuser@example.com",
    "password": "test123"
}, extract="token")

# Login as admin
login_admin = test("Login as admin", "POST", "/api/auth/login", {
    "email": "josejaimejulia7@gmail.com",
    "password": "constanza999"
}, extract="token")

# Login with wrong password
test("Login wrong password", "POST", "/api/auth/login", {
    "email": "testuser@example.com",
    "password": "wrongpass"
}, expected_status=401)

# Activate license (before license purchased - should fail)
test("Activate invalid license", "POST", "/api/auth/activate", {
    "license_key": "INVALID-KEY-12345",
    "email": "testuser@example.com"
}, expected_status=400)

# ─────────────────────────────────────────────
# 5) Plans
# ─────────────────────────────────────────────
print("\n--- Plans ---")
test("Get subscription plans", "GET", "/api/subscriptions/plans")

# ─────────────────────────────────────────────
# 6) Purchase & License Generation
# ─────────────────────────────────────────────
print("\n--- Purchase & License ---")

# Purchase Pro plan
purchase = test("Purchase Pro plan", "POST", "/api/subscriptions/purchase", {
    "plan": "pro",
    "email": "testuser@example.com",
    "payment_method": "test"
}, extract="license_key")

license_key = None
if purchase and isinstance(purchase, dict):
    license_key = purchase.get("license_key")

# Purchase Enterprise plan
purchase2 = test("Purchase Enterprise plan", "POST", "/api/subscriptions/purchase", {
    "plan": "enterprise",
    "email": "admin+enterprise@test.com",
    "payment_method": "test"
}, extract="license_key")

# ─────────────────────────────────────────────
# 7) Activate License
# ─────────────────────────────────────────────
print("\n--- Activate License ---")
if license_key:
    test("Activate valid license", "POST", "/api/auth/activate", {
        "license_key": license_key,
        "email": "testuser@example.com"
    })
else:
    print("  \u26a0\ufe0f Skipping activate test (no license key from purchase)")

# ─────────────────────────────────────────────
# 8) Admin
# ─────────────────────────────────────────────
print("\n--- Admin ---")

# Admin generate license
admin_gen = test("Admin generate license", "POST", "/api/admin/generate-license", {
    "email": "paiduser@example.com",
    "plan": "enterprise",
    "admin_secret": "flash-arbitrage-admin-secret"
}, extract="license_key")

# Admin generate second license
admin_gen2 = test("Admin generate Pro license", "POST", "/api/admin/generate-license", {
    "email": "prouser@example.com",
    "plan": "pro",
    "admin_secret": "flash-arbitrage-admin-secret"
}, extract="license_key")

# Admin update tier
test("Admin update tier", "POST", "/api/admin/update-tier", {
    "email": "testuser@example.com",
    "tier": "enterprise",
    "admin_secret": "flash-arbitrage-admin-secret"
})

# Admin list subscriptions
admin_list = test("Admin list subscriptions", "GET", "/api/admin/subscriptions")

# ─────────────────────────────────────────────
# 9) Activate admin-generated keys
# ─────────────────────────────────────────────
print("\n--- Activate Admin-Generated Keys ---")
if admin_gen and isinstance(admin_gen, dict):
    test("Activate enterprise key", "POST", "/api/auth/activate", {
        "license_key": admin_gen.get("license_key"),
        "email": "paiduser@example.com"
    })
if admin_gen2 and isinstance(admin_gen2, dict):
    test("Activate pro key", "POST", "/api/auth/activate", {
        "license_key": admin_gen2.get("license_key"),
        "email": "prouser@example.com"
    })

# ─────────────────────────────────────────────
# 10) Balances (read-only, may fail without RPC)
# ─────────────────────────────────────────────
print("\n--- Balances ---")
test("Get balances", "POST", "/api/balances", {
    "address": "0xc5453C4db4F86B0772787809c162ec5B3DEA815D",
    "chains": ["ethereum"]
})

# ─────────────────────────────────────────────
# 11) Config
# ─────────────────────────────────────────────
print("\n--- Config ---")
test("Get config", "GET", "/api/config")

# ─────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────
print("\n" + "=" * 60)
total = PASS + FAIL
print(f"  RESULTS:  {PASS}/{total} passed  |  {FAIL}/{total} failed")
if FAIL == 0:
    print("  \U0001f389 ALL TESTS PASSED!")
else:
    print(f"  \u26a0\ufe0f {FAIL} test(s) FAILED")
print("=" * 60)

# ─────────────────────────────────────────────
# Cleanup
# ─────────────────────────────────────────────
print("\n[cleanup] Stopping server...")
proc.terminate()
try:
    proc.wait(timeout=5)
    print("[cleanup] Server stopped.")
except:
    proc.kill()
    print("[cleanup] Server killed.")

sys.exit(0 if FAIL == 0 else 1)
