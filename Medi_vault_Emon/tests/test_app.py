import os
import sys
import re
import tempfile
import datetime
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Ensure MEDIVAULT_DB points to a temporary database during tests
test_db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
test_db_path = test_db_file.name
test_db_file.close()

os.environ["MEDIVAULT_DB"] = test_db_path
os.environ["DEMO_PASSWORD"] = "Demo@1234"

import app


@pytest.fixture(autouse=True)
def setup_test_db():
    if os.path.exists(test_db_path):
        os.remove(test_db_path)
    app.init_db(test_db_path)
    yield
    if os.path.exists(test_db_path):
        os.remove(test_db_path)


@pytest.fixture
def client():
    app.app.config["TESTING"] = True
    app.app.config["WTF_CSRF_ENABLED"] = False
    with app.app.test_client() as client:
        yield client


def get_csrf(client):
    with client.session_transaction() as sess:
        if "csrf" not in sess:
            sess["csrf"] = "test_csrf_token_12345"
        return sess["csrf"]


def login_as(client, username, password="Demo@1234"):
    with client.session_transaction() as sess:
        sess.clear()
    csrf = get_csrf(client)
    return client.post(
        "/login",
        data={"username": username, "password": password, "csrf": csrf},
        follow_redirects=True,
    )


# Test 1: Permission matrix for clerk, doctor, auditor
def test_permission_matrix(client):
    # Clerk: can view patients and register, but cannot audit or manage_users
    login_as(client, "clerk")
    assert client.get("/patients").status_code == 200
    assert client.get("/patients/new").status_code == 200
    assert client.get("/audit").status_code == 403
    assert client.get("/users").status_code == 403

    # Doctor: can view patients and edit doc, but cannot register patients, audit, or manage_users
    client.get("/")  # refresh
    login_as(client, "doctor")
    assert client.get("/patients").status_code == 200
    assert client.get("/patients/new").status_code == 403
    assert client.get("/audit").status_code == 403
    assert client.get("/users").status_code == 403
    assert client.get("/documents/1/edit").status_code == 200

    # Auditor: can audit and manage_users, but cannot view patients or documents
    login_as(client, "auditor")
    assert client.get("/audit").status_code == 200
    assert client.get("/users").status_code == 200
    assert client.get("/patients").status_code == 403
    assert client.get("/patients/new").status_code == 403
    assert client.get("/patients/1").status_code == 403
    assert client.get("/documents/1").status_code == 403


# Test 2: POST without a CSRF token is rejected (400)
def test_post_without_csrf_is_rejected(client):
    # Missing CSRF in POST request
    res = client.post("/login", data={"username": "clerk", "password": "Demo@1234"})
    assert res.status_code == 400


# Test 3: A past registration date is rejected
def test_past_registration_date_rejected(client):
    login_as(client, "clerk")
    csrf = get_csrf(client)
    yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
    dob = (datetime.date.today() - datetime.timedelta(days=365 * 25)).isoformat()

    res = client.post(
        "/patients/new",
        data={
            "csrf": csrf,
            "name": "Invalid Reg Patient",
            "mrn": "MRN-PAST-01",
            "dob": dob,
            "registered_on": yesterday,
        },
    )
    assert res.status_code == 422
    assert b"Registration date must be today or a future date" in res.data

    # Verify patient was not saved
    with app.app.app_context():
        p = app.db().execute("SELECT * FROM patients WHERE mrn='MRN-PAST-01'").fetchone()
        assert p is None


def staff_signup(client, username, email=None):
    csrf = get_csrf(client)
    return client.post(
        "/signup",
        data={
            "csrf": csrf,
            "signup_type": "staff",
            "full_name": f"{username} Staff (fake)",
            "email": email or f"{username}@hospital.test",
            "username": username,
            "password": "Password1234!",
            "confirm_password": "Password1234!",
        },
        follow_redirects=True,
    )


# Test 4: A pending staff request cannot log in
def test_pending_user_cannot_login(client):
    csrf = get_csrf(client)
    signup_res = staff_signup(client, "newdoctor")
    assert signup_res.status_code == 200
    assert b"Account requested" in signup_res.data

    # Attempt to log in with pending user credentials
    login_res = client.post(
        "/login",
        data={"csrf": csrf, "username": "newdoctor", "password": "Password1234!"},
    )
    assert login_res.status_code == 200
    assert b"pending approval" in login_res.data
    # Ensure no authenticated session was set
    with client.session_transaction() as sess:
        assert sess.get("u") is None


# Test 5: Approve then login works
def test_approve_then_login_works(client):
    staff_signup(client, "nurse_joy")

    # Login as auditor to approve the user
    login_as(client, "auditor")
    with app.app.app_context():
        u = app.db().execute("SELECT id FROM users WHERE username='nurse_joy'").fetchone()
        assert u is not None
        uid = u["id"]

    csrf_auditor = get_csrf(client)
    approve_res = client.post(
        f"/users/{uid}/action?tab=pending",
        data={"csrf": csrf_auditor, "action": "approve", "role": "clerk"},
        follow_redirects=True,
    )
    assert approve_res.status_code == 200
    assert b"approved as clerk" in approve_res.data

    # Logout auditor and login as newly approved user
    client.post("/logout", data={"csrf": csrf_auditor})
    login_res = login_as(client, "nurse_joy", "Password1234!")
    assert login_res.status_code == 200
    with client.session_transaction() as sess:
        assert sess.get("u") == "nurse_joy"
        assert sess.get("role") == "clerk"

    # Newly approved clerk can now access /patients
    assert client.get("/patients").status_code == 200


