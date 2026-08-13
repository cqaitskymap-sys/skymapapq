/**
 * Creates the default Super Admin in Firebase Auth + Firestore profile.
 * Run once: npm run setup:admin
 *
 * Requires:
 *   DEFAULT_ADMIN_PASSWORD  (required — no default)
 *   DEFAULT_ADMIN_EMAIL     (optional, default admin@apq-skymap.com)
 *   Service account for privileged writes:
 *     GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
 *     or place serviceAccountKey.json in the project root
 *
 * Client ID tokens cannot elevate role/is_active under firestore.rules.
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const DEFAULT_EMAIL = process.env.DEFAULT_ADMIN_EMAIL || 'admin@apq-skymap.com';
const DEFAULT_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD || '';
const DEFAULT_NAME = 'Super Admin';

function loadEnv() {
  const envPath = resolve(root, '.env.local');
  if (!existsSync(envPath)) {
    console.error('Missing .env.local — add Firebase NEXT_PUBLIC_* variables first.');
    process.exit(1);
  }
  const vars = {};
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    vars[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return vars;
}

function resolveServiceAccountPath() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }
  const candidates = [
    resolve(root, 'serviceAccountKey.json'),
    resolve(root, 'service-account.json'),
    resolve(root, 'firebase-service-account.json'),
  ];
  return candidates.find((path) => existsSync(path)) || null;
}

async function loadFirebaseAdmin(projectId) {
  const adminPath = resolve(root, 'functions/node_modules/firebase-admin');
  if (!existsSync(adminPath)) {
    throw new Error(
      'firebase-admin not found. Run: npm --prefix functions install',
    );
  }
  const admin = require(adminPath);
  if (admin.apps.length) return admin;

  const saPath = resolveServiceAccountPath();
  if (saPath) {
    const credential = admin.credential.cert(JSON.parse(readFileSync(saPath, 'utf8')));
    admin.initializeApp({ credential, projectId });
  } else {
    try {
      admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId });
    } catch {
      throw new Error(
        'No service account found. Set GOOGLE_APPLICATION_CREDENTIALS or add serviceAccountKey.json to the project root. '
        + 'Client tokens cannot create super_admin under current Firestore rules.',
      );
    }
  }
  return admin;
}

async function ensureAuthAndProfile(admin) {
  const auth = admin.auth();
  const db = admin.firestore();
  let user;
  try {
    user = await auth.getUserByEmail(DEFAULT_EMAIL);
    console.log('Firebase Auth user already exists:', DEFAULT_EMAIL);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
    user = await auth.createUser({
      email: DEFAULT_EMAIL,
      password: DEFAULT_PASSWORD,
      displayName: DEFAULT_NAME,
      emailVerified: true,
      disabled: false,
    });
    console.log('Created Firebase Auth user:', DEFAULT_EMAIL);
  }

  await auth.setCustomUserClaims(user.uid, { role: 'super_admin', active: true });

  const now = new Date().toISOString();
  const profileRef = db.collection('profiles').doc(user.uid);
  const userRef = db.collection('users').doc(user.uid);
  await profileRef.set({
    id: user.uid,
    email: DEFAULT_EMAIL,
    full_name: DEFAULT_NAME,
    role: 'super_admin',
    department: 'QA',
    employee_id: 'EMP001',
    phone: '',
    avatar_url: '',
    is_active: true,
    access_status: 'approved',
    last_login: null,
    created_at: now,
    updated_at: now,
  }, { merge: true });

  await userRef.set({
    authUid: user.uid,
    email: DEFAULT_EMAIL,
    fullName: DEFAULT_NAME,
    role: 'super_admin',
    employeeId: 'EMP001',
    department: 'QA',
    userStatus: 'Active',
    status: 'Active',
    accountLocked: false,
    isDeleted: false,
    createdAt: now,
    updatedAt: now,
  }, { merge: true });

  console.log('Upserted Firestore profile + user master with role: super_admin');
  return user.uid;
}

async function main() {
  if (!DEFAULT_PASSWORD) {
    console.error('DEFAULT_ADMIN_PASSWORD is required. Example:');
    console.error('  $env:DEFAULT_ADMIN_PASSWORD="YourStrongPass!1"; npm run setup:admin');
    process.exit(1);
  }
  if (
    DEFAULT_PASSWORD.length < 12
    || !/[A-Z]/.test(DEFAULT_PASSWORD)
    || !/[a-z]/.test(DEFAULT_PASSWORD)
    || !/\d/.test(DEFAULT_PASSWORD)
    || !/[^A-Za-z0-9]/.test(DEFAULT_PASSWORD)
  ) {
    console.error(
      'DEFAULT_ADMIN_PASSWORD must be at least 12 characters and include upper, lower, number, and special characters.',
    );
    process.exit(1);
  }

  const env = loadEnv();
  const projectId = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) {
    console.error('NEXT_PUBLIC_FIREBASE_PROJECT_ID is required in .env.local');
    process.exit(1);
  }

  console.log('Setting up default admin...');
  console.log('  Email   :', DEFAULT_EMAIL);
  console.log('  Project :', projectId);

  const admin = await loadFirebaseAdmin(projectId);
  await ensureAuthAndProfile(admin);

  console.log('\nDone. Login with DEFAULT_ADMIN_EMAIL / DEFAULT_ADMIN_PASSWORD for Super Admin access.');
}

main().catch((err) => {
  console.error('Setup failed:', err.message || err);
  process.exit(1);
});
