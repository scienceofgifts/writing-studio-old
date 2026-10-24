/**
 * Science of Gifts - Firebase Configuration & Initialization
 * Initializes Firebase Authentication and Cloud Firestore using firebase-applet-config.json.
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signOut as firebaseSignOut, signInWithPopup, User } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase App
export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Initialize Cloud Firestore with database ID specified in config (CRITICAL for non-default database IDs)
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

// Initialize Firebase Auth & Providers
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map((provider) => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function validateFirestoreConnection(): Promise<boolean> {
  try {
    // Attempt a lightweight server read to verify connectivity & project setup
    await getDocFromServer(doc(db, '_health', 'connection'));
    return true;
  } catch (error: any) {
    if (error?.message?.includes('the client is offline') || error?.code === 'unavailable') {
      console.warn('Firestore is currently unreachable or offline.');
    } else {
      console.warn('Firestore connection health check result:', error?.message || error);
    }
    return false;
  }
}

export function getFirebaseProjectDetails() {
  return {
    projectId: firebaseConfig.projectId,
    firestoreDatabaseId: firebaseConfig.firestoreDatabaseId,
    consoleAuthSettingsUrl: `https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/settings`,
  };
}

export async function signInWithGoogle(): Promise<User> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (err: any) {
    if (err?.code === 'auth/unauthorized-domain') {
      const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';
      err.unauthorizedDomain = currentHost;
      err.firebaseProjectId = firebaseConfig.projectId;
      err.consoleUrl = `https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/settings`;
      console.warn(
        `Firebase Google Sign-In requires "${currentHost}" to be added to Authorized Domains in Firebase Console:\n${err.consoleUrl}`
      );
    } else if (err?.code !== 'auth/popup-closed-by-user' && err?.code !== 'auth/cancelled-popup-request') {
      console.error('Google Sign-In failed:', err);
    } else {
      console.info('Google Sign-In popup closed by user.');
    }
    throw err;
  }
}

export async function signOutUser(): Promise<void> {
  try {
    await firebaseSignOut(auth);
  } catch (err: any) {
    console.error('Sign-out failed:', err);
    throw err;
  }
}
