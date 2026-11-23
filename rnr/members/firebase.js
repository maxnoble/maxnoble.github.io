// Shared sign-in module for the RnR members pages.
// Firebase JS SDK, pinned version, loaded from Google's CDN.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink,
  signOut as fbSignOut, deleteUser,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, deleteDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

export const ready = Boolean(firebaseConfig);
const app = ready ? initializeApp(firebaseConfig) : null;
export const auth = ready ? getAuth(app) : null;
const db = ready ? getFirestore(app) : null;

const EMAIL_KEY = "rnr-signin-email";
export const HELP_OPTIONS = [
  ["kitchen", "In the kitchen"],
  ["trade-boss", "As a trade expert (Boss)"],
  ["journeyman", "As a volunteer journeyman (VIP)"],
  ["supporter", "As a supporter or donor"],
  ["building", "I know a building"],
];

// Pages a "next" parameter may send people back to (no open redirects).
const NEXT_PAGES = new Set(["kitchen-boss.html", "phases.html", "get-involved.html"]);
export function safeNext(value) {
  return NEXT_PAGES.has(value) ? value : null;
}

// Resolves with the signed-in user (or null) once Firebase has checked.
export function currentUser() {
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, (user) => { stop(); resolve(user); });
  });
}

export async function getProfile(user) {
  const snap = await getDoc(doc(db, "members", user.uid));
  return snap.exists() ? snap.data() : null;
}

export function profileComplete(p) {
  return Boolean(p && p.firstName && p.lastName);
}

export async function saveProfile(user, { firstName, lastName, helps }, isNew) {
  const data = {
    firstName, lastName, helps,
    email: user.email || "",
    updated: serverTimestamp(),
  };
  if (isNew) data.created = serverTimestamp();
  await setDoc(doc(db, "members", user.uid), data, { merge: true });
}

// For gated pages: shows the page only to signed-in members with a profile.
export async function requireMember(page) {
  if (!ready) { location.replace("./"); return null; }
  const user = await currentUser();
  const next = "./?next=" + encodeURIComponent(page);
  if (!user) { location.replace(next); return null; }
  const profile = await getProfile(user);
  if (!profileComplete(profile)) { location.replace(next); return null; }
  return { user, profile };
}

export async function signInGoogle() {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === "auth/popup-blocked") await signInWithRedirect(auth, provider);
    else throw e;
  }
}

export async function sendEmailLink(email) {
  await sendSignInLinkToEmail(auth, email, { url: location.href, handleCodeInApp: true });
  try { localStorage.setItem(EMAIL_KEY, email); } catch (_) { /* private mode */ }
}

export function arrivedByEmailLink() {
  return ready && isSignInWithEmailLink(auth, location.href);
}

export function rememberedEmail() {
  try { return localStorage.getItem(EMAIL_KEY); } catch (_) { return null; }
}

export async function finishEmailLink(email) {
  await signInWithEmailLink(auth, email, location.href);
  try { localStorage.removeItem(EMAIL_KEY); } catch (_) { /* ignore */ }
  // Drop the one-time link code from the address bar, keep "next".
  const url = new URL(location.href);
  const keep = url.searchParams.get("next");
  history.replaceState(null, "", url.pathname + (keep ? "?next=" + encodeURIComponent(keep) : ""));
}

export function signOut() {
  return fbSignOut(auth);
}

// Deletes the member's profile and their sign-in account.
export async function deleteMe() {
  const user = auth.currentUser;
  if (!user) return;
  // Firebase only deletes accounts that signed in recently. Check first, so the
  // profile isn't removed while the account itself stays behind.
  const last = Date.parse(user.metadata.lastSignInTime || "");
  if (!last || Date.now() - last > 4 * 60 * 1000) {
    const e = new Error("Sign in again first"); e.code = "auth/requires-recent-login"; throw e;
  }
  await deleteDoc(doc(db, "members", user.uid));
  await deleteUser(user); // may throw auth/requires-recent-login
}

export function friendlyError(e) {
  const map = {
    "auth/popup-closed-by-user": "The sign-in window was closed before it finished.",
    "auth/cancelled-popup-request": "The sign-in window was closed before it finished.",
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/invalid-action-code": "That sign-in link has expired or was already used. Ask for a new one.",
    "auth/expired-action-code": "That sign-in link has expired. Ask for a new one.",
    "auth/network-request-failed": "No connection. Check your internet and try again.",
    "auth/too-many-requests": "Too many tries. Wait a few minutes and try again.",
    "auth/requires-recent-login": "For safety, sign in again, then delete your account.",
    "permission-denied": "That wasn't allowed. Sign out, sign in again and retry.",
  };
  return map[e && e.code] || "Something went wrong. Please try again.";
}