# Test 6: The last auditor cannot be demoted, disabled, or deleted
def test_last_auditor_cannot_be_demoted(client):
    login_as(client, "auditor")
    with app.app.app_context():
        aud = app.db().execute("SELECT id FROM users WHERE username='auditor'").fetchone()
        aud_id = aud["id"]

    csrf = get_csrf(client)
    # Attempt to demote the sole active auditor
    res_demote = client.post(
        f"/users/{aud_id}/action",
        data={"csrf": csrf, "action": "change_role", "role": "clerk"},
        follow_redirects=True,
    )
    assert b"cannot demote the last active auditor" in res_demote.data

    # Attempt to disable the sole active auditor
    res_disable = client.post(
        f"/users/{aud_id}/action",
        data={"csrf": csrf, "action": "disable"},
        follow_redirects=True,
    )
    assert b"cannot disable or delete the last active auditor" in res_disable.data

    # Attempt to delete the sole active auditor
    res_delete = client.post(
        f"/users/{aud_id}/action",
        data={"csrf": csrf, "action": "delete"},
        follow_redirects=True,
    )
    assert b"cannot disable or delete the last active auditor" in res_delete.data

    # Verify auditor role and status are unchanged in DB
    with app.app.app_context():
        aud_check = app.db().execute("SELECT role, status FROM users WHERE id=?", (aud_id,)).fetchone()
        assert aud_check["role"] == "auditor"
        assert aud_check["status"] == "approved"


# Test 7: A doctor edit creates a history row
def test_doctor_edit_creates_history_row(client):
    login_as(client, "doctor")
    csrf = get_csrf(client)

    # Initial history count
    with app.app.app_context():
        initial_count = app.db().execute(
            "SELECT COUNT(*) AS c FROM document_history WHERE document_id=1"
        ).fetchone()["c"]

    # Doctor edits metadata of document 1
    edit_res = client.post(
        "/documents/1/edit",
        data={
            "csrf": csrf,
            "title": "Updated Lab Report Title",
            "doc_type": "Lab report",
            "notes": "Reviewed and verified by Doctor on duty.",
        },
        follow_redirects=True,
    )
    assert edit_res.status_code == 200

    with app.app.app_context():
        new_count = app.db().execute(
            "SELECT COUNT(*) AS c FROM document_history WHERE document_id=1"
        ).fetchone()["c"]
        assert new_count == initial_count + 1

        latest = app.db().execute(
            "SELECT * FROM document_history WHERE document_id=1 ORDER BY id DESC LIMIT 1"
        ).fetchone()
        assert latest["title"] == "Updated Lab Report Title"
        assert latest["notes"] == "Reviewed and verified by Doctor on duty."
        assert latest["change_type"] == "document_edited"
        assert latest["changed_by"] == "doctor"


# Test 8: The auditor gets 403 on /patients
def test_auditor_gets_403_on_patients(client):
    login_as(client, "auditor")
    res = client.get("/patients")
    assert res.status_code == 403
    assert b"Access Denied" in res.data


# Additional comprehensive tests for security and features
def test_need_checks_database_on_every_request_disabling_user(client):
    # Tests that when an approved user is disabled in the database,
    # their active session is immediately blocked on the next request.
    login_as(client, "clerk")
    assert client.get("/patients").status_code == 200

    # Auditor disables clerk
    with app.app.app_context():
        app.db().execute("UPDATE users SET status='disabled' WHERE username='clerk'")
        app.db().commit()

    # Next request by clerk should redirect to login and clear session
    res = client.get("/patients", follow_redirects=False)
    assert res.status_code == 302
    assert "/login" in res.headers["Location"]

    with client.session_transaction() as sess:
        assert sess.get("u") is None


def test_empty_search_does_not_log_audit(client):
    login_as(client, "clerk")
    with app.app.app_context():
        # Clear search logs
        app.db().execute("DELETE FROM audit WHERE action='search'")
        app.db().commit()

    # GET /patients without q
    client.get("/patients")
    with app.app.app_context():
        cnt = app.db().execute("SELECT COUNT(*) AS c FROM audit WHERE action='search'").fetchone()["c"]
        assert cnt == 0

    # GET /patients with non-empty q
    client.get("/patients?q=Asha")
    with app.app.app_context():
        cnt = app.db().execute("SELECT COUNT(*) AS c FROM audit WHERE action='search'").fetchone()["c"]
        assert cnt == 1


def test_future_dob_rejected(client):
    login_as(client, "clerk")
    csrf = get_csrf(client)
    tomorrow = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
    today = datetime.date.today().isoformat()

    res = client.post(
        "/patients/new",
        data={
            "csrf": csrf,
            "name": "Time Traveler",
            "mrn": "MRN-FUTURE-01",
            "dob": tomorrow,
            "registered_on": today,
        },
    )
    assert res.status_code == 422
    assert b"Date of birth must be today or earlier" in res.data


def test_document_version_replacement_by_doctor(client):
    login_as(client, "doctor")
    csrf = get_csrf(client)

    pdf_v2 = (
        b"%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 120]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n"
        b"4 0 obj<</Length 40>>stream\nBT /F1 14 Tf 20 60 Td (Version 2 Lab Data) Tj ET\nendstream endobj\n"
        b"5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF"
    )

    import io
    data = {
        "csrf": csrf,
        "title": "Lab Report Version 2",
        "doc_type": "Lab report",
        "notes": "Re-sampled and verified",
        "file": (io.BytesIO(pdf_v2), "updated_report.pdf"),
    }

    res = client.post(
        "/documents/1/edit",
        data=data,
        content_type="multipart/form-data",
        follow_redirects=True,
    )
    assert res.status_code == 200

    with app.app.app_context():
        doc = app.db().execute("SELECT * FROM documents WHERE id=1").fetchone()
        assert doc["version"] == 2
        assert doc["title"] == "Lab Report Version 2"

        history = app.db().execute("SELECT * FROM document_history WHERE document_id=1 ORDER BY version DESC").fetchall()
        assert len(history) >= 2
        assert history[0]["version"] == 2
        assert history[0]["change_type"] == "new_version"


