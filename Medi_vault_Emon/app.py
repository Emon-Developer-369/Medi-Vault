"""Medi Vault - medical records vault: patients, private documents, roles, audit log. Synthetic data only."""

import os
import re
import sqlite3
import uuid
import secrets
import hashlib
import datetime
import functools
import json
import urllib.parse
import urllib.request
from flask import (
    Flask,
    request,
    session,
    redirect,
    render_template,
    send_from_directory,
    abort,
    g,
    flash,
    url_for,
)
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

BASE = os.path.dirname(os.path.abspath(__file__))


def load_env():
    """Load local environment files without overriding variables set by the shell."""
    for fname in (".env", ".env.development.local"):
        env_path = os.path.join(BASE, fname)
        if not os.path.isfile(env_path):
            continue
        try:
            with open(env_path, "r", encoding="utf-8-sig") as env_file:
                for raw_line in env_file:
                    line = raw_line.strip()
                    if not line or line.startswith("#"):
                        continue
                    if line.startswith("export "):
                        line = line[7:].lstrip()
                    if "=" not in line:
                        continue
                    key, value = line.split("=", 1)
                    key = key.strip()
                    value = value.strip()
                    if not key or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
                        continue
                    # Remove matching quotes; preserve # characters inside quoted values.
                    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                        value = value[1:-1]
                    else:
                        value = value.split(" #", 1)[0].rstrip()
                    os.environ.setdefault(key, value)
        except OSError:
            # A missing/unreadable optional env file should not prevent email/password login.
            continue


load_env()

EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"

UPLOADS = os.environ.get("MEDIVAULT_UPLOADS") or os.path.join(BASE, "private_uploads")
os.makedirs(UPLOADS, exist_ok=True)


def get_db_path():
    path = os.environ.get("MEDIVAULT_DB") or os.path.join(BASE, "medivault.db")
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    return path


app = Flask(__name__)
# Trust one reverse-proxy hop so external URLs (Google OAuth redirect) use the public scheme/host.
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
SECRET_KEY = os.environ.get("SECRET_KEY")
if os.environ.get("RENDER") == "true" and not SECRET_KEY:
    raise RuntimeError("Set SECRET_KEY in the production environment.")
app.secret_key = SECRET_KEY or secrets.token_hex(32)

# Default is SameSite=Lax (PRD). Embedded previews (cross-site iframes) need SameSite=None + Secure.
_cookie_samesite = os.environ.get("MEDIVAULT_COOKIE_SAMESITE", "Lax")
app.config.update(
    MAX_CONTENT_LENGTH=5 * 1024 * 1024,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE=_cookie_samesite,
    SESSION_COOKIE_SECURE=_cookie_samesite == "None",
    PERMANENT_SESSION_LIFETIME=datetime.timedelta(minutes=30),
)

PERMS = {
    "clerk": {"register", "upload", "view"},
    "doctor": {"view", "edit_doc", "upload", "prescribe"},
    "auditor": {"audit", "manage_users"},
    "patient": {"portal"},
}

MAGIC = {
    "pdf": b"%PDF-",
    "png": b"\x89PNG\r\n\x1a\n",
    "jpg": b"\xff\xd8\xff",
    "jpeg": b"\xff\xd8\xff",
}


def now():
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def db():
    if "db" not in g:
        g.db = sqlite3.connect(get_db_path())
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys=ON")
    return g.db


@app.teardown_appcontext
def close_db(_):
    if "db" in g:
        g.db.close()


def generate_temp_password():
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*"
    return "".join(secrets.choice(alphabet) for _ in range(16))


def check_lockout(username):
    uname = (username or "").strip().lower()
    fifteen_mins_ago = (datetime.datetime.now() - datetime.timedelta(minutes=15)).strftime("%Y-%m-%d %H:%M:%S")
    cnt = db().execute(
        "SELECT COUNT(*) AS c FROM login_attempts WHERE username_lower=? AND ts >= ?",
        (uname, fifteen_mins_ago),
    ).fetchone()["c"]
    return cnt >= 5


def record_failed_attempt(username):
    uname = (username or "").strip().lower()
    ip = request.remote_addr or "unknown"
    db().execute(
        "INSERT INTO login_attempts(username_lower, ip, ts) VALUES(?, ?, ?)",
        (uname, ip, now()),
    )
    db().commit()


