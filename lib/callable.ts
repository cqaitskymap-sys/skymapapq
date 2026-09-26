import {
  httpsCallable as firebaseHttpsCallable,
  httpsCallableFromURL,
  type Functions,
} from 'firebase/functions';
import { getFirebaseFunctions, isFirebaseEmulatorEnabled } from './firebase';

function shouldProxyCallables(): boolean {
  return typeof window !== 'undefined' && !isFirebaseEmulatorEnabled();
}

/**
 * Drop-in replacement for firebase/functions httpsCallable.
 * In the browser (non-emulator) this posts to same-origin /api/cf/:name so
 * Cloud Run CORS preflight never runs. Firebase Auth is still sent and
 * enforced by the Cloud Function.
 */
export function httpsCallable<Req, Res>(functions: Functions, name: string) {
  if (shouldProxyCallables()) {
    return httpsCallableFromURL<Req, Res>(
      functions,
      `${window.location.origin}/api/cf/${encodeURIComponent(name)}`,
    );
  }
  return firebaseHttpsCallable<Req, Res>(functions, name);
}

/** One-arg helper for call sites that do not already have a Functions instance. */
export function httpsCallableMaybeProxied<Req, Res>(name: string) {
  return httpsCallable<Req, Res>(getFirebaseFunctions(), name);
}