# --- ROUND 2 TESTS (TASK2.md) ---

def test_auditor_creates_clerk_and_forced_password_change(client):
    login_as(client, "auditor")
    csrf = get_csrf(client)

    # Auditor directly provisions a new clerk with a temporary password
    res = client.post(
        "/users/new",
        data={
            "csrf": csrf,
            "username": "clerk_direct",
            "role": "clerk",
            "password": "InitialTempPass123!",
        },
    )
    assert res.status_code == 200
    # Temporary password shown ONCE in direct response
    assert b"InitialTempPass123!" in res.data
    assert b"clerk_direct" in res.data

    # Verify password was NEVER logged in audit trail
    with app.app.app_context():
        audits = app.db().execute("SELECT detail FROM audit WHERE action='user_created'").fetchall()
        for a in audits:
            assert "InitialTempPass123!" not in a["detail"]

    # Logout auditor and login as newly created clerk
    client.post("/logout", data={"csrf": csrf})
    login_res = login_as(client, "clerk_direct", "InitialTempPass123!")
    assert login_res.status_code == 200

    # User is forced to change password; accessing any protected route redirects to /account/password
    pat_res = client.get("/patients", follow_redirects=False)
    assert pat_res.status_code == 302
    assert "/account/password" in pat_res.headers["Location"]

    # Change password
    csrf_new = get_csrf(client)
    pw_res = client.post(
        "/account/password",
        data={
            "csrf": csrf_new,
            "current_password": "InitialTempPass123!",
            "new_password": "NewPermanentPass123!",
            "confirm_password": "NewPermanentPass123!",
        },
        follow_redirects=True,
    )
    assert pw_res.status_code == 200
    assert b"Password updated successfully" in pw_res.data

    # Now user can reach /patients normally
    assert client.get("/patients").status_code == 200


def test_creating_patient_account_and_unique_mrn_constraint(client):
    login_as(client, "auditor")
    csrf = get_csrf(client)

    # Patient account requires valid MRN
    res_no_mrn = client.post(
        "/users/new",
        data={
            "csrf": csrf,
            "username": "patient_nomrn",
            "role": "patient",
            "password": "TempPass12345!",
        },
    )
    assert res_no_mrn.status_code == 422
    assert b"Must select a patient MRN" in res_no_mrn.data

    # Link MRN-1002 (Ravi Kumar)
    res_ok = client.post(
        "/users/new",
        data={
            "csrf": csrf,
            "username": "ravi_patient",
            "role": "patient",
            "mrn": "MRN-1002",
            "password": "TempPass12345!",
        },
    )
    assert res_ok.status_code == 200
    assert b"ravi_patient" in res_ok.data

    # Attempting to link another account to the same MRN-1002 is rejected
    res_duplicate = client.post(
        "/users/new",
        data={
            "csrf": csrf,
            "username": "ravi_second",
            "role": "patient",
            "mrn": "MRN-1002",
            "password": "TempPass12345!",
        },
    )
    assert res_duplicate.status_code == 422
    assert b"already linked" in res_duplicate.data


def test_force_logout_invalidates_session(client):
    # Clerk logs in
    login_as(client, "clerk")
    assert client.get("/patients").status_code == 200

    # Auditor forces logout of clerk by incrementing session_version
    with app.app.app_context():
        u = app.db().execute("SELECT id, session_version FROM users WHERE username='clerk'").fetchone()
        app.db().execute("UPDATE users SET session_version=? WHERE id=?", ((u["session_version"] or 0) + 1, u["id"]))
        app.db().commit()

    # Next request by clerk is kicked to login
    res = client.get("/patients", follow_redirects=False)
    assert res.status_code == 302
    assert "/login" in res.headers["Location"]


def test_password_reset_sets_must_change_password(client):
    login_as(client, "auditor")
    with app.app.app_context():
        doctor = app.db().execute("SELECT id FROM users WHERE username='doctor'").fetchone()
        doc_id = doctor["id"]

    csrf = get_csrf(client)
    res = client.post(
        f"/users/{doc_id}/action",
        data={"csrf": csrf, "user_action": "reset_password"},
    )
    assert res.status_code == 200
    assert b"Password Reset" in res.data

    with app.app.app_context():
        doc_check = app.db().execute("SELECT must_change_password, session_version FROM users WHERE id=?", (doc_id,)).fetchone()
        assert doc_check["must_change_password"] == 1


def test_login_lockout_after_five_failed_attempts(client):
    csrf = get_csrf(client)
    # Fail 5 times with wrong password
    for _ in range(5):
        client.post(
            "/login",
            data={"csrf": csrf, "username": "clerk", "password": "WrongPassword!"},
        )

    # 6th attempt is locked out
    lockout_res = client.post(
        "/login",
        data={"csrf": csrf, "username": "clerk", "password": "Demo@1234"},
    )
    assert b"Too many attempts. Try again later." in lockout_res.data

    # Unknown usernames behave identically (no enumeration)
    for _ in range(5):
        client.post(
            "/login",
            data={"csrf": csrf, "username": "non_existent_user", "password": "WrongPassword!"},
        )
    lockout_unknown = client.post(
        "/login",
        data={"csrf": csrf, "username": "non_existent_user", "password": "WrongPassword!"},
    )
    assert b"Too many attempts. Try again later." in lockout_unknown.data


