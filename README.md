# Medi Vault

A small medical-records vault web app: register patients, store documents privately, search, role-based access and an audit trail. Built as a one-month OJT learning project. **Synthetic (fake) data only.**

## Features
- Login with hashed passwords and three roles: **clerk**, **doctor**, **auditor**
- Register patients (validated, unique MRN) and search by name or MRN
- Secure upload of PDF / PNG / JPG (max 5 MB, file contents checked, random private file names)
- Protected document viewing
- Audit log of logins, failed logins, searches, views, uploads, rejected uploads and denied attempts
- CSRF protection, secrets in `.env`, seed data, one-command run

## Screenshots
_Add screenshots here: login page, patient page, audit log._

## Tech stack
Python 3.9+, Flask, SQLite, server-rendered HTML (Jinja), Werkzeug PBKDF2-SHA256 hashing.

## Setup and run
```bash
git clone https://github.com/Emon-Developer-369/Medi-Vault.git
cd Medi-Vault
sh run.sh
```
Then open **http://127.0.0.1:5001**. `run.sh` creates a virtual environment, installs Flask, creates `.env` with a random secret and starts the app. (Port 5001 is used because macOS reserves port 5000 for AirPlay.) To use another port: `PORT=8000 sh run.sh`.

## Demo logins (fake, for the demo only)
| Username | Password | Can do |
|---|---|---|
| clerk | Demo@1234 | register patients, upload, search, view |
| doctor | Demo@1234 | search and view |
| auditor | Demo@1234 | view the audit log only |

## Folder structure
```
Medi-Vault/
  app.py            # the whole app: routes, database, security checks
  run.sh            # one-command setup and start
  requirements.txt  # Flask
  .env.example      # settings template (copy to .env; .env is not committed)
  PRD.pdf           # official OJT PRD (MediVault role-based portal), signed
  IMPLEMENTATION.md # what this repo actually built vs the PRD
  CHANGELOG.md  LICENSE  .gitignore
```
Created when running: `medivault.db` (database) and `private_uploads/` (uploaded files). Both are git-ignored.

## Limitations
Learning prototype: single hospital, no OCR, no encounters, no virus scanning, no HTTPS, no login lockout. Do not use real patient data.

## Team
- Emon Kalyan
- Nikhil

## Future work
Wrong-patient warning, tamper-evident audit log, viewer watermark, multiple hospitals with data isolation, multi-factor login, encounters (OPD/IPD), OCR with human review, PostgreSQL and cloud storage, FHIR / ABDM support. See `PRD.pdf` and `IMPLEMENTATION.md`.

## License
MIT - see `LICENSE`.
