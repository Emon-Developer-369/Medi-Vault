/* Medi Vault - client-side persistence, Web Crypto hashing & IndexedDB file store.
   Replaces the Python/SQLite backend so the app runs 100% in HTML/CSS/JavaScript. */
(function (global) {
  "use strict";

  var DB_KEY = "medivault_db_v1";
  var IDB_NAME = "medivault_files_v1";
  var IDB_STORE = "files";
  var memoryFiles = new Map();

  var MAGIC = {
    pdf: [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
    png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    jpg: [0xff, 0xd8, 0xff],
    jpeg: [0xff, 0xd8, 0xff]
  };

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function now() {
    var d = new Date();
    return (
      d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
      " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds())
    );
  }

  function todayIso() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function randomHex(byteCount) {
    var arr = new Uint8Array(byteCount);
    global.crypto.getRandomValues(arr);
    var out = "";
    for (var i = 0; i < arr.length; i++) {
      out += (arr[i] < 16 ? "0" : "") + arr[i].toString(16);
    }
    return out;
  }

  function bytesToHex(buffer) {
    var bytes = new Uint8Array(buffer);
    var out = "";
    for (var i = 0; i < bytes.length; i++) {
      out += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
    }
    return out;
  }

  function constantTimeEqual(a, b) {
    if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) {
      diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
  }

  /* Pure-JS SHA-256 fallback if crypto.subtle is unavailable (e.g., insecure file:// origin) */
  function fallbackSha256(bytes) {
    var K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var bitLen = bytes.length * 8;
    var paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
    var padded = new Uint8Array(paddedLen);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    var dv = new DataView(padded.buffer);
    dv.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
    dv.setUint32(paddedLen - 4, bitLen >>> 0, false);

    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
    var w = new Uint32Array(64);
    for (var offset = 0; offset < paddedLen; offset += 64) {
      for (var i = 0; i < 16; i++) w[i] = dv.getUint32(offset + i * 4, false);
      for (var j = 16; j < 64; j++) {
        var s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
        var s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (var k = 0; k < 64; k++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ ((~e) & g);
        var temp1 = (h + S1 + ch + K[k] + w[k]) >>> 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var temp2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    return H.map(function (v) { return ("00000000" + v.toString(16)).slice(-8); }).join("");
  }

  async function sha256Hex(uint8Array) {
    if (global.crypto && global.crypto.subtle) {
      var buf = await global.crypto.subtle.digest("SHA-256", uint8Array);
      return bytesToHex(buf);
    }
    return fallbackSha256(uint8Array);
  }

  async function pbkdf2Hex(password, saltHex) {
    var enc = new TextEncoder();
    if (global.crypto && global.crypto.subtle) {
      var key = await global.crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
      var bits = await global.crypto.subtle.deriveBits(
        { name: "PBKDF2", salt: enc.encode(saltHex), iterations: 10000, hash: "SHA-256" },
        key,
        256
      );
      return bytesToHex(bits);
    }
    return fallbackSha256(enc.encode(saltHex + ":" + password));
  }

  async function hashPassword(password) {
    var salt = randomHex(16);
    var derived = await pbkdf2Hex(password, salt);
    return "pbkdf2$" + salt + "$" + derived;
  }

  async function verifyPassword(password, storedHash) {
    if (!storedHash || typeof storedHash !== "string") return false;
    var parts = storedHash.split("$");
    if (parts.length !== 3 || parts[0] !== "pbkdf2") return false;
    var derived = await pbkdf2Hex(password, parts[1]);
    return constantTimeEqual(derived, parts[2]);
  }

  /* IndexedDB file storage */
  function openIdb() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      var req = global.indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: "storedName" });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error("IndexedDB error")); };
    });
  }

  async function saveFile(storedName, bytes, mimeType) {
    memoryFiles.set(storedName, { storedName: storedName, bytes: bytes, mimeType: mimeType });
    try {
      var db = await openIdb();
      await new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put({ storedName: storedName, bytes: bytes, mimeType: mimeType });
        tx.oncomplete = function () { db.close(); resolve(); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      });
    } catch (e) {
      /* memory fallback already populated */
    }
  }

  async function getFile(storedName) {
    if (memoryFiles.has(storedName)) return memoryFiles.get(storedName);
    try {
      var db = await openIdb();
      var record = await new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, "readonly");
        var req = tx.objectStore(IDB_STORE).get(storedName);
        req.onsuccess = function () { db.close(); resolve(req.result || null); };
        req.onerror = function () { db.close(); reject(req.error); };
      });
      if (record) memoryFiles.set(storedName, record);
      return record;
    } catch (e) {
      return null;
    }
  }

  async function clearFiles() {
    memoryFiles.clear();
    try {
      var db = await openIdb();
      await new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).clear();
        tx.oncomplete = function () { db.close(); resolve(); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      });
    } catch (e) {
      /* ignore */
    }
  }

  function hasMagicSignature(bytes, ext) {
    var sig = MAGIC[ext];
    if (!sig || !bytes || bytes.length < sig.length) return false;
    for (var i = 0; i < sig.length; i++) {
      if (bytes[i] !== sig[i]) return false;
    }
    return true;
  }

  function mimeForExt(ext) {
    if (ext === "pdf") return "application/pdf";
    if (ext === "png") return "image/png";
    return "image/jpeg";
  }

  function sanitizeFilename(name) {
    var cleaned = String(name || "document")
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/^[._]+|[._]+$/g, "");
    return cleaned || "document";
  }

  function generateTempPassword() {
    var alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*";
    var arr = new Uint32Array(16);
    global.crypto.getRandomValues(arr);
    var pw = "";
    for (var i = 0; i < arr.length; i++) {
      pw += alphabet[arr[i] % alphabet.length];
    }
    return pw;
  }

  function readState() {
    try {
      var raw = localStorage.getItem(DB_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeState(state) {
    localStorage.setItem(DB_KEY, JSON.stringify(state));
  }

  function nextId(state, table) {
    state.seq[table] = (state.seq[table] || 0) + 1;
    return state.seq[table];
  }

  function buildSamplePdfBytes() {
    var text =
      "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
      "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 120]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n" +
      "4 0 obj<</Length 60>>stream\nBT /F1 14 Tf 20 60 Td (FAKE lab report - synthetic data) Tj ET\nendstream endobj\n" +
      "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF";
    return new TextEncoder().encode(text);
  }

  async function seed() {
    var ts = now();
    var demoPwHash = await hashPassword("Demo@1234");
    var pdfBytes = buildSamplePdfBytes();
    var pdfSha = await sha256Hex(pdfBytes);
    var pdfStored = randomHex(16) + ".pdf";
    await saveFile(pdfStored, pdfBytes, "application/pdf");

    var state = {
      seq: { users: 4, patients: 3, documents: 1, document_history: 1, prescriptions: 1, login_attempts: 0, audit: 0 },
      users: [
        {
          id: 1, username: "clerk", email: null, full_name: null, pw_hash: demoPwHash,
          role: "clerk", status: "approved", requested_role: null, claimed_mrn: null, patient_id: null,
          must_change_password: 0, session_version: 0, password_set: 1, created_at: ts, reviewed_by: null, reviewed_at: null
        },
        {
          id: 2, username: "doctor", email: null, full_name: null, pw_hash: demoPwHash,
          role: "doctor", status: "approved", requested_role: null, claimed_mrn: null, patient_id: null,
          must_change_password: 0, session_version: 0, password_set: 1, created_at: ts, reviewed_by: null, reviewed_at: null
        },
        {
          id: 3, username: "auditor", email: null, full_name: null, pw_hash: demoPwHash,
          role: "auditor", status: "approved", requested_role: null, claimed_mrn: null, patient_id: null,
          must_change_password: 0, session_version: 0, password_set: 1, created_at: ts, reviewed_by: null, reviewed_at: null
        },
        {
          id: 4, username: "asha", email: null, full_name: null, pw_hash: demoPwHash,
          role: "patient", status: "approved", requested_role: null, claimed_mrn: null, patient_id: 1,
          must_change_password: 0, session_version: 0, password_set: 1, created_at: ts, reviewed_by: null, reviewed_at: null
        }
      ],
      patients: [
        { id: 1, mrn: "MRN-1001", name: "Asha Verma (fake)", dob: "1985-03-14", registered_on: "1985-03-14", created_by: "seed", created_at: ts },
        { id: 2, mrn: "MRN-1002", name: "Ravi Kumar (fake)", dob: "1990-07-02", registered_on: "1990-07-02", created_by: "seed", created_at: ts },
        { id: 3, mrn: "MRN-1003", name: "Meena Iyer (fake)", dob: "1978-11-23", registered_on: "1978-11-23", created_by: "seed", created_at: ts }
      ],
      documents: [
        {
          id: 1, patient_id: 1, title: "Sample blood test", doc_type: "Lab report",
          notes: "Baseline blood report on admission", stored_name: pdfStored, original_name: "sample.pdf",
          size: pdfBytes.length, sha256: pdfSha, version: 1, uploaded_by: "seed", created_at: ts,
          updated_by: null, updated_at: null
        }
      ],
      document_history: [
        {
          id: 1, document_id: 1, version: 1, title: "Sample blood test", doc_type: "Lab report",
          notes: "Baseline blood report on admission", stored_name: pdfStored, sha256: pdfSha,
          changed_by: "seed", changed_at: ts, change_type: "created"
        }
      ],
      prescriptions: [
        {
          id: 1, patient_id: 1, medicine: "Paracetamol", dosage: "500 mg", frequency: "Twice daily",
          duration: "5 days", instructions: "after food", status: "active",
          prescribed_by: "doctor", prescribed_at: ts, stopped_by: null, stopped_at: null, stop_reason: null
        }
      ],
      login_attempts: [],
      audit: []
    };

    writeState(state);
    return state;
  }

  async function init() {
    var state = readState();
    if (!state || !Array.isArray(state.users) || state.users.length === 0) {
      state = await seed();
    } else {
      // Ensure sample seeded PDF exists in IndexedDB (e.g. if storage cleared partially)
      var sampleDoc = state.documents && state.documents[0];
      if (sampleDoc && sampleDoc.uploaded_by === "seed") {
        var existingFile = await getFile(sampleDoc.stored_name);
        if (!existingFile) {
          await saveFile(sampleDoc.stored_name, buildSamplePdfBytes(), "application/pdf");
        }
      }
    }
    return state;
  }

  async function reset() {
    await clearFiles();
    localStorage.removeItem(DB_KEY);
    return seed();
  }

  global.MediVaultDB = {
    init: init,
    reset: reset,
    getState: function () { return readState(); },
    saveState: writeState,
    nextId: nextId,
    now: now,
    todayIso: todayIso,
    randomHex: randomHex,
    sha256Hex: sha256Hex,
    hashPassword: hashPassword,
    verifyPassword: verifyPassword,
    saveFile: saveFile,
    getFile: getFile,
    hasMagicSignature: hasMagicSignature,
    mimeForExt: mimeForExt,
    sanitizeFilename: sanitizeFilename,
    generateTempPassword: generateTempPassword
  };
})(window);