def test_doctor_prescriptions_and_clerk_forbidden(client):
    # Clerk gets 403 when trying to access prescription creation
    login_as(client, "clerk")
    assert client.get("/patients/1/prescriptions/new").status_code == 403

    # Doctor logs in and prescribes medication
    login_as(client, "doctor")
    csrf = get_csrf(client)
    rx_res = client.post(
        "/patients/1/prescriptions/new",
        data={
            "csrf": csrf,
            "medicine": "Amoxicillin 500mg",
            "dosage": "500 mg",
            "duration": "7 days",
            "frequency_select": "Three times daily",
            "instructions": "Take after meals",
        },
        follow_redirects=True,
    )
    assert rx_res.status_code == 200
    assert b"Prescription added successfully" in rx_res.data

    # Verify audit detail contains rx id and patient MRN but NEVER the medicine name
    with app.app.app_context():
        latest_audit = app.db().execute("SELECT * FROM audit WHERE action='prescription_added' ORDER BY id DESC LIMIT 1").fetchone()
        assert "Amoxicillin" not in latest_audit["detail"]
        assert "MRN-1001" in latest_audit["detail"]

    # Doctor stops prescription
    with app.app.app_context():
        rx = app.db().execute("SELECT id FROM prescriptions WHERE medicine='Amoxicillin 500mg'").fetchone()
        rx_id = rx["id"]

    stop_res = client.post(
        f"/prescriptions/{rx_id}/stop",
        data={"csrf": csrf, "stop_reason": "Course completed"},
        follow_redirects=True,
    )
    assert stop_res.status_code == 200
    assert b"Prescription stopped" in stop_res.data

    with app.app.app_context():
        rx_check = app.db().execute("SELECT status, stop_reason FROM prescriptions WHERE id=?", (rx_id,)).fetchone()
        assert rx_check["status"] == "stopped"
        assert rx_check["stop_reason"] == "Course completed"


def test_patient_portal_access_and_cross_patient_privacy(client):
    # Seed patient user 'asha' is linked to MRN-1001 (patient_id=1)
    csrf = get_csrf(client)
    login_res = client.post(
        "/patient-login",
        data={"csrf": csrf, "username": "asha", "password": "Demo@1234"},
        follow_redirects=True,
    )
    assert login_res.status_code == 200
    assert b"Welcome, Asha Verma" in login_res.data

    # Patient can view their own document (doc id 1 belongs to patient 1)
    doc_res = client.get("/portal/documents/1")
    assert doc_res.status_code == 200

    # Cross-patient privacy: create document for patient 2
    with app.app.app_context():
        app.db().execute("""
            INSERT INTO documents(id, patient_id, title, doc_type, notes, stored_name, original_name, size, sha256, version, uploaded_by, created_at)
            VALUES(999, 2, 'Ravi Private Report', 'Lab report', 'Secret doctor note', 'sample.pdf', 'ravi.pdf', 100, 'hash', 1, 'doctor', '2026-11-14')
        """)
        app.db().commit()

    # Patient asha attempts to access patient 2's document -> MUST return 404 (not 403)
    cross_res = client.get("/portal/documents/999")
    assert cross_res.status_code == 404

    # Patient portal page MUST NOT contain internal doctor notes
    portal_page = client.get("/portal")
    assert b"Secret doctor note" not in portal_page.data

    # Patient cannot reach staff routes (expect 403 on all)
    assert client.get("/patients").status_code == 403
    assert client.get("/patients/new").status_code == 403
    assert client.get("/patients/1").status_code == 403
    assert client.get("/audit").status_code == 403
    assert client.get("/users").status_code == 403
    assert client.get("/documents/1").status_code == 403
    assert client.get("/documents/1/edit").status_code == 403


def test_staff_cannot_reach_portal_and_login_role_separation(client):
    # Staff cannot reach /portal
    login_as(client, "doctor")
    assert client.get("/portal").status_code == 403
    with client.session_transaction() as sess:
        sess.clear()

    # Patient login rejects staff account
    csrf = get_csrf(client)
    res_staff_on_patient = client.post(
        "/patient-login",
        data={"csrf": csrf, "username": "doctor", "password": "Demo@1234"},
    )
    assert b"Wrong username or password" in res_staff_on_patient.data

    # Staff login rejects patient account
    res_patient_on_staff = client.post(
        "/login",
        data={"csrf": csrf, "username": "asha", "password": "Demo@1234"},
    )
    assert b"Wrong username or password" in res_patient_on_staff.data


def test_idle_timeout_configuration():
    assert app.app.config["PERMANENT_SESSION_LIFETIME"] == datetime.timedelta(minutes=30)


# --- ROUND 3 TESTS (TASK3.md) ---
# Tests that fetch real HTML pages, parse them with standard library html.parser,
# extract every form and input, submit exactly what a real browser submits,
# and assert that responses never contain "Unknown action".
from html.parser import HTMLParser


class HtmlFormParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.forms = []
        self._current_form = None
        self._current_select = None

    def handle_starttag(self, tag, attrs):
        attr_dict = dict(attrs)
        if tag == "form":
            self._current_form = {
                "action": attr_dict.get("action", ""),
                "method": attr_dict.get("method", "GET").upper(),
                "inputs": {},
                "buttons": [],
            }
            self.forms.append(self._current_form)
        elif self._current_form is not None:
            if tag == "input":
                name = attr_dict.get("name")
                if name:
                    itype = attr_dict.get("type", "text").lower()
                    if itype in ("radio", "checkbox"):
                        if "checked" in attr_dict:
                            self._current_form["inputs"][name] = attr_dict.get("value", "on")
                    else:
                        self._current_form["inputs"][name] = attr_dict.get("value", "")
            elif tag == "select":
                self._current_select = attr_dict.get("name")
            elif tag == "option" and self._current_select:
                if "selected" in attr_dict or self._current_select not in self._current_form["inputs"]:
                    self._current_form["inputs"][self._current_select] = attr_dict.get("value", "")
            elif tag == "textarea":
                name = attr_dict.get("name")
                if name:
                    self._current_form["inputs"][name] = ""
            elif tag == "button":
                b_name = attr_dict.get("name")
                b_val = attr_dict.get("value", "")
                self._current_form["buttons"].append({"name": b_name, "value": b_val})

    def handle_endtag(self, tag):
        if tag == "form":
            self._current_form = None
        elif tag == "select":
            self._current_select = None


