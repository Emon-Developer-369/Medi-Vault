"""Medi Vault - small demo: patients, private documents, roles, audit log. Synthetic data only."""
import os, re, sqlite3, uuid, secrets, hashlib, datetime
from flask import (Flask, request, session, redirect, render_template_string, send_from_directory,
                   abort, g, flash, get_flashed_messages)
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

BASE = os.path.dirname(os.path.abspath(__file__))
def load_env():  # secrets live in .env, never in code
    p = os.path.join(BASE, ".env")
    if os.path.exists(p):
        for line in open(p):
            if "=" in line and not line.startswith("#"):
                k, v = line.strip().split("=", 1); os.environ.setdefault(k, v)
load_env()
UPLOADS = os.path.join(BASE, "private_uploads"); os.makedirs(UPLOADS, exist_ok=True)
DB = os.path.join(BASE, "medivault.db")
app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY") or secrets.token_hex(32)
app.config.update(MAX_CONTENT_LENGTH=5 * 1024 * 1024, SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax")
PERMS = {"clerk": {"register", "upload", "view"}, "doctor": {"view"}, "auditor": {"audit"}}
MAGIC = {"pdf": b"%PDF-", "png": b"\x89PNG\r\n\x1a\n", "jpg": b"\xff\xd8\xff", "jpeg": b"\xff\xd8\xff"}

def db():
    if "db" not in g:
        g.db = sqlite3.connect(DB); g.db.row_factory = sqlite3.Row
    return g.db
@app.teardown_appcontext
def close_db(_):
    if "db" in g: g.db.close()

def init_db():
    c = sqlite3.connect(DB)
    c.executescript("""
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE, pw_hash TEXT, role TEXT);
    CREATE TABLE IF NOT EXISTS patients(id INTEGER PRIMARY KEY, mrn TEXT UNIQUE, name TEXT, dob TEXT, created_by TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS documents(id INTEGER PRIMARY KEY, patient_id INTEGER REFERENCES patients(id), title TEXT, doc_type TEXT,
        stored_name TEXT, original_name TEXT, size INTEGER, sha256 TEXT, uploaded_by TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, ts TEXT, user TEXT, action TEXT, detail TEXT, outcome TEXT);
    """)
    if not c.execute("SELECT 1 FROM users").fetchone():  # seed fake data
        pw = generate_password_hash(os.environ.get("DEMO_PASSWORD", "Demo@1234"), method="pbkdf2:sha256")
        for u, r in [("clerk", "clerk"), ("doctor", "doctor"), ("auditor", "auditor")]:
            c.execute("INSERT INTO users(username,pw_hash,role) VALUES(?,?,?)", (u, pw, r))
        for mrn, n, d in [("MRN-1001", "Asha Verma (fake)", "1985-03-14"), ("MRN-1002", "Ravi Kumar (fake)", "1990-07-02"), ("MRN-1003", "Meena Iyer (fake)", "1978-11-23")]:
            c.execute("INSERT INTO patients(mrn,name,dob,created_by,created_at) VALUES(?,?,?,?,?)", (mrn, n, d, "seed", now()))
        pdf = (b"%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
               b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 120]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n"
               b"4 0 obj<</Length 60>>stream\nBT /F1 14 Tf 20 60 Td (FAKE lab report - synthetic data) Tj ET\nendstream endobj\n"
               b"5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF")
        name = uuid.uuid4().hex + ".pdf"; open(os.path.join(UPLOADS, name), "wb").write(pdf)
        c.execute("INSERT INTO documents(patient_id,title,doc_type,stored_name,original_name,size,sha256,uploaded_by,created_at) VALUES(1,'Sample blood test','Lab report',?,?,?,?,?,?)",
                  (name, "sample.pdf", len(pdf), hashlib.sha256(pdf).hexdigest(), "seed", now()))
    c.commit(); c.close()

def now(): return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
def log(action, detail="", outcome="ok"):
    db().execute("INSERT INTO audit(ts,user,action,detail,outcome) VALUES(?,?,?,?,?)", (now(), session.get("u", "anonymous"), action, detail, outcome)); db().commit()
def csrf(): return session.setdefault("csrf", secrets.token_hex(16))
app.jinja_env.globals["csrf"] = csrf

