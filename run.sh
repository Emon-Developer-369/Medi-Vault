#!/bin/sh
cd "$(dirname "$0")"
[ -d .venv ] || python3 -m venv .venv
. .venv/bin/activate
pip install -q -r requirements.txt
[ -f .env ] || printf "SECRET_KEY=%s\nDEMO_PASSWORD=Demo@1234\n" "$(python3 -c 'import secrets;print(secrets.token_hex(32))')" > .env
echo "Open http://127.0.0.1:5001  (logins: clerk / doctor / auditor, password Demo@1234)"
python app.py