def extract_forms(html_content):
    if isinstance(html_content, bytes):
        html_content = html_content.decode("utf-8", errors="replace")
    parser = HtmlFormParser()
    parser.feed(html_content)
    return parser.forms


def submit_parsed_form(client, form, overrides=None, button_index=0):
    data = dict(form["inputs"])
    if overrides:
        data.update(overrides)
    if form["buttons"] and button_index < len(form["buttons"]):
        btn = form["buttons"][button_index]
        if btn["name"]:
            data[btn["name"]] = btn["value"]

    method = form["method"].lower()
    action = form["action"]
    func = getattr(client, method)
    res = func(action, data=data, follow_redirects=True)
    assert b"Unknown action" not in res.data, f"Response contains 'Unknown action': {res.data}"
    return res


def test_html_patient_self_signup_is_instant_without_auditor(client):
    # 1. Fetch the public /signup page and submit exactly what a browser would (patient is the default type)
    signup_page = client.get("/signup")
    assert signup_page.status_code == 200
    signup_form = [f for f in extract_forms(signup_page.data) if f["action"] == "/signup"][0]
    assert signup_form["inputs"].get("signup_type") == "patient"

    res = submit_parsed_form(
        client,
        signup_form,
        overrides={
            "full_name": "Bob Mathew (fake)",
            "email": "Bob.Mathew@Example.com",
            "dob": "1992-05-17",
            "password": "Password1234!",
            "confirm_password": "Password1234!",
        },
    )
    assert res.status_code == 200
    assert b"Account created" in res.data
    # Lands directly in the portal: no auditor approval needed
    assert b"Welcome, Bob Mathew (fake)" in res.data
    with client.session_transaction() as sess:
        assert sess.get("role") == "patient"
        assert sess.get("u") == "bob_mathew"

    with app.app.app_context():
        u = app.db().execute("SELECT * FROM users WHERE username='bob_mathew'").fetchone()
        assert u["status"] == "approved"
        assert u["role"] == "patient"
        assert u["email"] == "bob.mathew@example.com"
        p = app.db().execute("SELECT * FROM patients WHERE id=?", (u["patient_id"],)).fetchone()
        assert p["name"] == "Bob Mathew (fake)"
        assert p["dob"] == "1992-05-17"
        assert p["mrn"].startswith("MRN-")
        assert p["mrn"].encode() in res.data
        # Audit detail must not contain the patient's name
        a = app.db().execute("SELECT detail FROM audit WHERE action='patient_self_signup'").fetchone()
        assert "Bob" not in a["detail"] and p["mrn"] in a["detail"]

    # 2. Patient can only reach their own data, never staff routes
    assert client.get("/portal").status_code == 200
    assert client.get("/patients").status_code == 403
    assert client.get("/portal/documents/1").status_code == 404

    # 3. Logout then log back in with EMAIL at /patient-login
    client.post("/logout", data={"csrf": get_csrf(client)})
    login_res = client.post(
        "/patient-login",
        data={"csrf": get_csrf(client), "username": "bob.mathew@example.com", "password": "Password1234!"},
        follow_redirects=True,
    )
    assert b"Welcome, Bob Mathew (fake)" in login_res.data


def test_html_staff_signup_and_decline(client):
    # Fetch /signup and submit staff signup
    signup_page = client.get("/signup")
    signup_form = [f for f in extract_forms(signup_page.data) if f["action"] == "/signup"][0]
    submit_parsed_form(
        client,
        signup_form,
        overrides={
            "username": "doc_declined",
            "full_name": "Declined Doctor (fake)",
            "email": "doc_declined@hospital.test",
            "password": "Password1234!",
            "confirm_password": "Password1234!",
            "signup_type": "staff",
        },
    )

    with app.app.app_context():
        u = app.db().execute("SELECT id FROM users WHERE username='doc_declined'").fetchone()
        uid = u["id"]

    # Login as auditor and decline user via parsed decline form
    login_as(client, "auditor")
    pending_page = client.get("/users?tab=pending")
    decline_form = [f for f in extract_forms(pending_page.data) if f"/users/{uid}/decline" in f["action"]][0]

    decline_res = submit_parsed_form(client, decline_form)
    assert decline_res.status_code == 200
    assert b"declined" in decline_res.data
    assert b"Unknown action" not in decline_res.data

    with app.app.app_context():
        u_check = app.db().execute("SELECT status FROM users WHERE id=?", (uid,)).fetchone()
        assert u_check["status"] == "declined"


def test_html_auditor_role_update(client):
    login_as(client, "auditor")
    active_page = client.get("/users?tab=active")
    with app.app.app_context():
        clerk = app.db().execute("SELECT id FROM users WHERE username='clerk'").fetchone()
        clerk_id = clerk["id"]

    # Find the role update form for clerk
    role_form = [f for f in extract_forms(active_page.data) if f"/users/{clerk_id}/role" in f["action"]][0]
    res = submit_parsed_form(client, role_form, overrides={"role": "doctor"})
    assert res.status_code == 200
    assert b"updated to doctor" in res.data
    assert b"Unknown action" not in res.data

    with app.app.app_context():
        c_check = app.db().execute("SELECT role FROM users WHERE id=?", (clerk_id,)).fetchone()
        assert c_check["role"] == "doctor"