def need(perm):  # login + role check on the server for every protected route
    def deco(f):
        def wrapper(*a, **k):
            if "u" not in session: return redirect("/login")
            if perm not in PERMS.get(session["role"], set()):
                log("denied", f"{request.method} {request.path} needs '{perm}'", "denied"); abort(403)
            return f(*a, **k)
        wrapper.__name__ = f.__name__; return wrapper
    return deco

@app.before_request
def csrf_check():
    if request.method == "POST" and request.form.get("csrf") != session.get("csrf"): abort(400)
@app.after_request
def headers(r):
    r.headers["X-Content-Type-Options"] = "nosniff"; r.headers["Cache-Control"] = "no-store"; return r
@app.errorhandler(403)
def e403(_): return page("<h2>403 - not allowed for your role</h2><p>This attempt was recorded in the audit log.</p>"), 403
@app.errorhandler(413)
def e413(_): return page("<h2>File too large (max 5 MB)</h2>"), 413

BASE_HTML = """<!doctype html><title>Medi Vault</title><style>body{font:15px system-ui;max-width:900px;margin:20px auto;padding:0 12px}
nav{display:flex;gap:12px;align-items:center;border-bottom:1px solid #ccc;padding-bottom:8px}table{width:100%;border-collapse:collapse}
td,th{border-bottom:1px solid #ddd;padding:6px;text-align:left}.f{background:#fff3cd;padding:6px;margin:6px 0}input,select,button{padding:5px;margin:2px}</style>
<nav><b>Medi Vault</b>{% if session.u %}{% if session.role!='auditor' %}<a href="/patients">Patients</a>{% else %}<a href="/audit">Audit log</a>{% endif %}
<span style="margin-left:auto">{{session.u}} ({{session.role}})</span><form method=post action="/logout"><input type=hidden name=csrf value="{{csrf()}}"><button>Logout</button></form>{% endif %}</nav>
{% for m in msgs %}<div class=f>{{m}}</div>{% endfor %}{{body|safe}}<p><small>Demo - synthetic data only.</small></p>"""
def page(tpl, **ctx):
    return render_template_string(BASE_HTML, body=render_template_string(tpl, **ctx), msgs=get_flashed_messages())

@app.route("/")
def home(): return redirect("/login" if "u" not in session else ("/audit" if session["role"] == "auditor" else "/patients"))

@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        u = db().execute("SELECT * FROM users WHERE username=?", (request.form.get("username", ""),)).fetchone()
        if u and check_password_hash(u["pw_hash"], request.form.get("password", "")):
            session.clear(); session["u"], session["role"] = u["username"], u["role"]; log("login"); return redirect("/")
        log("login_failed", request.form.get("username", "")[:30], "failed"); flash("Wrong username or password")
    return page("""<h2>Login</h2><form method=post><input type=hidden name=csrf value="{{csrf()}}">
    <input name=username placeholder=username required><input name=password type=password placeholder=password required><button>Login</button></form>""")

@app.route("/logout", methods=["POST"])
def logout():
    if "u" in session: log("logout")
    session.clear(); return redirect("/login")

@app.route("/patients")
@need("view")
def patients():
    q = request.args.get("q", "").strip()[:50]
    rows = db().execute("SELECT * FROM patients WHERE name LIKE ? OR mrn LIKE ? ORDER BY id DESC LIMIT 100", (f"%{q}%", f"%{q}%")).fetchall()
    log("search", q)
    return page("""<h2>Patients</h2><form><input name=q value="{{q}}" placeholder="Search name or MRN"><button>Search</button></form>
    <table><tr><th>MRN<th>Name<th>DOB</tr>{% for p in rows %}<tr><td>{{p.mrn}}<td><a href="/patients/{{p.id}}">{{p.name}}</a><td>{{p.dob}}</tr>{% endfor %}</table>
    {% if 'register' in can %}<h3>Register patient</h3><form method=post action="/patients/new"><input type=hidden name=csrf value="{{csrf()}}">
    <input name=name placeholder="Full name" required><input name=mrn placeholder="MRN e.g. MRN-2001" required><input name=dob type=date required><button>Register</button></form>{% endif %}""",
                q=q, rows=rows, can=PERMS[session["role"]])

