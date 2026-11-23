# Medi Vault (Flask)

Medi Vault is a student/demo Flask application for patient records, documents, prescriptions, staff roles, and audit logging. It includes Google OpenID Connect sign-in.

## Run locally

Requirements: Python 3.10+ and a terminal.

1. Open this folder in Terminal.
2. Run `./run.sh`.
3. Visit `http://127.0.0.1:5001`.

The local development database is created automatically and includes clearly synthetic demo accounts and records. The default local demo password is intended only for local testing. Never reuse it online.

## Google sign-in (local)

In Google Cloud Console, open **Google Auth Platform → Clients** and edit your Web application OAuth client.

Add these local origins:
- `http://127.0.0.1:5001`
- `http://localhost:5001`

Add this local redirect URI:
- `http://127.0.0.1:5001/auth/google/callback`

Copy `.env.example` to `.env` (the local `run.sh` does this automatically). Set `GOOGLE_CLIENT_ID` and a newly rotated `GOOGLE_CLIENT_SECRET`. A previously exposed secret must be revoked. Keep `GOOGLE_REDIRECT_URI` set to the exact local callback above. If Google's consent screen is in Testing mode, add your Google account as a test user.

## Deploy free on Render

The repository's root `render.yaml` is configured for a **free Render web service**. In Render:

1. Choose **New → Blueprint**.
2. Connect `Emon-Developer-369/Medi-Vault` and select the `main` branch after the deployment configuration PR is merged.
3. Render reads `render.yaml`. Confirm the service plan is **Free**.
4. When prompted for sync:false variables, set:
   - `BOOTSTRAP_AUDITOR_USERNAME`: choose a new username (3–32 letters, numbers, dots, underscores, or hyphens).
   - `BOOTSTRAP_AUDITOR_PASSWORD`: create a unique password of at least 16 characters. Do not reuse another password.
   - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: use your Google Web OAuth client credentials.
   - `GOOGLE_REDIRECT_URI`: leave this for the next step if you do not yet know the Render hostname.
5. After Render assigns the service URL, set `GOOGLE_REDIRECT_URI` to `https://YOUR-SERVICE.onrender.com/auth/google/callback` using the exact hostname.
6. In Google Cloud Console, add that exact HTTPS URL under **Authorized redirect URIs**. Add `https://YOUR-SERVICE.onrender.com` under **Authorized JavaScript origins** if requested.
7. Save the environment variables and redeploy.

The Blueprint generates `SECRET_KEY` automatically. In production, sample accounts and sample patient records are not seeded. The first configured auditor account is created with the bootstrap credentials and must change its password after first login. Use that auditor account to create staff demo accounts.

## Free-plan limitations and safety

- Render free web services sleep after 15 minutes without traffic and may take about a minute to wake.
- The filesystem is temporary. SQLite data and uploaded documents can disappear after sleep, restart, or redeploy. This Blueprint intentionally has no persistent disk.
- Use only fake/synthetic patient information. Do not upload real medical records or rely on this demo for healthcare operations.
- This is a student prototype, not a production-ready or compliance-reviewed medical records service.
- Never commit `.env`, OAuth secrets, database files, or uploaded documents.