def test_html_auditor_force_logout(client):
    login_as(client, "auditor")
    active_page = client.get("/users?tab=active")
    with app.app.app_context():
        clerk = app.db().execute("SELECT id, session_version FROM users WHERE username='clerk'").fetchone()
        clerk_id = clerk["id"]
        v_before = clerk["session_version"] or 0

    force_logout_form = [f for f in extract_forms(active_page.data) if f"/users/{clerk_id}/force-logout" in f["action"]][0]
    res = submit_parsed_form(client, force_logout_form)
    assert res.status_code == 200
    assert b"logged out immediately" in res.data
    assert b"Unknown action" not in res.data

    with app.app.app_context():
        c_check = app.db().execute("SELECT session_version FROM users WHERE id=?", (clerk_id,)).fetchone()
        assert c_check["session_version"] == v_before + 1


def test_html_auditor_reset_password(client):
    login_as(client, "auditor")
    active_page = client.get("/users?tab=active")
    with app.app.app_context():
        doc = app.db().execute("SELECT id FROM users WHERE username='doctor'").fetchone()
        doc_id = doc["id"]

    reset_form = [f for f in extract_forms(active_page.data) if f"/users/{doc_id}/reset-password" in f["action"]][0]
    res = submit_parsed_form(client, reset_form)
    assert res.status_code == 200
    assert b"Password Reset" in res.data
    assert b"Unknown action" not in res.data

    with app.app.app_context():
        doc_check = app.db().execute("SELECT must_change_password FROM users WHERE id=?", (doc_id,)).fetchone()
        assert doc_check["must_change_password"] == 1


def test_html_auditor_disable_and_enable(client):
    login_as(client, "auditor")
    active_page = client.get("/users?tab=active")
    with app.app.app_context():
        clerk = app.db().execute("SELECT id FROM users WHERE username='clerk'").fetchone()
        clerk_id = clerk["id"]

    # Disable clerk
    disable_form = [f for f in extract_forms(active_page.data) if f"/users/{clerk_id}/disable" in f["action"]][0]
    dis_res = submit_parsed_form(client, disable_form)
    assert dis_res.status_code == 200
    assert b"disabled" in dis_res.data
    assert b"Unknown action" not in dis_res.data

    with app.app.app_context():
        c_check = app.db().execute("SELECT status FROM users WHERE id=?", (clerk_id,)).fetchone()
        assert c_check["status"] == "disabled"

    # Enable clerk from disabled tab
    disabled_page = client.get("/users?tab=disabled")
    enable_form = [f for f in extract_forms(disabled_page.data) if f"/users/{clerk_id}/enable" in f["action"]][0]
    en_res = submit_parsed_form(client, enable_form)
    assert en_res.status_code == 200
    assert b"enabled" in en_res.data
    assert b"Unknown action" not in en_res.data

    with app.app.app_context():
        c_after = app.db().execute("SELECT status FROM users WHERE id=?", (clerk_id,)).fetchone()
        assert c_after["status"] == "approved"


def test_html_auditor_delete(client):
    with app.app.app_context():
        app.db().execute(
            "INSERT INTO users(username, pw_hash, role, status, created_at) VALUES('temp_del', 'hash', 'clerk', 'approved', '2026-11-14')"
        )
        app.db().commit()
        u = app.db().execute("SELECT id FROM users WHERE username='temp_del'").fetchone()
        uid = u["id"]

    login_as(client, "auditor")
    active_page = client.get("/users?tab=active")
    delete_form = [f for f in extract_forms(active_page.data) if f"/users/{uid}/delete" in f["action"]][0]
    del_res = submit_parsed_form(client, delete_form)
    assert del_res.status_code == 200
    assert b"deleted" in del_res.data
    assert b"Unknown action" not in del_res.data

    with app.app.app_context():
        u_check = app.db().execute("SELECT status FROM users WHERE id=?", (uid,)).fetchone()
        assert u_check["status"] == "deleted"


def test_html_auditor_create_user(client):
    login_as(client, "auditor")
    new_page = client.get("/users/new")
    assert new_page.status_code == 200
    create_form = [f for f in extract_forms(new_page.data) if f["action"] == "/users/new"][0]

    create_res = submit_parsed_form(
        client,
        create_form,
        overrides={
            "username": "html_clerk_new",
            "role": "clerk",
            "password": "Password12345!",
        },
    )
    assert create_res.status_code == 200
    assert b"html_clerk_new" in create_res.data
    assert b"Password12345!" in create_res.data
    assert b"Unknown action" not in create_res.data

    with app.app.app_context():
        u_check = app.db().execute("SELECT * FROM users WHERE username='html_clerk_new'").fetchone()
        assert u_check["status"] == "approved"
        assert u_check["role"] == "clerk"
        assert u_check["must_change_password"] == 1



# ---- Regression tests added after the November review (state guards on /users actions) ----
def _auditor_post(client, path, **data):
    data["csrf"] = get_csrf(client)
    return client.post(path, data=data, follow_redirects=True)


def _user_id(username):
    with app.app.app_context():
        return app.db().execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()["id"]


def _user_row(username):
    with app.app.app_context():
        return dict(app.db().execute("SELECT * FROM users WHERE username=?", (username,)).fetchone())


def test_role_change_to_patient_requires_a_patient_link(client):
    login_as(client, "auditor")
    res = _auditor_post(client, f"/users/{_user_id('clerk')}/role", role="patient")
    assert b"must be linked to a patient record" in res.data
    assert _user_row("clerk")["role"] == "clerk"


