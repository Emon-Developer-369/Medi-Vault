# Changelog

## 0.1.0 - 2026-10-31
### Added
- Flask app with login/logout and roles (clerk, doctor, auditor), PBKDF2-SHA256 password hashing
- Patient registration with validation and unique MRN; search by name or MRN
- Secure document upload (type, size and file-signature checks, random private names) and protected viewing
- Audit log (logins, failed logins, searches, views, uploads, rejected uploads, denied attempts)
- CSRF protection, security headers, secrets in `.env` with `.env.example`
- Seed data (3 fake patients, 1 fake report) and one-command `run.sh`
- PRD, README, MIT license

### Fixed
- Default port changed from 5000 to 5001 (macOS AirPlay uses 5000)
- Password hashing switched from scrypt to PBKDF2 for compatibility with macOS system Python 3.9