@app.route("/patients/new", methods=["POST"])
@need("register")
def patient_new():
    name, mrn, dob = request.form["name"].strip(), request.form["mrn"].strip(), request.form["dob"]
    try: ok = datetime.date.fromisoformat(dob) <= datetime.date.today()
    except ValueError: ok = False
    if not (1 <= len(name) <= 100 and re.fullmatch(r"[A-Za-z0-9-]{3,20}", mrn) and ok):
        flash("Invalid input: check name, MRN (3-20 letters/digits/-) and date of birth"); return redirect("/patients")
    try:
        db().execute("INSERT INTO patients(mrn,name,dob,created_by,created_at) VALUES(?,?,?,?,?)", (mrn, name, dob, session["u"], now())); db().commit()
        log("patient_created", mrn); flash("Patient registered")
    except sqlite3.IntegrityError: flash("That MRN already exists")
    return redirect("/patients")

@app.route("/patients/<int:pid>")
@need("view")
def patient(pid):
    p = db().execute("SELECT * FROM patients WHERE id=?", (pid,)).fetchone() or abort(404)
    docs = db().execute("SELECT * FROM documents WHERE patient_id=? ORDER BY id DESC", (pid,)).fetchall()
    log("view_patient", p["mrn"])
    return page("""<h2>{{p.name}}</h2><p>{{p.mrn}} - DOB {{p.dob}}</p><h3>Documents</h3>
    <table><tr><th>Title<th>Type<th>Uploaded<th></tr>{% for d in docs %}<tr><td>{{d.title}}<td>{{d.doc_type}}<td>{{d.created_at}} by {{d.uploaded_by}}<td><a href="/documents/{{d.id}}">Open</a></tr>{% endfor %}</table>
    {% if 'upload' in can %}<h3>Upload (PDF/PNG/JPG, max 5 MB)</h3><form method=post enctype=multipart/form-data action="/patients/{{p.id}}/upload"><input type=hidden name=csrf value="{{csrf()}}">
    <input name=title placeholder=Title required><select name=doc_type><option>Lab report<option>Prescription<option>Discharge summary<option>Other</select>
    <input type=file name=file required><button>Upload</button></form>{% endif %}""", p=p, docs=docs, can=PERMS[session["role"]])

@app.route("/patients/<int:pid>/upload", methods=["POST"])
@need("upload")
def upload(pid):
    db().execute("SELECT 1 FROM patients WHERE id=?", (pid,)).fetchone() or abort(404)
    f, title = request.files.get("file"), request.form.get("title", "").strip()[:100]
    ext = (f.filename.rsplit(".", 1)[-1].lower() if f and "." in f.filename else "")
    data = f.read() if f else b""
    if not title or ext not in MAGIC or not data.startswith(MAGIC[ext]):
        log("upload_rejected", f.filename if f else "", "rejected"); flash("Rejected: only real PDF, PNG or JPG files are allowed"); return redirect(f"/patients/{pid}")
    stored = uuid.uuid4().hex + "." + ext  # random name; never the user's filename
    open(os.path.join(UPLOADS, stored), "wb").write(data)
    db().execute("INSERT INTO documents(patient_id,title,doc_type,stored_name,original_name,size,sha256,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
                 (pid, title, request.form.get("doc_type", "Other")[:30], stored, secure_filename(f.filename), len(data), hashlib.sha256(data).hexdigest(), session["u"], now())); db().commit()
    log("upload", f"patient {pid}: {title}"); flash("Document uploaded"); return redirect(f"/patients/{pid}")

@app.route("/documents/<int:did>")
@need("view")
def document(did):
    d = db().execute("SELECT * FROM documents WHERE id=?", (did,)).fetchone() or abort(404)
    log("view_document", f"doc {did} patient {d['patient_id']}")
    return send_from_directory(UPLOADS, d["stored_name"], download_name=d["original_name"])

@app.route("/audit")
@need("audit")
def audit():
    rows = db().execute("SELECT * FROM audit ORDER BY id DESC LIMIT 200").fetchall()
    return page("""<h2>Audit log (latest 200)</h2><table><tr><th>Time<th>User<th>Action<th>Detail<th>Outcome</tr>
    {% for r in rows %}<tr><td>{{r.ts}}<td>{{r.user}}<td>{{r.action}}<td>{{r.detail}}<td>{{r.outcome}}</tr>{% endfor %}</table>""", rows=rows)

init_db()
if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 5001)), debug=False)