def test_leaving_patient_role_clears_patient_link(client):
    login_as(client, "auditor")
    assert _user_row("asha")["patient_id"] is not None
    _auditor_post(client, f"/users/{_user_id('asha')}/role", role="clerk")
    row = _user_row("asha")
    assert row["role"] == "clerk"
    assert row["patient_id"] is None


def test_deleted_user_cannot_be_reapproved_by_crafted_post(client):
    login_as(client, "auditor")
    uid = _user_id("doctor")
    _auditor_post(client, f"/users/{uid}/delete")
    assert _user_row("doctor")["status"] == "deleted"
    res = _auditor_post(client, f"/users/{uid}/approve", role="auditor")
    assert b"Cannot approve" in res.data
    row = _user_row("doctor")
    assert row["status"] == "deleted"
    assert row["role"] == "doctor"


def test_pending_user_cannot_be_disabled_or_reset(client):
    with app.app.app_context():
        app.db().execute(
            "INSERT INTO users(username, pw_hash, role, status, created_at) VALUES('pend_guard', 'x', NULL, 'pending', '2026-11-16')"
        )
        app.db().commit()
    login_as(client, "auditor")
    uid = _user_id("pend_guard")
    _auditor_post(client, f"/users/{uid}/disable")
    _auditor_post(client, f"/users/{uid}/reset-password")
    _auditor_post(client, f"/users/{uid}/force-logout")
    row = _user_row("pend_guard")
    assert row["status"] == "pending"
    assert row["must_change_password"] in (0, None)


# ---- Self-service signup, email login, Google sign-in, UI assets (v2) ----
def _patient_signup(client, **overrides):
    data = {
        "csrf": get_csrf(client),
        "signup_type": "patient",
        "full_name": "Neha Rao (fake)",
        "email": "neha@example.com",
        "dob": "1995-01-20",
        "password": "Password1234!",
        "confirm_password": "Password1234!",
    }
    data.update(overrides)
    return client.post("/signup", data=data)


def test_signup_validation_errors(client):
    future = (datetime.date.today() + datetime.timedelta(days=2)).isoformat()
    res = _patient_signup(client, email="not-an-email", dob=future, password="short", confirm_password="short", full_name="")
    assert res.status_code == 422
    assert b"valid email" in res.data
    assert b"Date of birth must be today or earlier" in res.data
    assert b"at least 10 characters" in res.data
    assert b"full name" in res.data
    res2 = _patient_signup(client, confirm_password="Different1234!")
    assert res2.status_code == 422 and b"Passwords do not match" in res2.data
    with app.app.app_context():
        assert app.db().execute("SELECT COUNT(*) c FROM users WHERE email='neha@example.com'").fetchone()["c"] == 0


def test_duplicate_email_and_username_rejected(client):
    assert _patient_signup(client).status_code == 302
    client.post("/logout", data={"csrf": get_csrf(client)})
    res = _patient_signup(client, email="NEHA@example.com")
    assert res.status_code == 422 and b"already exists" in res.data
    res2 = _patient_signup(client, email="other@example.com", username="clerk")
    assert res2.status_code == 422 and b"already taken" in res2.data


def test_self_signup_mrns_are_unique_and_portal_isolated(client):
    _patient_signup(client)
    client.post("/logout", data={"csrf": get_csrf(client)})
    _patient_signup(client, email="second@example.com", full_name="Second Person (fake)")
    with app.app.app_context():
        rows = app.db().execute(
            "SELECT p.mrn FROM users u JOIN patients p ON p.id=u.patient_id WHERE u.email IN ('neha@example.com','second@example.com')"
        ).fetchall()
        mrns = [r["mrn"] for r in rows]
        assert len(mrns) == 2 and len(set(mrns)) == 2
    page = client.get("/portal")
    assert b"Second Person" in page.data and b"Neha Rao" not in page.data


def test_staff_login_by_email_and_patient_blocked_on_staff_login(client):
    with app.app.app_context():
        app.db().execute("UPDATE users SET email='doc@hospital.test' WHERE username='doctor'")
        app.db().commit()
    res = login_as(client, "DOC@hospital.test")
    with client.session_transaction() as sess:
        assert sess.get("u") == "doctor"
    _ = res
    with client.session_transaction() as sess:
        sess.clear()
    _patient_signup(client)
    client.post("/logout", data={"csrf": get_csrf(client)})
    r = client.post("/login", data={"csrf": get_csrf(client), "username": "neha@example.com", "password": "Password1234!"})
    assert b"Wrong username or password" in r.data


def test_pending_staff_request_cannot_login_by_email(client):
    staff_signup(client, "pending_nurse", "pending.nurse@hospital.test")
    r = client.post("/login", data={"csrf": get_csrf(client), "username": "pending.nurse@hospital.test", "password": "Password1234!"})
    assert b"pending approval" in r.data
    with client.session_transaction() as sess:
        assert sess.get("u") is None


def test_google_not_configured_shows_message(client, monkeypatch):
    monkeypatch.delenv("GOOGLE_CLIENT_ID", raising=False)
    monkeypatch.delenv("GOOGLE_CLIENT_SECRET", raising=False)
    r = client.get("/auth/google?from=signup", follow_redirects=True)
    assert r.status_code == 200
    assert b"Google sign-in is not configured" in r.data


def _google_env(monkeypatch, info):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "test-client.apps.googleusercontent.com")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "test-secret")
    monkeypatch.setattr(app, "http_post_form", lambda url, fields: {"access_token": "tok"})
    monkeypatch.setattr(app, "http_get_json", lambda url, bearer: info)


def _google_roundtrip(client):
    start = client.get("/auth/google?from=patient")
    assert start.status_code == 302
    assert start.headers["Location"].startswith("https://accounts.google.com/")
    with client.session_transaction() as sess:
        state = sess["oauth_state"]
    return client.get(f"/auth/google/callback?state={state}&code=abc", follow_redirects=True)


