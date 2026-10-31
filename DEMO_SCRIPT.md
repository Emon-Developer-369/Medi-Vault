# Medi Vault - Demo Video Script (about 4 minutes)

Read the **bold quotes** aloud. The lines starting with CLICK are actions. Speak slowly. If you make a mistake, pause 3 seconds and repeat the sentence; you can trim it later.

## Before you record
- Run `./run.sh`, open http://127.0.0.1:5001 in a clean browser window (no other tabs), zoom 125%.
- Delete `medivault.db` and the `private_uploads` folder, then start the app again, so only the seed data exists.
- Have a small fake PDF on the Desktop (`fake_report.pdf`) and a fake file made with: `echo "not a pdf" > ~/Desktop/fake.pdf`
- Notifications off, WhatsApp and Mail closed, screen 1920x1080, microphone tested.

## 1. Intro (about 30 seconds)
**"Hello, I am Emon Kalyan, and this is our OJT project, Medi Vault. Hospitals keep patient reports in many places, and finding one report can take a long time. It is also hard to know who has seen a sensitive record. Medi Vault is a small web app where authorised staff can register patients, store documents privately, search, and keep an audit trail. Everything in this demo is fake data."**

## 2. Login as clerk (20 seconds)
CLICK: show the login page. Type `clerk` and `Demo@1234`, click Login.
**"The app has three roles: clerk, doctor and auditor. I am logging in as a records clerk. Passwords are stored as hashes, not as plain text."**

## 3. Register a patient (30 seconds)
CLICK: in Register patient, type "Demo Patient (fake)", MRN `MRN-2001`, pick a date, click Register.
**"I register a new patient. The app checks the name, the medical record number and the date of birth before saving."**

## 4. Upload and rejection (50 seconds)
CLICK: click the new patient. Title "Blood test", type Lab report, choose `fake_report.pdf`, click Upload.
**"Now I upload a lab report. It appears in the patient's document list."**
CLICK: upload `fake.pdf` (the fake file).
**"Here I try a fake file that is only named dot pdf. The app checks the real file content, so it rejects it. Files are also limited to five megabytes and are stored under random names in a private folder."**

## 5. Search and open (30 seconds)
CLICK: Patients, type `Asha` in search, click Search, open the patient, click Open on the sample report.
**"I can search by name or record number. The document opens only because I am logged in with the right role."**

## 6. Doctor role (20 seconds)
CLICK: Logout, login as `doctor`, open a patient.
**"Now I am a doctor. I can search and read documents, but there are no register or upload forms. A doctor does not need them."**

## 7. Wrong password and denied access (30 seconds)
CLICK: Logout. Try `clerk` with a wrong password once. Then login as `auditor`. In the address bar type `127.0.0.1:5001/patients` and press Enter.
**"A wrong password is refused. Now I am the auditor. If I try to open patient records, the server blocks me with a 403 page. This check happens on the server, not just by hiding buttons."**

## 8. Audit log (30 seconds)
CLICK: go to Audit log.
**"Here is the audit log. It shows logins, the failed login, the search, the upload, the rejected file, and the access attempt that was denied. This helps a hospital find misuse."**

## 9. Closing (30 seconds)
**"So far we built login with roles, patient registration, secure uploads, search, and an audit log. It is a prototype, so it does not have OCR, multiple hospitals, or multi-factor login yet. Next we want to add a wrong-patient warning, a tamper-proof audit log, and OCR with human review. Thank you for watching."**
