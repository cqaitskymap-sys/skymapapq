/**
 * Shared Firebase Admin bootstrap for Gen2 callables.
 * Each function can be cold-started in isolation, so every module must
 * resolve Admin services via an initialized App instance.
 */
import { getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage, type Storage } from 'firebase-admin/storage';

let adminApp: App | null = null;

export function getAdminApp(): App {
  if (adminApp) return adminApp;
  adminApp = getApps()[0] ?? initializeApp();
  return adminApp;
}

export function getAdminFirestore(): Firestore {
  return getFirestore(getAdminApp());
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

export function getAdminStorage(): Storage {
  return getStorage(getAdminApp());
}

/** @deprecated Prefer getAdminFirestore() / getAdminAuth() / getAdminStorage() */
export function initializeAdmin(): void {
  getAdminApp();
}