def test_google_signup_creates_instant_patient_then_relogin(client, monkeypatch):
    _google_env(monkeypatch, {"sub": "g-123", "email": "Gina@Gmail.com", "email_verified": True, "name": "Gina Lee (fake)"})
    r = _google_roundtrip(client)
    assert r.status_code == 200
    assert b"My profile" in r.data  # redirected to complete profile
    with app.app.app_context():
        u = app.db().execute("SELECT * FROM users WHERE google_sub='g-123'").fetchone()
        assert u["role"] == "patient" and u["status"] == "approved"
        assert u["email"] == "gina@gmail.com" and u["password_set"] == 0
    # Complete profile (DOB)
    pr = client.post("/portal/profile", data={"csrf": get_csrf(client), "dob": "1990-02-02"}, follow_redirects=True)
    assert b"Profile updated" in pr.data and b"1990-02-02" in pr.data
    # Google user can set a password without knowing a current one
    pw = client.post(
        "/account/password",
        data={"csrf": get_csrf(client), "new_password": "BrandNewPass123!", "confirm_password": "BrandNewPass123!"},
        follow_redirects=True,
    )
    assert b"Password updated successfully" in pw.data
    # Second Google login reuses the same account
    with client.session_transaction() as sess:
        sess.clear()
    r2 = _google_roundtrip(client)
    assert b"Welcome back" in r2.data
    with app.app.app_context():
        assert app.db().execute("SELECT COUNT(*) c FROM users WHERE google_sub='g-123'").fetchone()["c"] == 1


def test_google_links_existing_staff_by_email(client, monkeypatch):
    with app.app.app_context():
        app.db().execute("UPDATE users SET email='clerk@hospital.test' WHERE username='clerk'")
        app.db().commit()
    _google_env(monkeypatch, {"sub": "g-clerk", "email": "clerk@hospital.test", "email_verified": True, "name": "Clerk"})
    _google_roundtrip(client)
    with client.session_transaction() as sess:
        assert sess.get("u") == "clerk" and sess.get("role") == "clerk"


def test_google_rejects_bad_state_and_unverified_email(client, monkeypatch):
    _google_env(monkeypatch, {"sub": "g-x", "email": "x@example.com", "email_verified": False})
    client.get("/auth/google")
    bad = client.get("/auth/google/callback?state=wrong&code=abc", follow_redirects=True)
    assert b"expired or was tampered" in bad.data
    r = _google_roundtrip(client)
    assert b"must be verified" in r.data
    with app.app.app_context():
        assert app.db().execute("SELECT 1 FROM users WHERE google_sub='g-x'").fetchone() is None


def test_google_blocks_disabled_account(client, monkeypatch):
    with app.app.app_context():
        app.db().execute("UPDATE users SET email='doc@h.test', status='disabled' WHERE username='doctor'")
        app.db().commit()
    _google_env(monkeypatch, {"sub": "g-doc", "email": "doc@h.test", "email_verified": True})
    r = _google_roundtrip(client)
    assert b"has been disabled" in r.data
    with client.session_transaction() as sess:
        assert sess.get("u") is None


def test_profile_dob_cannot_be_overwritten(client):
    _patient_signup(client)
    r = client.post("/portal/profile", data={"csrf": get_csrf(client), "dob": "2000-01-01"}, follow_redirects=True)
    assert b"already on file" in r.data
    with app.app.app_context():
        assert app.db().execute("SELECT dob FROM patients WHERE name='Neha Rao (fake)'").fetchone()["dob"] == "1995-01-20"


def test_landing_page_and_local_bootstrap_assets(client):
    home = client.get("/")
    assert home.status_code == 200
    assert b"Create free account" in home.data
    assert b"vendor/bootstrap/bootstrap.min.css" in home.data
    assert b"cdn." not in home.data  # zero external CDNs
    for path in (
        "/static/vendor/bootstrap/bootstrap.min.css",
        "/static/vendor/bootstrap/bootstrap.bundle.min.js",
        "/static/vendor/bootstrap-icons/bootstrap-icons.min.css",
        "/static/js/app.js",
        "/static/css/app.css",
        "/static/img/hero.png",
    ):
        assert client.get(path).status_code == 200, path


def test_security_headers_and_cookie_flags(client):
    r = client.get("/login")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["Cache-Control"] == "no-store"
    assert r.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert app.app.config["SESSION_COOKIE_HTTPONLY"] is True
    assert app.app.config["SESSION_COOKIE_SAMESITE"] == "Lax"


def test_every_page_renders_for_its_role(client):
    login_as(client, "clerk")
    for p in ("/patients", "/patients/new", "/patients/1", "/account/password"):
        assert client.get(p).status_code == 200, p
    login_as(client, "doctor")
    for p in ("/patients", "/patients/1", "/documents/1/edit", "/patients/1/prescriptions/new", "/prescriptions/1/print", "/documents/1"):
        assert client.get(p).status_code == 200, p
    login_as(client, "auditor")
    for p in ("/audit", "/users", "/users?tab=active", "/users?tab=declined", "/users?tab=disabled", "/users?tab=deleted", "/users/new"):
        assert client.get(p).status_code == 200, p
    with client.session_transaction() as sess:
        sess.clear()
    client.post("/patient-login", data={"csrf": get_csrf(client), "username": "asha", "password": "Demo@1234"})
    for p in ("/portal", "/portal/profile", "/prescriptions/1/print", "/account/password"):
        assert client.get(p).status_code == 200, p
    with client.session_transaction() as sess:
        sess.clear()
    for p in ("/", "/login", "/patient-login", "/signup", "/signup?type=staff"):
        assert client.get(p).status_code == 200, p
    assert client.get("/nope").status_code == 404