def init_db(db_path=None):
    target = db_path or get_db_path()
    c = sqlite3.connect(target)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")

    c.executescript(
        """
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        pw_hash TEXT,
        role TEXT,
        status TEXT DEFAULT 'pending',
        requested_role TEXT,
        claimed_mrn TEXT,
        patient_id INTEGER REFERENCES patients(id),
        must_change_password INTEGER DEFAULT 0,
        session_version INTEGER DEFAULT 0,
        created_at TEXT,
        reviewed_by TEXT,
        reviewed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS patients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mrn TEXT UNIQUE,
        name TEXT,
        dob TEXT,
        registered_on TEXT,
        created_by TEXT,
        created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER REFERENCES patients(id),
        title TEXT,
        doc_type TEXT,
        notes TEXT,
        stored_name TEXT,
        original_name TEXT,
        size INTEGER,
        sha256 TEXT,
        version INTEGER DEFAULT 1,
        uploaded_by TEXT,
        created_at TEXT,
        updated_by TEXT,
        updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS document_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        title TEXT,
        doc_type TEXT,
        notes TEXT,
        stored_name TEXT,
        sha256 TEXT,
        changed_by TEXT,
        changed_at TEXT,
        change_type TEXT
    );
    CREATE TABLE IF NOT EXISTS prescriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER REFERENCES patients(id),
        medicine TEXT NOT NULL,
        dosage TEXT NOT NULL,
        frequency TEXT NOT NULL,
        duration TEXT NOT NULL,
        instructions TEXT,
        status TEXT DEFAULT 'active',
        prescribed_by TEXT NOT NULL,
        prescribed_at TEXT NOT NULL,
        stopped_by TEXT,
        stopped_at TEXT,
        stop_reason TEXT
    );
    CREATE TABLE IF NOT EXISTS login_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username_lower TEXT NOT NULL,
        ip TEXT,
        ts TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT,
        user TEXT,
        action TEXT,
        detail TEXT,
        outcome TEXT
    );
    """
    )

    # Safe startup migrations for users table
    user_cols = {col["name"] for col in c.execute("PRAGMA table_info(users)").fetchall()}
    if "status" not in user_cols:
        c.execute("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'pending'")
        c.execute("UPDATE users SET status='approved'")
    if "requested_role" not in user_cols:
        c.execute("ALTER TABLE users ADD COLUMN requested_role TEXT")
    if "claimed_mrn" not in user_cols:
        c.execute("ALTER TABLE users ADD COLUMN claimed_mrn TEXT")
    if "patient_id" not in user_cols:
        c.execute("ALTER TABLE users ADD COLUMN patient_id INTEGER REFERENCES patients(id)")
    if "must_change_password" not in user_cols:
        c.execute("ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0")
    if "session_version" not in user_cols:
        c.execute("ALTER TABLE users ADD COLUMN session_version INTEGER DEFAULT 0")
    if "created_at" not in user_cols:
        c.execute("ALTER TABLE users ADD COLUMN created_at TEXT")
    if "reviewed_by" not in user_cols:
        c.execute("ALTER TABLE users ADD COLUMN reviewed_by TEXT")
    if "reviewed_at" not in user_cols:
        c.execute("ALTER TABLE users ADD COLUMN reviewed_at TEXT")
    if "email" not in user_cols:
        c.execute("ALTER TABLE users ADD COLUMN email TEXT")
    if "full_name" not in user_cols:
        c.execute("ALTER TABLE users ADD COLUMN full_name TEXT")
    if "google_sub" not in user_cols:
        c.execute("ALTER TABLE users ADD COLUMN google_sub TEXT")
    if "password_set" not in user_cols:
        c.execute("ALTER TABLE users ADD COLUMN password_set INTEGER DEFAULT 1")
    c.execute("UPDATE users SET password_set=1 WHERE password_set IS NULL")
    c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(lower(email)) WHERE email IS NOT NULL")
    c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL")

    # Safe migration: link asha to MRN-1001 only if asha has no link yet and MRN-1001 is not linked to another account
    asha_row = c.execute("SELECT id, patient_id FROM users WHERE username='asha'").fetchone()
    if asha_row and not asha_row["patient_id"]:
        p_asha = c.execute("SELECT id FROM patients WHERE mrn='MRN-1001'").fetchone()
        if p_asha:
            p1_linked = c.execute("SELECT id FROM users WHERE patient_id=?", (p_asha["id"],)).fetchone()
            if not p1_linked or p1_linked["id"] == asha_row["id"]:
                c.execute(
                    "UPDATE users SET patient_id=?, role='patient', status='approved' WHERE id=?",
                    (p_asha["id"], asha_row["id"]),
                )

    # Partial unique index for patient accounts
    c.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_patient_id ON users(patient_id) WHERE patient_id IS NOT NULL"
    )

    # Migrate existing users with roles to 'approved'
    c.execute(
        "UPDATE users SET status='approved' WHERE (status IS NULL OR status='' OR status='pending') AND role IS NOT NULL"
    )
    c.execute("UPDATE users SET created_at=? WHERE created_at IS NULL", (now(),))

    patient_cols = {col["name"] for col in c.execute("PRAGMA table_info(patients)").fetchall()}
    if "registered_on" not in patient_cols:
        c.execute("ALTER TABLE patients ADD COLUMN registered_on TEXT")
    c.execute("UPDATE patients SET registered_on=substr(created_at, 1, 10) WHERE registered_on IS NULL")

    doc_cols = {col["name"] for col in c.execute("PRAGMA table_info(documents)").fetchall()}
    if "notes" not in doc_cols:
        c.execute("ALTER TABLE documents ADD COLUMN notes TEXT")
    if "version" not in doc_cols:
        c.execute("ALTER TABLE documents ADD COLUMN version INTEGER DEFAULT 1")
    if "updated_by" not in doc_cols:
        c.execute("ALTER TABLE documents ADD COLUMN updated_by TEXT")
    if "updated_at" not in doc_cols:
        c.execute("ALTER TABLE documents ADD COLUMN updated_at TEXT")
    c.execute("UPDATE documents SET version=1 WHERE version IS NULL")

    # Seed history rows for existing documents if missing
    existing_docs = c.execute("SELECT * FROM documents").fetchall()
    for doc in existing_docs:
        hist_exists = c.execute("SELECT 1 FROM document_history WHERE document_id=?", (doc["id"],)).fetchone()
        if not hist_exists:
            c.execute(
                """
                INSERT INTO document_history(document_id, version, title, doc_type, notes, stored_name, sha256, changed_by, changed_at, change_type)
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
                (
                    doc["id"],
                    doc["version"] or 1,
                    doc["title"],
                    doc["doc_type"],
                    doc["notes"] or "",
                    doc["stored_name"],
                    doc["sha256"],
                    doc["uploaded_by"],
                    doc["created_at"],
                    "created",
                ),
            )

    # Seed staff data if users table is empty
    if not c.execute("SELECT 1 FROM users WHERE role IN ('clerk', 'doctor', 'auditor')").fetchone():
        pw = generate_password_hash(os.environ.get("DEMO_PASSWORD", "Demo@1234"), method="pbkdf2:sha256")
        for u, r in [("clerk", "clerk"), ("doctor", "doctor"), ("auditor", "auditor")]:
            c.execute(
                "INSERT INTO users(username, pw_hash, role, status, must_change_password, session_version, created_at) VALUES(?, ?, ?, 'approved', 0, 0, ?)",
                (u, pw, r, now()),
            )

        for mrn, n, d in [
            ("MRN-1001", "Asha Verma (fake)", "1985-03-14"),
            ("MRN-1002", "Ravi Kumar (fake)", "1990-07-02"),
            ("MRN-1003", "Meena Iyer (fake)", "1978-11-23"),
        ]:
            c.execute(
                "INSERT INTO patients(mrn, name, dob, registered_on, created_by, created_at) VALUES(?, ?, ?, ?, ?, ?)",
                (mrn, n, d, d, "seed", now()),
            )

        pdf = (
            b"%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
            b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 120]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n"
            b"4 0 obj<</Length 60>>stream\nBT /F1 14 Tf 20 60 Td (FAKE lab report - synthetic data) Tj ET\nendstream endobj\n"
            b"5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF"
        )
        name = uuid.uuid4().hex + ".pdf"
        with open(os.path.join(UPLOADS, name), "wb") as f:
            f.write(pdf)
        sha = hashlib.sha256(pdf).hexdigest()
        cur = c.execute(
            """
            INSERT INTO documents(patient_id, title, doc_type, notes, stored_name, original_name, size, sha256, version, uploaded_by, created_at)
            VALUES(1, 'Sample blood test', 'Lab report', 'Baseline blood report on admission', ?, 'sample.pdf', ?, ?, 1, 'seed', ?)
        """,
            (name, len(pdf), sha, now()),
        )
        doc_id = cur.lastrowid
        c.execute(
            """
            INSERT INTO document_history(document_id, version, title, doc_type, notes, stored_name, sha256, changed_by, changed_at, change_type)
            VALUES(?, 1, 'Sample blood test', 'Lab report', 'Baseline blood report on admission', ?, ?, 'seed', ?, 'created')
        """,
            (doc_id, name, sha, now()),
        )

    # Seed demo patient user 'asha' linked to MRN-1001 if no asha account exists
    if not c.execute("SELECT 1 FROM users WHERE username='asha'").fetchone():
        p1 = c.execute("SELECT id FROM patients WHERE mrn='MRN-1001'").fetchone()
        if p1:
            asha_pw = generate_password_hash(os.environ.get("DEMO_PASSWORD", "Demo@1234"), method="pbkdf2:sha256")
            c.execute(
                """
                INSERT OR IGNORE INTO users(username, pw_hash, role, status, patient_id, must_change_password, session_version, created_at)
                VALUES('asha', ?, 'patient', 'approved', ?, 0, 0, ?)
            """,
                (asha_pw, p1["id"], now()),
            )
            # Add seed prescription for MRN-1001
            has_rx = c.execute("SELECT 1 FROM prescriptions WHERE patient_id=?", (p1["id"],)).fetchone()
            if not has_rx:
                c.execute(
                    """
                    INSERT INTO prescriptions(patient_id, medicine, dosage, frequency, duration, instructions, status, prescribed_by, prescribed_at)
                    VALUES(?, 'Paracetamol', '500 mg', 'Twice daily', '5 days', 'after food', 'active', 'doctor', ?)
                """,
                    (p1["id"], now()),
                )

    c.commit()
    c.close()


def log(action, detail="", outcome="ok"):
    db().execute(
        "INSERT INTO audit(ts, user, action, detail, outcome) VALUES(?, ?, ?, ?, ?)",
        (now(), session.get("u", "anonymous"), action, detail, outcome),
    )
    db().commit()


def find_login_user(identifier):
    """Look up an account by username or (case-insensitive) email."""
    ident = (identifier or "").strip()
    if not ident:
        return None
    return db().execute(
        "SELECT * FROM users WHERE username=? OR (email IS NOT NULL AND lower(email)=lower(?))",
        (ident, ident),
    ).fetchone()


def start_session(u):
    session.clear()
    session["u"] = u["username"]
    session["role"] = u["role"]
    session["session_version"] = u["session_version"] or 0
    session.permanent = True


def landing_for(role):
    if role == "patient":
        return "/portal"
    if role == "auditor":
        return "/audit"
    return "/patients"


def unique_username_from_email(email):
    base = re.sub(r"[^a-z0-9_]", "_", email.split("@", 1)[0].lower())[:24].strip("_") or "user"
    if len(base) < 3:
        base = (base + "_user")[:24]
    candidate = base
    n = 1
    while db().execute("SELECT 1 FROM users WHERE username=?", (candidate,)).fetchone():
        n += 1
        candidate = f"{base}_{n}"
    return candidate


def next_free_mrn():
    max_id = db().execute("SELECT COALESCE(MAX(id), 0) AS m FROM patients").fetchone()["m"]
    n = max_id + 1001
    while db().execute("SELECT 1 FROM patients WHERE mrn=?", (f"MRN-{n}",)).fetchone():
        n += 1
    return f"MRN-{n}"


def create_self_service_patient(username, email, full_name, dob, pw_hash, google_sub=None, password_set=1):
    """Instantly create an active patient account with its own new patient record (no auditor approval)."""
    mrn = next_free_mrn()
    ts = now()
    cur = db().execute(
        "INSERT INTO patients(mrn, name, dob, registered_on, created_by, created_at) VALUES(?, ?, ?, ?, ?, ?)",
        (mrn, full_name, dob, datetime.date.today().isoformat(), "self-signup", ts),
    )
    patient_id = cur.lastrowid
    db().execute(
        """
        INSERT INTO users(username, email, full_name, google_sub, pw_hash, role, status, requested_role, patient_id,
                          must_change_password, session_version, password_set, created_at, reviewed_by, reviewed_at)
        VALUES(?, ?, ?, ?, ?, 'patient', 'approved', 'patient', ?, 0, 0, ?, ?, 'self-signup', ?)
        """,
        (username, email, full_name, google_sub, pw_hash, patient_id, password_set, ts, ts),
    )
    db().commit()
    return db().execute("SELECT * FROM users WHERE username=?", (username,)).fetchone(), mrn


def google_configured():
    return bool(os.environ.get("GOOGLE_CLIENT_ID") and os.environ.get("GOOGLE_CLIENT_SECRET"))


def google_redirect_uri():
    return os.environ.get("GOOGLE_REDIRECT_URI") or url_for("google_callback", _external=True)


def http_post_form(url, fields):
    data = urllib.parse.urlencode(fields).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode())


def http_get_json(url, bearer):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {bearer}"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode())


def csrf():
    return session.setdefault("csrf", secrets.token_hex(16))


app.jinja_env.globals["csrf"] = csrf


@app.context_processor
def inject_globals():
    role = session.get("role")
    current_perms = PERMS.get(role, set()) if role else set()
    pending_count = 0
    if "manage_users" in current_perms:
        try:
            row = db().execute("SELECT COUNT(*) AS c FROM users WHERE status='pending'").fetchone()
            if row:
                pending_count = row["c"]
        except Exception:
            pending_count = 0
    return {
        "current_perms": current_perms,
        "pending_users_count": pending_count,
        "today": datetime.date.today().isoformat(),
        "google_enabled": google_configured(),
    }


def need(perm):
    def deco(f):
        @functools.wraps(f)
        def wrapper(*a, **k):
            if "u" not in session:
                return redirect("/login")
            user = db().execute("SELECT * FROM users WHERE username=?", (session["u"],)).fetchone()
            if not user or user["status"] != "approved":
                session.clear()
                flash("Your account is no longer active or your session has expired.", "error")
                return redirect("/login")
            if session.get("session_version", 0) != (user["session_version"] or 0):
                session.clear()
                flash("Your session has ended because you were logged out or credentials changed.", "info")
                return redirect("/login")
            session["role"] = user["role"]
            if perm not in PERMS.get(user["role"], set()):
                log("denied", f"{request.method} {request.path} needs '{perm}'", "denied")
                abort(403)
            return f(*a, **k)

        return wrapper

    return deco


@app.before_request
def refresh_session_and_csrf():
    session.permanent = True
    session.modified = True
    if request.method == "POST":
        token = request.form.get("csrf")
        expected = session.get("csrf")
        if not token or not expected or not secrets.compare_digest(token, expected):
            abort(400)


@app.before_request
def check_forced_password_change():
    if "u" in session:
        # Endpoints allowed without password change
        if request.endpoint in ("account_password", "logout", "static", None):
            return
        user = db().execute("SELECT must_change_password FROM users WHERE username=?", (session["u"],)).fetchone()
        if user and user["must_change_password"] == 1:
            flash("You must set a new password before continuing.", "info")
            return redirect("/account/password")


@app.after_request
def headers(r):
    r.headers["X-Content-Type-Options"] = "nosniff"
    r.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    r.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if request.endpoint == "static":
        r.headers["Cache-Control"] = "public, max-age=3600"
    else:
        r.headers["Cache-Control"] = "no-store"
    return r


@app.errorhandler(400)
def e400(_):
    return (
        render_template(
            "error.html",
            code=400,
            title="Bad Request",
            message="Invalid or missing CSRF security token.",
        ),
        400,
    )


@app.errorhandler(403)
def e403(_):
    return (
        render_template(
            "error.html",
            code=403,
            title="Access Denied",
            message="Your current role does not have permission for this action. This attempt has been logged.",
        ),
        403,
    )


@app.errorhandler(404)
def e404(_):
    return (
        render_template(
            "error.html",
            code=404,
            title="Not Found",
            message="The requested patient record or document was not found.",
        ),
        404,
    )


@app.errorhandler(413)
def e413(_):
    return (
        render_template(
            "error.html",
            code=413,
            title="File Too Large",
            message="The uploaded file exceeds the 5 MB size limit.",
        ),
        413,
    )


@app.route("/")
def home():
    if "u" not in session:
        stats = {
            "patients": db().execute("SELECT COUNT(*) AS c FROM patients").fetchone()["c"],
            "documents": db().execute("SELECT COUNT(*) AS c FROM documents").fetchone()["c"],
            "audit": db().execute("SELECT COUNT(*) AS c FROM audit").fetchone()["c"],
        }
        return render_template("home.html", stats=stats)
    return redirect(landing_for(session.get("role")))


def _signup_error(form, errors):
    return render_template("signup.html", form=form, errors=errors), 422


@app.route("/signup", methods=["GET", "POST"])
def signup():
    if "u" in session:
        return redirect("/")
    if request.method == "POST":
        signup_type = "staff" if request.form.get("signup_type") == "staff" else "patient"
        full_name = request.form.get("full_name", "").strip()
        email = request.form.get("email", "").strip().lower()
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        confirm = request.form.get("confirm_password", "")
        dob_raw = request.form.get("dob", "").strip()
        form = {"signup_type": signup_type, "full_name": full_name, "email": email, "username": username, "dob": dob_raw}
        errors = {}

        if not (2 <= len(full_name) <= 100):
            errors["full_name"] = "Please enter your full name (2-100 characters)."

        if len(email) > 254 or not EMAIL_RE.match(email):
            errors["email"] = "Please enter a valid email address."
        elif db().execute("SELECT 1 FROM users WHERE lower(email)=?", (email,)).fetchone():
            errors["email"] = "An account with this email already exists. Try signing in instead."

        if username:
            if not re.fullmatch(r"[a-z0-9_]{3,30}", username):
                errors["username"] = "Username must be 3-30 lowercase letters, digits, or underscores."
            elif db().execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
                errors["username"] = "This username is already taken."

        if len(password) < 10:
            errors["password"] = "Password must be at least 10 characters long."
        elif password != confirm:
            errors["confirm_password"] = "Passwords do not match."

        if signup_type == "patient":
            try:
                dob_date = datetime.date.fromisoformat(dob_raw)
                if dob_date > datetime.date.today():
                    errors["dob"] = "Date of birth must be today or earlier."
                elif dob_date.year < 1900:
                    errors["dob"] = "Please enter a realistic date of birth."
            except (ValueError, TypeError):
                errors["dob"] = "Please enter your date of birth."

        if errors:
            return _signup_error(form, errors)

        if not username:
            username = unique_username_from_email(email)
        pw_hash = generate_password_hash(password, method="pbkdf2:sha256")

        if signup_type == "patient":
            user, mrn = create_self_service_patient(username, email, full_name, dob_raw, pw_hash)
            start_session(user)
            log("patient_self_signup", f"{username} mrn {mrn}")
            flash(f"Account created! Your Medical Record Number is {mrn}.", "success")
            return redirect("/portal")

        db().execute(
            """
            INSERT INTO users(username, email, full_name, pw_hash, role, status, requested_role, must_change_password,
                              session_version, password_set, created_at)
            VALUES(?, ?, ?, ?, NULL, 'pending', 'staff', 0, 0, 1, ?)
            """,
            (username, email, full_name, pw_hash, now()),
        )
        db().commit()
        log("signup", username)
        flash(
            f"Account requested for '{username}'. An auditor will assign your staff role, then you can sign in.",
            "success",
        )
        return redirect("/login")

    return render_template("signup.html", form={"signup_type": request.args.get("type", "patient")}, errors={})


def _password_login(template, allowed):
    """Shared username/email + password login. `allowed(role)` decides which roles this page accepts."""
    identifier = request.form.get("username", "").strip()
    password = request.form.get("password", "")

    if check_lockout(identifier):
        log("login_locked", identifier[:30], "blocked")
        flash("Too many attempts. Try again later.", "error")
        return render_template(template, form={"username": identifier})

    u = find_login_user(identifier)
    if not u or not check_password_hash(u["pw_hash"] or "", password) or not allowed(u["role"]):
        record_failed_attempt(identifier)
        if check_lockout(identifier):
            log("login_locked", identifier[:30], "blocked")
        log("login_failed", identifier[:30], "failed")
        flash("Wrong username or password", "error")
        return render_template(template, form={"username": identifier})

    status = u["status"]
    if status != "approved":
        log("login_blocked", u["username"][:30], "blocked")
        if status == "pending":
            flash("Your account is pending approval by an auditor.", "info")
        elif status == "declined":
            flash("Your account request has been declined.", "error")
        elif status == "disabled":
            flash("Your account has been disabled.", "error")
        else:
            flash("Wrong username or password", "error")
        return render_template(template, form={"username": identifier})

    start_session(u)
    log("login")

    if u["must_change_password"] == 1:
        flash("Please set a new password before continuing.", "info")
        return redirect("/account/password")

    if u["role"] == "patient":
        flash(f"Welcome to your health portal, {u['full_name'] or u['username']}!", "success")
    else:
        flash(f"Welcome back, {u['username']}!", "success")
    return redirect(landing_for(u["role"]))


@app.route("/login", methods=["GET", "POST"])
def login():
    if "u" in session:
        return redirect("/")
    if request.method == "POST":
        # /login accepts staff roles only (clerk, doctor, auditor) and pending staff requests.
        return _password_login("login.html", lambda role: role != "patient")
    return render_template("login.html", form={})


@app.route("/patient-login", methods=["GET", "POST"])
def patient_login():
    if "u" in session:
        return redirect("/")
    if request.method == "POST":
        # /patient-login accepts ONLY role 'patient'. Staff roles are rejected with a generic message.
        return _password_login("patient_login.html", lambda role: role == "patient")
    return render_template("patient_login.html", form={})


# --- GOOGLE SIGN-IN / SIGN-UP (OAuth 2.0 authorization code flow, stdlib only) ---
@app.route("/auth/google")
def google_start():
    if "u" in session:
        return redirect("/")
    source = request.args.get("from", "patient")
    back = "/login" if source == "staff" else "/patient-login"
    if not google_configured():
        flash(
            "Google sign-in is not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable it, "
            "or use your email instead.",
            "info",
        )
        return redirect("/signup" if source == "signup" else back)
    state = secrets.token_urlsafe(24)
    session["oauth_state"] = state
    session["oauth_back"] = back
    params = {
        "client_id": os.environ["GOOGLE_CLIENT_ID"],
        "redirect_uri": google_redirect_uri(),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "prompt": "select_account",
    }
    return redirect(GOOGLE_AUTH_URL + "?" + urllib.parse.urlencode(params))


@app.route("/auth/google/callback")
def google_callback():
    expected = session.pop("oauth_state", None)
    back = session.pop("oauth_back", "/patient-login")
    state = request.args.get("state", "")
    if not expected or not state or not secrets.compare_digest(state, expected):
        log("google_login_failed", "state mismatch", "failed")
        flash("Google sign-in failed: the request expired or was tampered with. Please try again.", "error")
        return redirect(back)
    if request.args.get("error") or not request.args.get("code"):
        log("google_login_failed", "cancelled", "failed")
        flash("Google sign-in was cancelled.", "info")
        return redirect(back)

    try:
        token = http_post_form(
            GOOGLE_TOKEN_URL,
            {
                "code": request.args["code"],
                "client_id": os.environ.get("GOOGLE_CLIENT_ID", ""),
                "client_secret": os.environ.get("GOOGLE_CLIENT_SECRET", ""),
                "redirect_uri": google_redirect_uri(),
                "grant_type": "authorization_code",
            },
        )
        info = http_get_json(GOOGLE_USERINFO_URL, token["access_token"])
    except Exception:
        log("google_login_failed", "token exchange", "failed")
        flash("Could not complete Google sign-in. Please try again.", "error")
        return redirect(back)

    sub = str(info.get("sub") or "")
    email = (info.get("email") or "").strip().lower()
    if not sub or not email or not info.get("email_verified"):
        log("google_login_failed", "unverified email", "failed")
        flash("Your Google account email must be verified to sign in.", "error")
        return redirect(back)

    u = db().execute("SELECT * FROM users WHERE google_sub=?", (sub,)).fetchone()
    if not u:
        u = db().execute("SELECT * FROM users WHERE lower(email)=?", (email,)).fetchone()
        if u and not u["google_sub"]:
            db().execute("UPDATE users SET google_sub=? WHERE id=?", (sub, u["id"]))
            db().commit()

    if u:
        if u["status"] != "approved":
            log("login_blocked", u["username"][:30], "blocked")
            messages = {
                "pending": "Your account is pending approval by an auditor.",
                "declined": "Your account request has been declined.",
                "disabled": "Your account has been disabled.",
            }
            flash(messages.get(u["status"], "This account is not available."), "error")
            return redirect(back)
        start_session(u)
        log("login", "google")
        flash(f"Welcome back, {u['full_name'] or u['username']}!", "success")
        return redirect(landing_for(u["role"]))

    full_name = (info.get("name") or email.split("@", 1)[0])[:100]
    username = unique_username_from_email(email)
    unusable_pw = generate_password_hash(secrets.token_urlsafe(32), method="pbkdf2:sha256")
    user, mrn = create_self_service_patient(username, email, full_name, None, unusable_pw, google_sub=sub, password_set=0)
    start_session(user)
    log("patient_self_signup", f"{username} mrn {mrn} via google")
    flash(f"Welcome! Your account is ready. Your Medical Record Number is {mrn}.", "success")
    return redirect("/portal/profile")


@app.route("/account/password", methods=["GET", "POST"])
def account_password():
    if "u" not in session:
        return redirect("/login")
    user = db().execute("SELECT * FROM users WHERE username=?", (session["u"],)).fetchone()
    if not user:
        session.clear()
        return redirect("/login")

    must_change = (user["must_change_password"] == 1)
    # Accounts created through Google have no usable password yet, so they can set one without the current one.
    has_password = (user["password_set"] if user["password_set"] is not None else 1) == 1

    if request.method == "POST":
        current_pw = request.form.get("current_password", "")
        new_pw = request.form.get("new_password", "")
        confirm_pw = request.form.get("confirm_password", "")
        errors = {}

        if has_password and not check_password_hash(user["pw_hash"], current_pw):
            errors["current_password"] = "Incorrect current password."

        if len(new_pw) < 10:
            errors["new_password"] = "New password must be at least 10 characters long."
        elif new_pw == current_pw:
            errors["new_password"] = "New password must differ from current password."
        elif new_pw != confirm_pw:
            errors["confirm_password"] = "Passwords do not match."

        if errors:
            return (
                render_template(
                    "password_change.html", errors=errors, must_change=must_change, has_password=has_password
                ),
                422,
            )

        new_hash = generate_password_hash(new_pw, method="pbkdf2:sha256")
        new_version = (user["session_version"] or 0) + 1
        db().execute(
            """
            UPDATE users
            SET pw_hash=?, must_change_password=0, session_version=?, password_set=1
            WHERE id=?
        """,
            (new_hash, new_version, user["id"]),
        )
        db().commit()

        session["session_version"] = new_version
        log("password_changed", session["u"])
        flash("Password updated successfully.", "success")
        return redirect("/" if user["role"] != "patient" else "/portal")

    return render_template("password_change.html", errors={}, must_change=must_change, has_password=has_password)


@app.route("/logout", methods=["POST"])
def logout():
    was_patient = session.get("role") == "patient"
    if "u" in session:
        log("logout")
    session.clear()
    flash("You have been signed out.", "info")
    return redirect("/patient-login" if was_patient else "/login")


@app.route("/patients")
@need("view")
def patients():
    q = request.args.get("q", "").strip()[:50]
    rows = db().execute(
        """
        SELECT p.*, (SELECT COUNT(*) FROM documents d WHERE d.patient_id = p.id) AS doc_count
        FROM patients p WHERE p.name LIKE ? OR p.mrn LIKE ? ORDER BY p.id DESC LIMIT 100
        """,
        (f"%{q}%", f"%{q}%"),
    ).fetchall()
    if q:
        log("search", q)
    today = datetime.date.today().isoformat()
    stats = {
        "patients": db().execute("SELECT COUNT(*) AS c FROM patients").fetchone()["c"],
        "documents": db().execute("SELECT COUNT(*) AS c FROM documents").fetchone()["c"],
        "active_rx": db().execute("SELECT COUNT(*) AS c FROM prescriptions WHERE status='active'").fetchone()["c"],
        "today": db().execute(
            "SELECT COUNT(*) AS c FROM patients WHERE substr(created_at, 1, 10)=?", (today,)
        ).fetchone()["c"],
    }
    return render_template("patients.html", q=q, rows=rows, stats=stats)


@app.route("/patients/new", methods=["GET", "POST"])
@need("register")
def patient_new():
    today = datetime.date.today().isoformat()
    if request.method == "POST":
        name = request.form.get("name", "").strip()
        mrn = request.form.get("mrn", "").strip()
        dob_raw = request.form.get("dob", "").strip()
        reg_raw = request.form.get("registered_on", "").strip() or today
        errors = {}

        if not (1 <= len(name) <= 100):
            errors["name"] = "Full name must be between 1 and 100 characters."

        if not re.fullmatch(r"[A-Za-z0-9-]{3,20}", mrn):
            errors["mrn"] = "MRN must be 3-20 letters, digits, or hyphens."
        else:
            existing = db().execute("SELECT 1 FROM patients WHERE mrn=?", (mrn,)).fetchone()
            if existing:
                errors["mrn"] = "That MRN already exists."

        # Validate date of birth <= today
        try:
            dob_date = datetime.date.fromisoformat(dob_raw)
            if dob_date > datetime.date.today():
                errors["dob"] = "Date of birth must be today or earlier."
        except (ValueError, TypeError):
            errors["dob"] = "Invalid date of birth."

        # Validate registration date >= today (past date rejected!)
        try:
            reg_date = datetime.date.fromisoformat(reg_raw)
            if reg_date < datetime.date.today():
                errors["registered_on"] = "Registration date must be today or a future date."
        except (ValueError, TypeError):
            errors["registered_on"] = "Invalid registration date."

        if errors:
            return (
                render_template(
                    "patient_new.html",
                    form={"name": name, "mrn": mrn, "dob": dob_raw, "registered_on": reg_raw},
                    errors=errors,
                    today=today,
                ),
                422,
            )

        db().execute(
            """
            INSERT INTO patients(mrn, name, dob, registered_on, created_by, created_at)
            VALUES(?, ?, ?, ?, ?, ?)
        """,
            (mrn, name, dob_raw, reg_raw, session["u"], now()),
        )
        db().commit()
        new_p = db().execute("SELECT id FROM patients WHERE mrn=?", (mrn,)).fetchone()
        log("patient_created", mrn)
        flash("Patient registered successfully", "success")
        return redirect(f"/patients/{new_p['id']}")

    return render_template("patient_new.html", form={"registered_on": today}, errors={}, today=today)


@app.route("/patients/<int:pid>")
@need("view")
def patient(pid):
    p = db().execute("SELECT * FROM patients WHERE id=?", (pid,)).fetchone() or abort(404)
    docs = db().execute("SELECT * FROM documents WHERE patient_id=? ORDER BY id DESC", (pid,)).fetchall()
    prescriptions = db().execute(
        "SELECT * FROM prescriptions WHERE patient_id=? ORDER BY id DESC", (pid,)
    ).fetchall()
    log("view_patient", p["mrn"])
    return render_template("patient_detail.html", p=p, docs=docs, prescriptions=prescriptions)


@app.route("/patients/<int:pid>/upload", methods=["POST"])
@need("upload")
def upload(pid):
    p = db().execute("SELECT * FROM patients WHERE id=?", (pid,)).fetchone() or abort(404)
    f = request.files.get("file")
    title = request.form.get("title", "").strip()[:100]
    doc_type = request.form.get("doc_type", "Other")[:30]
    ext = f.filename.rsplit(".", 1)[-1].lower() if f and "." in f.filename else ""
    data = f.read() if f else b""

    if not title or ext not in MAGIC or not data.startswith(MAGIC[ext]):
        log("upload_rejected", f"patient {pid}", "rejected")
        flash("Rejected: only real PDF, PNG or JPG files are allowed", "error")
        return redirect(f"/patients/{pid}")

    stored = uuid.uuid4().hex + "." + ext
    with open(os.path.join(UPLOADS, stored), "wb") as out:
        out.write(data)

    sha = hashlib.sha256(data).hexdigest()
    cur = db().execute(
        """
        INSERT INTO documents(patient_id, title, doc_type, notes, stored_name, original_name, size, sha256, version, uploaded_by, created_at)
        VALUES(?, ?, ?, '', ?, ?, ?, ?, 1, ?, ?)
    """,
        (pid, title, doc_type, stored, secure_filename(f.filename), len(data), sha, session["u"], now()),
    )
    doc_id = cur.lastrowid
    db().execute(
        """
        INSERT INTO document_history(document_id, version, title, doc_type, notes, stored_name, sha256, changed_by, changed_at, change_type)
        VALUES(?, 1, ?, ?, '', ?, ?, ?, ?, 'created')
    """,
        (doc_id, title, doc_type, stored, sha, session["u"], now()),
    )
    db().commit()
    log("upload", f"patient {pid} doc {doc_id}")
    flash("Document uploaded successfully", "success")
    return redirect(f"/patients/{pid}")


@app.route("/documents/<int:did>")
@need("view")
def document(did):
    d = db().execute("SELECT * FROM documents WHERE id=?", (did,)).fetchone() or abort(404)
    log("view_document", f"doc {did} patient {d['patient_id']}")
    return send_from_directory(UPLOADS, d["stored_name"], download_name=d["original_name"])


@app.route("/documents/history/<int:hid>")
@need("view")
def document_history_file(hid):
    h = db().execute("SELECT * FROM document_history WHERE id=?", (hid,)).fetchone() or abort(404)
    log("view_document", f"doc {h['document_id']} v{h['version']} history {hid}")
    download_name = f"v{h['version']}_{h['title']}.pdf" if h["stored_name"].endswith(".pdf") else h["stored_name"]
    return send_from_directory(UPLOADS, h["stored_name"], download_name=download_name)


@app.route("/documents/<int:did>/edit", methods=["GET", "POST"])
@need("edit_doc")
def document_edit(did):
    d = db().execute("SELECT * FROM documents WHERE id=?", (did,)).fetchone() or abort(404)
    p = db().execute("SELECT * FROM patients WHERE id=?", (d["patient_id"],)).fetchone() or abort(404)
    history = db().execute(
        "SELECT * FROM document_history WHERE document_id=? ORDER BY version DESC, id DESC",
        (did,),
    ).fetchall()

    if request.method == "POST":
        title = request.form.get("title", "").strip()[:100]
        doc_type = request.form.get("doc_type", d["doc_type"])[:30]
        notes = request.form.get("notes", "").strip()

        if not title:
            flash("Title is required", "error")
            return render_template("document_edit.html", d=d, patient=p, history=history)

        f = request.files.get("file")
        if f and f.filename:
            ext = f.filename.rsplit(".", 1)[-1].lower() if "." in f.filename else ""
            data = f.read()
            if ext not in MAGIC or not data.startswith(MAGIC[ext]):
                log("upload_rejected", f"patient {d['patient_id']} doc {did}", "rejected")
                flash("Rejected: only real PDF, PNG or JPG files are allowed", "error")
                return render_template("document_edit.html", d=d, patient=p, history=history)

            stored = uuid.uuid4().hex + "." + ext
            with open(os.path.join(UPLOADS, stored), "wb") as out:
                out.write(data)

            new_sha = hashlib.sha256(data).hexdigest()
            new_version = (d["version"] or 1) + 1
            db().execute(
                """
                UPDATE documents
                SET title=?, doc_type=?, notes=?, stored_name=?, original_name=?, size=?, sha256=?, version=?, updated_by=?, updated_at=?
                WHERE id=?
            """,
                (
                    title,
                    doc_type,
                    notes,
                    stored,
                    secure_filename(f.filename),
                    len(data),
                    new_sha,
                    new_version,
                    session["u"],
                    now(),
                    did,
                ),
            )
            db().execute(
                """
                INSERT INTO document_history(document_id, version, title, doc_type, notes, stored_name, sha256, changed_by, changed_at, change_type)
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 'new_version')
            """,
                (did, new_version, title, doc_type, notes, stored, new_sha, session["u"], now()),
            )
            db().commit()
            log("document_version_added", f"doc {did} v{new_version}")
            flash("New document version uploaded successfully", "success")
            return redirect(f"/patients/{d['patient_id']}")
        else:
            cur_version = d["version"] or 1
            db().execute(
                """
                UPDATE documents
                SET title=?, doc_type=?, notes=?, updated_by=?, updated_at=?
                WHERE id=?
            """,
                (title, doc_type, notes, session["u"], now(), did),
            )
            db().execute(
                """
                INSERT INTO document_history(document_id, version, title, doc_type, notes, stored_name, sha256, changed_by, changed_at, change_type)
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 'document_edited')
            """,
                (did, cur_version, title, doc_type, notes, d["stored_name"], d["sha256"], session["u"], now()),
            )
            db().commit()
            log("document_edited", f"doc {did} patient {d['patient_id']}")
            flash("Document metadata updated successfully", "success")
            return redirect(f"/patients/{d['patient_id']}")

    return render_template("document_edit.html", d=d, patient=p, history=history)


# --- FEATURE B: DOCTOR PRESCRIPTIONS ---
@app.route("/patients/<int:pid>/prescriptions/new", methods=["GET", "POST"])
@need("prescribe")
def prescription_new(pid):
    patient = db().execute("SELECT * FROM patients WHERE id=?", (pid,)).fetchone() or abort(404)

    if request.method == "POST":
        medicine = request.form.get("medicine", "").strip()[:100]
        dosage = request.form.get("dosage", "").strip()[:50]
        duration = request.form.get("duration", "").strip()[:50]
        freq_sel = request.form.get("frequency_select", "Once daily")
        freq_other = request.form.get("frequency_other", "").strip()[:50]
        instructions = request.form.get("instructions", "").strip()[:500]

        frequency = freq_other if freq_sel == "Other" and freq_other else freq_sel

        errors = {}
        if not medicine:
            errors["medicine"] = "Medicine name is required (1-100 characters)."
        if not dosage:
            errors["dosage"] = "Dosage is required (1-50 characters)."
        if not duration:
            errors["duration"] = "Duration is required (1-50 characters)."

        if errors:
            form = {
                "medicine": medicine,
                "dosage": dosage,
                "duration": duration,
                "frequency_select": freq_sel,
                "frequency_other": freq_other,
                "instructions": instructions,
            }
            return (
                render_template("prescription_new.html", patient=patient, form=form, errors=errors),
                422,
            )

        cur = db().execute(
            """
            INSERT INTO prescriptions(patient_id, medicine, dosage, frequency, duration, instructions, status, prescribed_by, prescribed_at)
            VALUES(?, ?, ?, ?, ?, ?, 'active', ?, ?)
        """,
            (pid, medicine, dosage, frequency, duration, instructions, session["u"], now()),
        )
        rx_id = cur.lastrowid
        db().commit()

        # Audit: prescription_added with rx_id and patient MRN only (NO medicine names)
        log("prescription_added", f"rx {rx_id} patient {patient['mrn']}")
        flash("Prescription added successfully.", "success")
        return redirect(f"/patients/{pid}")

    return render_template(
        "prescription_new.html",
        patient=patient,
        form={"frequency_select": "Once daily"},
        errors={},
    )


@app.route("/prescriptions/<int:rx_id>/stop", methods=["POST"])
@need("prescribe")
def prescription_stop(rx_id):
    rx = db().execute("SELECT * FROM prescriptions WHERE id=?", (rx_id,)).fetchone() or abort(404)
    if rx["status"] != "active":
        flash("Prescription is already stopped.", "info")
        return redirect(f"/patients/{rx['patient_id']}")

    reason = request.form.get("stop_reason", "").strip()[:200]
    db().execute(
        """
        UPDATE prescriptions
        SET status='stopped', stopped_by=?, stopped_at=?, stop_reason=?
        WHERE id=?
    """,
        (session["u"], now(), reason, rx_id),
    )
    db().commit()

    patient = db().execute("SELECT mrn FROM patients WHERE id=?", (rx["patient_id"],)).fetchone()
    mrn = patient["mrn"] if patient else "unknown"

    # Audit: prescription_stopped with rx id and patient MRN only (NO medicine names)
    log("prescription_stopped", f"rx {rx_id} patient {mrn}")
    flash("Prescription stopped.", "info")
    return redirect(f"/patients/{rx['patient_id']}")


@app.route("/prescriptions/<int:rx_id>/print")
def prescription_print(rx_id):
    if "u" not in session:
        return redirect("/login")
    user = db().execute("SELECT * FROM users WHERE username=?", (session["u"],)).fetchone()
    if not user or user["status"] != "approved":
        session.clear()
        return redirect("/login")

    rx = db().execute("SELECT * FROM prescriptions WHERE id=?", (rx_id,)).fetchone() or abort(404)
    patient = db().execute("SELECT * FROM patients WHERE id=?", (rx["patient_id"],)).fetchone() or abort(404)

    # Allowed for doctor OR the owning patient
    role = user["role"]
    if role == "doctor":
        pass  # authorized
    elif role == "patient" and user["patient_id"] == rx["patient_id"]:
        pass  # authorized
    else:
        log("denied", f"{request.method} {request.path}", "denied")
        abort(403)

    return render_template("prescription_print.html", rx=rx, patient=patient)


# --- FEATURE C: PATIENT PORTAL ---
@app.route("/portal")
@need("portal")
def portal():
    user = db().execute("SELECT * FROM users WHERE username=?", (session["u"],)).fetchone()
    if not user or not user["patient_id"]:
        abort(404)

    patient = db().execute("SELECT * FROM patients WHERE id=?", (user["patient_id"],)).fetchone() or abort(404)

    active_prescriptions = db().execute(
        "SELECT * FROM prescriptions WHERE patient_id=? AND status='active' ORDER BY id DESC",
        (patient["id"],),
    ).fetchall()

    past_prescriptions = db().execute(
        "SELECT * FROM prescriptions WHERE patient_id=? AND status='stopped' ORDER BY id DESC",
        (patient["id"],),
    ).fetchall()

    # Documents query: strictly omit internal doctor notes, version history, or uploader usernames
    documents = db().execute(
        "SELECT id, patient_id, title, doc_type, original_name, created_at FROM documents WHERE patient_id=? ORDER BY id DESC",
        (patient["id"],),
    ).fetchall()

    log("portal_view", patient["mrn"])
    return render_template(
        "portal.html",
        updates=sorted(
            [{"date": d["created_at"], "label": "Document added: " + d["title"], "url": url_for("portal_document", did=d["id"])} for d in documents]
            + [{"date": r["prescribed_at"], "label": "Prescription added: " + r["medicine"], "url": url_for("portal", view="prescriptions")} for r in (*active_prescriptions, *past_prescriptions)],
            key=lambda event: event["date"], reverse=True),
        user=user,
        patient=patient,
        active_prescriptions=active_prescriptions,
        past_prescriptions=past_prescriptions,
        documents=documents,
    )


@app.route("/portal/profile", methods=["GET", "POST"])
@need("portal")
def portal_profile():
    """Self-service patients may complete a missing date of birth; recorded demographics stay staff-managed."""
    user = db().execute("SELECT * FROM users WHERE username=?", (session["u"],)).fetchone()
    if not user or not user["patient_id"]:
        abort(404)
    patient = db().execute("SELECT * FROM patients WHERE id=?", (user["patient_id"],)).fetchone() or abort(404)
    errors = {}
    if request.method == "POST":
        if patient["dob"]:
            flash("Your date of birth is already on file. Ask hospital staff to correct it.", "info")
            return redirect("/portal")
        dob_raw = request.form.get("dob", "").strip()
        try:
            dob_date = datetime.date.fromisoformat(dob_raw)
            if dob_date > datetime.date.today():
                errors["dob"] = "Date of birth must be today or earlier."
            elif dob_date.year < 1900:
                errors["dob"] = "Please enter a realistic date of birth."
        except (ValueError, TypeError):
            errors["dob"] = "Please enter a valid date of birth."
        if not errors:
            db().execute("UPDATE patients SET dob=? WHERE id=?", (dob_raw, patient["id"]))
            db().commit()
            log("patient_profile_updated", patient["mrn"])
            flash("Profile updated.", "success")
            return redirect("/portal")
        return render_template("portal_profile.html", patient=patient, user=user, errors=errors), 422
    return render_template("portal_profile.html", patient=patient, user=user, errors=errors)


@app.route("/portal/documents/<int:did>")
@need("portal")
def portal_document(did):
    user = db().execute("SELECT * FROM users WHERE username=?", (session["u"],)).fetchone()
    if not user or not user["patient_id"]:
        abort(404)

    doc = db().execute("SELECT * FROM documents WHERE id=?", (did,)).fetchone()
    # If not found OR belongs to another patient, return 404 (not 403) to prevent probing
    if not doc or doc["patient_id"] != user["patient_id"]:
        abort(404)

    log("portal_document_view", f"doc {did}")
    return send_from_directory(UPLOADS, doc["stored_name"], download_name=doc["original_name"])


# --- AUDIT LOG ---
@app.route("/audit")
@need("audit")
def audit():
    rows = db().execute("SELECT * FROM audit ORDER BY id DESC LIMIT 200").fetchall()
    outcome_counts = {o: 0 for o in ("ok", "failed", "denied", "rejected", "blocked")}
    for r in rows:
        if r["outcome"] in outcome_counts:
            outcome_counts[r["outcome"]] += 1
    return render_template("audit.html", rows=rows, outcome_counts=outcome_counts)


# --- FEATURE A: AUDITOR USER MANAGEMENT ---
@app.route("/users")
@need("manage_users")
def users_list():
    tab = request.args.get("tab", "pending").lower()
    valid_tabs = ["pending", "active", "declined", "disabled", "deleted"]
    if tab not in valid_tabs:
        tab = "pending"

    counts = {
        "pending": db().execute("SELECT COUNT(*) AS c FROM users WHERE status='pending'").fetchone()["c"],
        "active": db().execute("SELECT COUNT(*) AS c FROM users WHERE status='approved'").fetchone()["c"],
        "declined": db().execute("SELECT COUNT(*) AS c FROM users WHERE status='declined'").fetchone()["c"],
        "disabled": db().execute("SELECT COUNT(*) AS c FROM users WHERE status='disabled'").fetchone()["c"],
        "deleted": db().execute("SELECT COUNT(*) AS c FROM users WHERE status='deleted'").fetchone()["c"],
    }

    status_filter = "approved" if tab == "active" else tab
    users = db().execute(
        """
        SELECT u.*, p.mrn AS patient_mrn
        FROM users u
        LEFT JOIN patients p ON u.patient_id = p.id
        WHERE u.status=?
        ORDER BY u.id DESC
    """,
        (status_filter,),
    ).fetchall()

    # Patients that do not yet have a linked user account
    available_patients = db().execute(
        """
        SELECT p.id, p.mrn FROM patients p
        LEFT JOIN users u ON p.id = u.patient_id
        WHERE u.id IS NULL
        ORDER BY p.mrn
    """
    ).fetchall()

    return render_template(
        "users.html",
        users=users,
        active_tab=tab,
        counts=counts,
        available_patients=available_patients,
    )


@app.route("/users/new", methods=["GET", "POST"])
@need("manage_users")
def user_new():
    # Only list patients without a linked account; shows MRN only
    available_patients = db().execute(
        """
        SELECT p.id, p.mrn FROM patients p
        LEFT JOIN users u ON p.id = u.patient_id
        WHERE u.id IS NULL
        ORDER BY p.mrn
    """
    ).fetchall()

    if request.method == "POST":
        username = request.form.get("username", "").strip()
        role = request.form.get("role", "").strip()
        password = request.form.get("password", "").strip()
        mrn = request.form.get("mrn", "").strip()
        errors = {}

        if not re.fullmatch(r"[a-z0-9_]{3,30}", username):
            errors["username"] = "Username must be 3-30 lowercase letters, numbers, or underscores."
        else:
            # Check collision with ANY existing user including deleted ones
            collision = db().execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone()
            if collision:
                errors["username"] = "Username already exists (including reserved/deleted accounts)."

        if role not in PERMS:
            errors["role"] = "Invalid role selected."

        if len(password) < 10:
            errors["password"] = "Password must be at least 10 characters long."

        patient_id = None
        if role == "patient":
            if not mrn:
                errors["mrn"] = "Must select a patient MRN to link."
            else:
                pat = db().execute("SELECT id FROM patients WHERE mrn=?", (mrn,)).fetchone()
                if not pat:
                    errors["mrn"] = "Selected MRN was not found."
                else:
                    already_linked = db().execute(
                        "SELECT 1 FROM users WHERE patient_id=?", (pat["id"],)
                    ).fetchone()
                    if already_linked:
                        errors["mrn"] = "That patient record is already linked to another account."
                    else:
                        patient_id = pat["id"]
        elif mrn:
            errors["mrn"] = "Cannot link patient record to non-patient role."

        if errors:
            form = {"username": username, "role": role, "password": password, "mrn": mrn}
            return (
                render_template("user_new.html", form=form, patients=available_patients, errors=errors),
                422,
            )

        pw_hash = generate_password_hash(password, method="pbkdf2:sha256")
        db().execute(
            """
            INSERT INTO users(username, pw_hash, role, status, patient_id, must_change_password, session_version, created_at, reviewed_by, reviewed_at)
            VALUES(?, ?, ?, 'approved', ?, 1, 0, ?, ?, ?)
        """,
            (username, pw_hash, role, patient_id, now(), session["u"], now()),
        )
        db().commit()

        # Audit: user_created (target username, role, and MRN if linked - NEVER password)
        detail_msg = f"{username} ({role})" + (f" mrn {mrn}" if mrn else "")
        log("user_created", detail_msg)

        # Render result page directly in POST response showing temporary password once
        return render_template(
            "user_created_result.html",
            title="User Account Created",
            subtitle=f"Account '{username}' ({role}) provisioned successfully with temporary credentials.",
            username=username,
            temp_password=password,
        )

    return render_template("user_new.html", patients=available_patients, form={}, errors={})


def get_user_tab(default="active"):
    tab = (request.args.get("tab") or request.form.get("tab") or default).lower()
    valid_tabs = ["pending", "active", "declined", "disabled", "deleted"]
    return tab if tab in valid_tabs else default


def require_status(target, allowed, tab, what):
    """Return a redirect response if the target user is not in an allowed status, else None."""
    if target["status"] not in allowed:
        flash(f"Cannot {what} '{target['username']}' while the account is {target['status']}.", "error")
        return redirect(f"/users?tab={tab}")
    return None


@app.route("/users/<int:uid>/approve", methods=["POST"])
@need("manage_users")
def user_approve(uid):
    tab = get_user_tab("pending")
    target = db().execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not target:
        abort(404)

    if target["username"] == session["u"]:
        flash("You cannot perform administrative actions on your own account.", "error")
        return redirect(f"/users?tab={tab}")

    blocked = require_status(target, ("pending", "declined"), tab, "approve")
    if blocked:
        return blocked

    role = request.form.get("role", "").strip()
    if role not in PERMS:
        flash("Invalid role selected.", "error")
        return redirect(f"/users?tab={tab}")

    patient_id = None
    mrn_detail = ""
    if role == "patient":
        mrn = request.form.get("mrn", "").strip()
        if not mrn:
            flash(f"Must choose a patient MRN to approve user '{target['username']}' as patient.", "error")
            return redirect(f"/users?tab={tab}")
        pat = db().execute("SELECT id FROM patients WHERE mrn=?", (mrn,)).fetchone()
        if not pat:
            flash(f"Specified MRN '{mrn}' does not exist.", "error")
            return redirect(f"/users?tab={tab}")
        linked = db().execute("SELECT 1 FROM users WHERE patient_id=? AND id!=?", (pat["id"], uid)).fetchone()
        if linked:
            flash(f"That patient record '{mrn}' is already linked to another account.", "error")
            return redirect(f"/users?tab={tab}")
        patient_id = pat["id"]
        mrn_detail = f" mrn {mrn}"

    new_version = (target["session_version"] or 0) + 1
    db().execute(
        """
        UPDATE users
        SET status='approved', role=?, patient_id=?, reviewed_by=?, reviewed_at=?, session_version=?
        WHERE id=?
    """,
        (role, patient_id, session["u"], now(), new_version, uid),
    )
    db().commit()
    log("user_approved", f"{target['username']} ({role}){mrn_detail}")
    flash(f"User '{target['username']}' approved as {role}.", "success")
    return redirect(f"/users?tab={tab}")


@app.route("/users/<int:uid>/decline", methods=["POST"])
@need("manage_users")
def user_decline(uid):
    tab = get_user_tab("pending")
    target = db().execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not target:
        abort(404)

    if target["username"] == session["u"]:
        flash("You cannot perform administrative actions on your own account.", "error")
        return redirect(f"/users?tab={tab}")

    blocked = require_status(target, ("pending",), tab, "decline")
    if blocked:
        return blocked

    new_version = (target["session_version"] or 0) + 1
    db().execute(
        "UPDATE users SET status='declined', reviewed_by=?, reviewed_at=?, session_version=? WHERE id=?",
        (session["u"], now(), new_version, uid),
    )
    db().commit()
    log("user_declined", target["username"])
    flash(f"User request for '{target['username']}' declined.", "info")
    return redirect(f"/users?tab={tab}")


@app.route("/users/<int:uid>/role", methods=["POST"])
@need("manage_users")
def user_role(uid):
    tab = get_user_tab("active")
    target = db().execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not target:
        abort(404)

    blocked = require_status(target, ("approved",), tab, "change the role of")
    if blocked:
        return blocked

    new_role = request.form.get("role", "").strip()
    if new_role not in PERMS:
        flash("Invalid role selected.", "error")
        return redirect(f"/users?tab={tab}")

    if new_role == "patient" and not target["patient_id"]:
        flash("A patient account must be linked to a patient record. Create a new patient user (with an MRN) instead.", "error")
        return redirect(f"/users?tab={tab}")

    # Guard rail 1: last active auditor cannot be demoted
    if target["role"] == "auditor" and target["status"] == "approved" and new_role != "auditor":
        active_auditor_count = db().execute(
            "SELECT COUNT(*) AS c FROM users WHERE role='auditor' AND status='approved'"
        ).fetchone()["c"]
        if active_auditor_count <= 1:
            flash("Action blocked: cannot demote the last active auditor.", "error")
            return redirect(f"/users?tab={tab}")

    # Guard rail 2: auditor cannot act on their own account
    if target["username"] == session["u"]:
        flash("You cannot perform administrative actions on your own account.", "error")
        return redirect(f"/users?tab={tab}")

    old_role = target["role"]
    new_version = (target["session_version"] or 0) + 1
    keep_patient_link = target["patient_id"] if new_role == "patient" else None
    db().execute(
        "UPDATE users SET role=?, patient_id=?, session_version=? WHERE id=?",
        (new_role, keep_patient_link, new_version, uid),
    )
    db().commit()
    log("user_role_changed", f"{target['username']}: {old_role} -> {new_role}")
    flash(f"Role for '{target['username']}' updated to {new_role}.", "success")
    return redirect(f"/users?tab={tab}")


@app.route("/users/<int:uid>/force-logout", methods=["POST"])
@need("manage_users")
def user_force_logout(uid):
    tab = get_user_tab("active")
    target = db().execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not target:
        abort(404)

    if target["username"] == session["u"]:
        flash("You cannot perform administrative actions on your own account.", "error")
        return redirect(f"/users?tab={tab}")

    blocked = require_status(target, ("approved",), tab, "log out")
    if blocked:
        return blocked

    new_version = (target["session_version"] or 0) + 1
    db().execute("UPDATE users SET session_version=? WHERE id=?", (new_version, uid))
    db().commit()
    log("user_force_logout", target["username"])
    flash(f"User '{target['username']}' has been logged out immediately.", "info")
    return redirect(f"/users?tab={tab}")


@app.route("/users/<int:uid>/reset-password", methods=["POST"])
@need("manage_users")
def user_reset_password(uid):
    tab = get_user_tab("active")
    target = db().execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not target:
        abort(404)

    if target["username"] == session["u"]:
        flash("You cannot perform administrative actions on your own account.", "error")
        return redirect(f"/users?tab={tab}")

    blocked = require_status(target, ("approved",), tab, "reset the password of")
    if blocked:
        return blocked

    temp_pw = generate_temp_password()
    new_hash = generate_password_hash(temp_pw, method="pbkdf2:sha256")
    new_version = (target["session_version"] or 0) + 1
    db().execute(
        """
        UPDATE users
        SET pw_hash=?, must_change_password=1, session_version=?
        WHERE id=?
    """,
        (new_hash, new_version, uid),
    )
    db().commit()
    log("user_password_reset", target["username"])

    flash(f"Password reset for user '{target['username']}'. Temporary password generated.", "success")
    return render_template(
        "user_created_result.html",
        title="Password Reset",
        subtitle=f"A new temporary password was generated for '{target['username']}'. Active sessions have been invalidated.",
        username=target["username"],
        temp_password=temp_pw,
    )


@app.route("/users/<int:uid>/disable", methods=["POST"])
@need("manage_users")
def user_disable(uid):
    tab = get_user_tab("active")
    target = db().execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not target:
        abort(404)

    # Guard rail 1: last active auditor cannot be disabled
    if target["role"] == "auditor" and target["status"] == "approved":
        active_auditor_count = db().execute(
            "SELECT COUNT(*) AS c FROM users WHERE role='auditor' AND status='approved'"
        ).fetchone()["c"]
        if active_auditor_count <= 1:
            flash("Action blocked: cannot disable or delete the last active auditor.", "error")
            return redirect(f"/users?tab={tab}")

    # Guard rail 2: auditor cannot act on their own account
    if target["username"] == session["u"]:
        flash("You cannot perform administrative actions on your own account.", "error")
        return redirect(f"/users?tab={tab}")

    blocked = require_status(target, ("approved",), tab, "disable")
    if blocked:
        return blocked

    new_version = (target["session_version"] or 0) + 1
    db().execute(
        "UPDATE users SET status='disabled', session_version=? WHERE id=?",
        (new_version, uid),
    )
    db().commit()
    log("user_disabled", target["username"])
    flash(f"User '{target['username']}' disabled.", "info")
    return redirect(f"/users?tab={tab}")


@app.route("/users/<int:uid>/enable", methods=["POST"])
@need("manage_users")
def user_enable(uid):
    tab = get_user_tab("disabled")
    target = db().execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not target:
        abort(404)

    if target["username"] == session["u"]:
        flash("You cannot perform administrative actions on your own account.", "error")
        return redirect(f"/users?tab={tab}")

    blocked = require_status(target, ("disabled",), tab, "enable")
    if blocked:
        return blocked

    new_version = (target["session_version"] or 0) + 1
    db().execute(
        "UPDATE users SET status='approved', session_version=? WHERE id=?",
        (new_version, uid),
    )
    db().commit()
    log("user_enabled", target["username"])
    flash(f"User '{target['username']}' enabled.", "success")
    return redirect(f"/users?tab={tab}")


@app.route("/users/<int:uid>/delete", methods=["POST"])
@need("manage_users")
def user_delete(uid):
    tab = get_user_tab("active")
    target = db().execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not target:
        abort(404)

    # Guard rail 1: last active auditor cannot be deleted
    if target["role"] == "auditor" and target["status"] == "approved":
        active_auditor_count = db().execute(
            "SELECT COUNT(*) AS c FROM users WHERE role='auditor' AND status='approved'"
        ).fetchone()["c"]
        if active_auditor_count <= 1:
            flash("Action blocked: cannot disable or delete the last active auditor.", "error")
            return redirect(f"/users?tab={tab}")

    # Guard rail 2: auditor cannot act on their own account
    if target["username"] == session["u"]:
        flash("You cannot perform administrative actions on your own account.", "error")
        return redirect(f"/users?tab={tab}")

    blocked = require_status(target, ("pending", "approved", "declined", "disabled"), tab, "delete")
    if blocked:
        return blocked

    new_version = (target["session_version"] or 0) + 1
    db().execute(
        "UPDATE users SET status='deleted', session_version=? WHERE id=?",
        (new_version, uid),
    )
    db().commit()
    log("user_deleted", target["username"])
    flash(f"User '{target['username']}' deleted.", "info")
    return redirect(f"/users?tab={tab}")


# Legacy dispatcher: kept only because older tests post here. The /users page buttons use the direct routes above.
@app.route("/users/<int:uid>/action", methods=["POST"])
@need("manage_users")
def user_action(uid):
    action = request.form.get("user_action") or request.form.get("action")
    if action == "approve":
        return user_approve(uid)
    elif action == "decline":
        return user_decline(uid)
    elif action in ("change_role", "role"):
        return user_role(uid)
    elif action == "force_logout":
        return user_force_logout(uid)
    elif action == "reset_password":
        return user_reset_password(uid)
    elif action == "disable":
        return user_disable(uid)
    elif action == "enable":
        return user_enable(uid)
    elif action == "delete":
        return user_delete(uid)
    else:
        tab = get_user_tab("pending")
        flash("Unknown action requested.", "error")
        return redirect(f"/users?tab={tab}")


init_db()

if __name__ == "__main__":
    app.run(
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", 5001)),
        debug=os.environ.get("FLASK_DEBUG") == "1",
    )
