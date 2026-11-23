#!/bin/sh
set -eu
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
. .venv/bin/activate
pip install -q -r requirements.txt

if [ ! -f .env ]; then
  cp .env.example .env
  python3 - <<'PY'
from pathlib import Path
import secrets
p = Path('.env')
s = p.read_text()
s = s.replace('replace_with_a_long_random_secret', secrets.token_hex(32))
p.write_text(s)
PY
  echo "Created .env. Add your Google OAuth Client ID and NEW Client Secret before testing Google sign-in."
fi

echo "Starting Medi Vault at http://127.0.0.1:5001"
python app.py
