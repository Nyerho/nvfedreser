import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getAnalytics, isSupported as analyticsSupported } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-analytics.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  initializeFirestore,
  getDoc,
  limit,
  orderBy,
  query,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCwiYCpys1UUOGIpz_YPgrE_KHgNmA-eWw",
  authDomain: "nvyfr-28ea3.firebaseapp.com",
  projectId: "nvyfr-28ea3",
  storageBucket: "nvyfr-28ea3.firebasestorage.app",
  messagingSenderId: "1027181011422",
  appId: "1:1027181011422:web:0a650e062689f2c1437d4f",
  measurementId: "G-46TG18FEQS",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// Some browsers, extensions, and network proxies block Firestore's default
// WebChannel connection and report the misleading "client is offline" error.
// Long polling uses ordinary HTTPS requests and keeps the admin check usable.
const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
});

analyticsSupported()
  .then((supported) => {
    if (supported) {
      getAnalytics(app);
    }
  })
  .catch(() => {
    // Analytics is optional for this admin tool.
  });

function loginAdmin(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

function logoutAdmin() {
  return signOut(auth);
}

function watchAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

async function fetchRecentReceipts() {
  const receiptsQuery = query(collection(db, "receipts"), orderBy("createdAt", "desc"), limit(6));
  const snapshot = await getDocs(receiptsQuery);
  return snapshot.docs.map((receiptDoc) => ({ id: receiptDoc.id, ...receiptDoc.data() }));
}

function saveReceiptHistory(data) {
  return addDoc(collection(db, "receipts"), {
    recipientEmail: data.recipientEmail,
    recipientName: data.recipientName,
    subject: data.subject,
    organizationName: data.organizationName,
    amount: Number(data.amount),
    currency: data.currency,
    transactionType: data.transactionType,
    status: data.status,
    reference: data.reference,
    transactionDate: data.transactionDate,
    senderName: data.senderName,
    senderAccount: data.senderAccount,
    note: data.note,
    accentColor: data.accentColor,
    savedByUid: data.savedByUid || auth.currentUser?.uid || "",
    savedByEmail: data.savedByEmail || auth.currentUser?.email || "",
    createdAt: serverTimestamp(),
  });
}

async function getAuthorizedAdminRecord(user) {
  if (!user) {
    return { allowed: false, reason: "Sign in with a Firebase admin account." };
  }

  const directDoc = await getDoc(doc(db, "adminUsers", user.uid));
  if (directDoc.exists() && directDoc.data().active === true) {
    return {
      allowed: true,
      source: "uid",
      record: directDoc.data(),
      docId: directDoc.id,
    };
  }

  return {
    allowed: false,
    reason:
      "This signed-in account is not approved in Firestore. Add or update adminUsers/{uid} so it includes active: true.",
  };
}

export {
  auth,
  fetchRecentReceipts,
  getAuthorizedAdminRecord,
  loginAdmin,
  logoutAdmin,
  saveReceiptHistory,
  watchAuthState,
};
