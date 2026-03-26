
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, query, where, orderBy, limit, onSnapshot, addDoc, serverTimestamp, Timestamp, getDocFromServer } from 'firebase/firestore';

// Import the Firebase configuration
import firebaseConfig from './firebase-applet-config.json';

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Types for our app
export interface UserProfile {
  uid: string;
  displayName: string;
  photoURL: string;
  walletBalance: number;
  totalEarnings: number;
  bestScore: number;
  gamesPlayed: number;
  isVerified: boolean;
}

export interface Tournament {
  id: string;
  title: string;
  startTime: Timestamp;
  endTime: Timestamp;
  prizePool: number;
  entryFee: number;
  status: 'active' | 'ended' | 'calculating';
  winnerUids?: string[];
}

export interface MatchLog {
  id: string;
  uid: string;
  score: number;
  timestamp: Timestamp;
  gameLog: string;
  status: 'pending' | 'verified' | 'flagged';
  tournamentId?: string;
}

export interface Duel {
  id: string;
  challengerUid: string;
  opponentUid: string;
  stake: number;
  challengerScore?: number;
  opponentScore?: number;
  status: 'pending' | 'accepted' | 'completed' | 'cancelled';
  winnerUid?: string;
}

// Auth Helpers
export const signIn = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    
    // Check if user profile exists, if not create it
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) {
      const newUser: UserProfile = {
        uid: user.uid,
        displayName: user.displayName || 'Anonymous Player',
        photoURL: user.photoURL || '',
        walletBalance: 0,
        totalEarnings: 0,
        bestScore: 0,
        gamesPlayed: 0,
        isVerified: false
      };
      await setDoc(doc(db, 'users', user.uid), newUser);
    }
    return user;
  } catch (error) {
    console.error("Error signing in:", error);
    throw error;
  }
};

export const logOut = () => signOut(auth);

// Firestore Error Handler
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
    userId?: string;
    email?: string;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email || undefined,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Test Connection
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. ");
    }
  }
}
testConnection();
