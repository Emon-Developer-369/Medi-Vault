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

## Deploy on Render

The repository includes a root-level `render.yaml` blueprint. In Render, choose **New → Blueprint**, connect this GitHub repository, and let Render read the blueprint. It configures the Flask app's root directory, Gunicorn start command, environment variables, and a persistent disk mounted at `/var/data`.

After Render creates the service:

1. Open the service's **Environment** settings.
2. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to the OAuth credentials from Google Cloud. Do not put these values in source code or commit them.
3. Set `GOOGLE_REDIRECT_URI` to `https://YOUR-RENDER-SERVICE.onrender.com/auth/google/callback`, replacing the hostname with the exact URL Render assigned to your service.
4. In Google Cloud Console, add that exact HTTPS callback URL under **Authorized redirect URIs**. Add the production site origin under **Authorized JavaScript origins** if required by your OAuth client.
5. Save the environment variables and redeploy/restart the service.

The blueprint generates a production `SECRET_KEY`. The database and private uploaded documents are configured to use the persistent disk. Do not remove that disk or change its mount path without migrating the data first.

**Before launch:** use synthetic patient records only; verify Google sign-in, registration, login, role permissions, document upload/download, prescriptions, and audit logging on the deployed URL. A successful deployment does not by itself constitute a security or healthcare-compliance review.
