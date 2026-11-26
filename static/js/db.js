/* Medi Vault - client-side persistence, Web Crypto hashing & IndexedDB file store. */
((global) => {
  "use strict";
  const DB_KEY = "medivault_db_v1";
  const IDB_NAME = "medivault_files_v1";
  const IDB_STORE = "files";
  const memoryFiles = new Map();
  const MAGIC = { pdf: [0x25, 0x50, 0x44, 0x46, 0x2d], png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], jpg: [0xff, 0xd8, 0xff], jpeg: [0xff, 0xd8, 0xff] };

  const pad = (n) => String(n).padStart(2, "0");
  const todayIso = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const now = (d = new Date()) => `${todayIso(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const bytesToHex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
  const randomHex = (n) => bytesToHex(global.crypto.getRandomValues(new Uint8Array(n)));

  const constantTimeEqual = (a, b) => {
    if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  };

  const requireSubtle = () => {
    if (!global.crypto?.subtle) throw new Error("Web Crypto API requires HTTPS or localhost.");
    return global.crypto.subtle;
  };
  const sha256Hex = async (u8) => bytesToHex(await requireSubtle().digest("SHA-256", u8));

  const pbkdf2Hex = async (password, saltHex) => {
    const enc = new TextEncoder(), subtle = requireSubtle();
    const key = await subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    return bytesToHex(await subtle.deriveBits({ name: "PBKDF2", salt: enc.encode(saltHex), iterations: 10000, hash: "SHA-256" }, key, 256));
  };

  const hashPassword = async (password) => { const salt = randomHex(16); return `pbkdf2$${salt}$${await pbkdf2Hex(password, salt)}`; };
  const verifyPassword = async (password, stored) => {
    const parts = typeof stored === "string" ? stored.split("$") : [];
    return parts.length === 3 && parts[0] === "pbkdf2" && constantTimeEqual(await pbkdf2Hex(password, parts[1]), parts[2]);
  };

  /* IndexedDB file storage */
  const openIdb = () => new Promise((resolve, reject) => {
    if (!global.indexedDB) return reject(new Error("IndexedDB unavailable"));
    const req = global.indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE, { keyPath: "storedName" }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB error"));
  });

  const idbRun = async (mode, op) => {
    const db = await openIdb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, mode);
      const req = op(tx.objectStore(IDB_STORE));
      if (mode === "readonly") {
        req.onsuccess = () => { db.close(); resolve(req.result || null); };
        req.onerror = () => { db.close(); reject(req.error); };
      } else {
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      }
    });
  };

  const saveFile = async (storedName, bytes, mimeType) => {
    const rec = { storedName, bytes, mimeType };
    memoryFiles.set(storedName, rec);
    try { await idbRun("readwrite", (s) => s.put(rec)); } catch {}
  };

  const getFile = async (storedName) => {
    if (memoryFiles.has(storedName)) return memoryFiles.get(storedName);
    try { const r = await idbRun("readonly", (s) => s.get(storedName)); if (r) memoryFiles.set(storedName, r); return r; } catch { return null; }
  };

  const clearFiles = async () => { memoryFiles.clear(); try { await idbRun("readwrite", (s) => s.clear()); } catch {} };

  const hasMagicSignature = (bytes, ext) => {
    const sig = MAGIC[ext];
    return Boolean(sig && bytes && bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b));
  };
  const mimeForExt = (ext) => (ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : "image/jpeg");
  const sanitizeFilename = (name) => String(name || "document").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+|[._]+$/g, "") || "document";
  const generateTempPassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*";
    return Array.from(global.crypto.getRandomValues(new Uint32Array(16)), (v) => chars[v % chars.length]).join("");
  };

  const readState = () => { try { const r = localStorage.getItem(DB_KEY); return r ? JSON.parse(r) : null; } catch { return null; } };
  const writeState = (state) => localStorage.setItem(DB_KEY, JSON.stringify(state));
  const nextId = (state, table) => (state.seq[table] = (state.seq[table] || 0) + 1);

  const buildSamplePdfBytes = () => new TextEncoder().encode(
    "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 120]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n" +
    "4 0 obj<</Length 60>>stream\nBT /F1 14 Tf 20 60 Td (FAKE lab report - synthetic data) Tj ET\nendstream endobj\n" +
    "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF"
  );

  const demoUser = (id, username, role, pw_hash, ts, patient_id = null) => ({
    id, username, email: null, full_name: null, pw_hash, role, status: "approved", requested_role: null,
    claimed_mrn: null, patient_id, must_change_password: 0, session_version: 0, password_set: 1,
    created_at: ts, reviewed_by: null, reviewed_at: null
  });

  const seed = async () => {
    const ts = now(), pwHash = await hashPassword("Demo@1234"), pdfBytes = buildSamplePdfBytes();
    const pdfSha = await sha256Hex(pdfBytes), pdfStored = `${randomHex(16)}.pdf`;
    await saveFile(pdfStored, pdfBytes, "application/pdf");

    const state = {
      seq: { users: 4, patients: 3, documents: 1, document_history: 1, prescriptions: 1, login_attempts: 0, audit: 0 },
      users: [
        demoUser(1, "clerk", "clerk", pwHash, ts),
        demoUser(2, "doctor", "doctor", pwHash, ts),
        demoUser(3, "auditor", "auditor", pwHash, ts),
        demoUser(4, "asha", "patient", pwHash, ts, 1)
      ],
      patients: [
        { id: 1, mrn: "MRN-1001", name: "Asha Verma (fake)", dob: "1985-03-14", registered_on: "1985-03-14", created_by: "seed", created_at: ts },
        { id: 2, mrn: "MRN-1002", name: "Ravi Kumar (fake)", dob: "1990-07-02", registered_on: "1990-07-02", created_by: "seed", created_at: ts },
        { id: 3, mrn: "MRN-1003", name: "Meena Iyer (fake)", dob: "1978-11-23", registered_on: "1978-11-23", created_by: "seed", created_at: ts }
      ],
      documents: [{
        id: 1, patient_id: 1, title: "Sample blood test", doc_type: "Lab report", notes: "Baseline blood report on admission",
        stored_name: pdfStored, original_name: "sample.pdf", size: pdfBytes.length, sha256: pdfSha, version: 1,
        uploaded_by: "seed", created_at: ts, updated_by: null, updated_at: null
      }],
      document_history: [{
        id: 1, document_id: 1, version: 1, title: "Sample blood test", doc_type: "Lab report",
        notes: "Baseline blood report on admission", stored_name: pdfStored, sha256: pdfSha,
        changed_by: "seed", changed_at: ts, change_type: "created"
      }],
      prescriptions: [{
        id: 1, patient_id: 1, medicine: "Paracetamol", dosage: "500 mg", frequency: "Twice daily", duration: "5 days",
        instructions: "after food", status: "active", prescribed_by: "doctor", prescribed_at: ts,
        stopped_by: null, stopped_at: null, stop_reason: null
      }],
      login_attempts: [],
      audit: []
    };
    writeState(state);
    return state;
  };

  const init = async () => {
    let state = readState();
    if (!state?.users?.length) return seed();
    const sampleDoc = state.documents?.[0];
    if (sampleDoc?.uploaded_by === "seed" && !(await getFile(sampleDoc.stored_name))) {
      await saveFile(sampleDoc.stored_name, buildSamplePdfBytes(), "application/pdf");
    }
    return state;
  };

  const reset = async () => { await clearFiles(); localStorage.removeItem(DB_KEY); return seed(); };

  global.MediVaultDB = {
    init, reset, getState: readState, saveState: writeState, nextId, now, todayIso, randomHex,
    sha256Hex, hashPassword, verifyPassword, saveFile, getFile, hasMagicSignature, mimeForExt,
    sanitizeFilename, generateTempPassword
  };
})(window);
