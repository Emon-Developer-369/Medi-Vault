# Medi Vault (Flask)

Medi Vault is a Flask application for patient records, documents, prescriptions, staff roles, and audit logging. The included Google OAuth flow uses Google's OpenID Connect endpoints and the Flask callback route documented below.

## Run locally

Requirements: Python 3.10+ and a terminal.

1. Extract this ZIP.
2. In a terminal, enter the project folder.
3. Run `./run.sh` (or follow the manual setup below).
4. Open `http://127.0.0.1:5001`.

The app creates its SQLite database automatically on startup. The database and private uploaded documents from the previous working copy are intentionally not included in this source ZIP; this prevents accidentally distributing patient records or uploaded files. A fresh database is created when you run the app.

## Enable Google sign-in

In Google Cloud Console, select the **Medi Vault** project and open **Google Auth Platform → Clients**. Edit your Web application OAuth client.

**Authorized JavaScript origins** (for local development):

- `http://127.0.0.1:5001`
- `http://localhost:5001`

**Authorized redirect URI** (must match exactly):

- `http://127.0.0.1:5001/auth/google/callback`

Save the OAuth client. If the OAuth consent screen is in Testing mode, add the Google account you will use under **Audience → Test users**.

Then copy `.env.example` to `.env` (the `run.sh` script does this automatically on first run) and set:

- `GOOGLE_CLIENT_ID` to the Client ID shown in Google Cloud.
- `GOOGLE_CLIENT_SECRET` to a **newly rotated** Client Secret. The earlier secret was visible in a screenshot and should be considered compromised; revoke it after the new secret is configured and tested.
- Keep `GOOGLE_REDIRECT_URI` exactly as shown above for local testing.
- Keep `SECRET_KEY` as a long, random value. `run.sh` generates one automatically when it first creates `.env`.

Restart the Flask server after editing `.env`, then visit `http://127.0.0.1:5001/patient-login` and choose **Continue with Google**. Google sign-in cannot work until valid credentials are entered in `.env`.

## Manual setup (optional)

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python app.py
```

Edit `.env` before testing Google sign-in.

## Important security notes

- Never share `.env`, OAuth Client Secrets, database files, or `private_uploads/`.
- Do not commit real patient information. Use synthetic data for demos.
- The local redirect URI above is for local development only. For a deployed site, use HTTPS and add the exact production origin and callback URL to Google Cloud Console and the server environment.
- This student/demo project should not be used to store real medical records without a proper security, privacy, legal, and operational review.
