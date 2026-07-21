import {
  auth,
  fetchRecentReceipts,
  getAuthorizedAdminRecord,
  loginAdmin,
  logoutAdmin,
  watchAuthState,
} from "/firebase-client.js";

const securityModal = document.getElementById("security-modal");
const authForm = document.getElementById("auth-form");
const authStatus = document.getElementById("auth-status");
const authUser = document.getElementById("auth-user");
const securityDetail = document.getElementById("security-detail");
const loginButton = document.getElementById("login-button");
const logoutButton = document.getElementById("logout-button");
const openSecurityButton = document.getElementById("open-security-button");
const accessSummary = document.getElementById("access-summary");
const historyList = document.getElementById("history-list");
const historyEmpty = document.getElementById("history-empty");
const form = document.getElementById("receipt-form");
const sendButton = document.getElementById("send-button");
const statusMessage = document.getElementById("status-message");
const receiptControls = Array.from(form.querySelectorAll("input, select, button"));

let currentUser = null;
let authorizedAdmin = null;
let historyRefreshTimer = null;

const previewNodes = {
  organizationName: document.getElementById("preview-org"),
  amount: document.getElementById("preview-amount"),
  meta: document.getElementById("preview-meta"),
  recipientName: document.getElementById("preview-recipient"),
  recipientEmail: document.getElementById("preview-email"),
  reference: document.getElementById("preview-reference"),
  transactionDate: document.getElementById("preview-date"),
  senderName: document.getElementById("preview-from"),
  senderAccount: document.getElementById("preview-account"),
  note: document.getElementById("preview-note"),
};

function getFormData() {
  const formData = new FormData(form);
  return Object.fromEntries(formData.entries());
}

function setReceiptFormEnabled(enabled) {
  receiptControls.forEach((control) => {
    if (control === sendButton) {
      control.disabled = !enabled;
      return;
    }

    control.disabled = !enabled;
  });

  form.classList.toggle("is-locked", !enabled);
}

function setModalOpen(open) {
  securityModal.hidden = !open;
  securityModal.setAttribute("aria-hidden", String(!open));
  document.body.classList.toggle("modal-open", open);
}

function formatCurrency(amount, currency) {
  const numeric = Number(amount);
  if (Number.isNaN(numeric)) {
    return `${currency} ${amount}`;
  }

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: 2,
    }).format(numeric);
  } catch {
    return `${currency || "USD"} ${numeric.toFixed(2)}`;
  }
}

function updatePreview() {
  const data = getFormData();
  const organizationName = (data.organizationName || "").trim();

  previewNodes.organizationName.textContent = organizationName;
  previewNodes.organizationName.style.display = organizationName ? "inline-block" : "none";
  previewNodes.amount.textContent = formatCurrency(data.amount, data.currency);
  previewNodes.meta.textContent = `${data.transactionType || "Transfer"} • ${data.status || "Completed"}`;
  previewNodes.recipientName.textContent = data.recipientName || "Recipient Name";
  previewNodes.recipientEmail.textContent = data.recipientEmail || "name@example.com";
  previewNodes.reference.textContent = data.reference || "REF-000000";
  previewNodes.transactionDate.textContent = data.transactionDate || new Date().toISOString().slice(0, 10);
  previewNodes.senderName.textContent = data.senderName || "Sender";
  previewNodes.senderAccount.textContent = data.senderAccount || "Acct: 000000000";
  previewNodes.note.textContent = data.note || "A note about this receipt will appear here.";

  document.documentElement.style.setProperty("--accent", data.accentColor || "#7c9cff");
  document.documentElement.style.setProperty("--accent-soft", `${data.accentColor || "#7c9cff"}22`);
}

function formatReceiptDate(value) {
  if (!value) {
    return "No date";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function formatFirestoreAccessError(error, fallback) {
  const message = String(error?.message || "");
  if (error?.code === "permission-denied" || /missing or insufficient permissions/i.test(message)) {
    const uidHint = auth.currentUser?.uid ? ` Current UID: ${auth.currentUser.uid}.` : "";
    return `Firestore blocked access. Publish the updated rules, then make sure adminUsers/{uid} exists with active: true.${uidHint}`;
  }

  return message || fallback;
}

function buildAdminDocHint(user) {
  if (!user?.uid) {
    return "Firestore rule: create adminUsers/{uid} with active: true and an optional role.";
  }

  return `Firestore rule: create adminUsers/${user.uid} with active: true and an optional role.`;
}

function renderReceiptHistory(receipts) {
  historyList.innerHTML = "";

  if (!receipts.length) {
    historyEmpty.textContent = currentUser
      ? "No saved receipts yet. Send one to create the first record."
      : "Sign in to load recent receipt activity.";
    historyEmpty.hidden = false;
    return;
  }

  historyEmpty.hidden = true;

  receipts.forEach((receipt) => {
    const item = document.createElement("li");
    item.className = "history-item";
    item.innerHTML = `
      <div>
        <strong>${receipt.recipientName || "Unknown recipient"}</strong>
        <span>${receipt.recipientEmail || "No email"} • ${receipt.reference || "No reference"}</span>
      </div>
      <div class="history-meta">
        <strong>${formatCurrency(receipt.amount, receipt.currency)}</strong>
        <span>${formatReceiptDate(receipt.createdAt || receipt.transactionDate)}</span>
      </div>
    `;
    historyList.appendChild(item);
  });
}

async function loadReceiptHistory() {
  try {
    const receipts = await fetchRecentReceipts();
    renderReceiptHistory(receipts);
  } catch (error) {
    historyList.innerHTML = "";
    historyEmpty.hidden = false;
    historyEmpty.textContent = error.message || "Unable to load recent receipt history.";
  }
}

function startHistoryRefresh() {
  if (historyRefreshTimer) {
    window.clearInterval(historyRefreshTimer);
  }

  loadReceiptHistory();
  historyRefreshTimer = window.setInterval(loadReceiptHistory, 15000);
}

function stopWatchingHistory() {
  if (historyRefreshTimer) {
    window.clearInterval(historyRefreshTimer);
    historyRefreshTimer = null;
  }

  renderReceiptHistory([]);
}

function setUnauthorizedState(message) {
  authorizedAdmin = null;
  setReceiptFormEnabled(false);
  accessSummary.textContent = "Dashboard locked";
  authStatus.textContent = message;
  historyEmpty.textContent = "Authorized admin access is required before receipt history can load.";
  stopWatchingHistory();
  setModalOpen(true);
}

async function handleAuthSubmit(event) {
  event.preventDefault();

  const formData = new FormData(authForm);
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");

  loginButton.disabled = true;
  authStatus.textContent = "Signing in...";

  try {
    await loginAdmin(email, password);
    authStatus.textContent = "Signed in successfully.";
    authForm.reset();
  } catch (error) {
    authStatus.textContent = error.message || "Unable to sign in.";
  } finally {
    loginButton.disabled = false;
  }
}

async function handleLogout() {
  logoutButton.disabled = true;

  try {
    await logoutAdmin();
    authStatus.textContent = "Signed out.";
  } catch (error) {
    authStatus.textContent = error.message || "Unable to sign out.";
  } finally {
    logoutButton.disabled = false;
  }
}

async function evaluateAdminAccess(user) {
  if (!user) {
    authUser.textContent = "Not signed in";
    securityDetail.textContent = buildAdminDocHint(user);
    setUnauthorizedState("Sign in to continue.");
    return;
  }

  authUser.textContent = `Signed in as ${user.email} (${user.uid})`;
  authStatus.textContent = "Checking Firestore admin approval...";

  try {
    const access = await getAuthorizedAdminRecord(user);

    if (!access.allowed) {
      securityDetail.textContent = access.reason;
      setUnauthorizedState(access.reason);
      return;
    }

    authorizedAdmin = access;
    setReceiptFormEnabled(true);
    setModalOpen(false);
    accessSummary.textContent = `Authorized: ${user.email}${access.record.role ? ` (${access.record.role})` : ""}`;
    authStatus.textContent = "Admin access is active.";
    securityDetail.textContent = `Approved via Firestore ${access.source} record: ${access.docId}`;
    startHistoryRefresh();
  } catch (error) {
    const message = formatFirestoreAccessError(error, "Unable to check admin approval.");
    securityDetail.textContent = `${message} ${buildAdminDocHint(user)}`;
    setUnauthorizedState(message);
  }
}

watchAuthState((user) => {
  currentUser = user;
  const signedIn = Boolean(user);

  logoutButton.disabled = !signedIn;
  evaluateAdminAccess(user);
});

async function submitReceipt(event) {
  event.preventDefault();

  if (!currentUser || !authorizedAdmin?.allowed) {
    statusMessage.textContent = "Only Firestore-approved admins can send receipts.";
    setModalOpen(true);
    return;
  }

  sendButton.disabled = true;
  statusMessage.textContent = "Sending receipt...";
  const payload = getFormData();

  try {
    const requestPayload = {
      ...payload,
      amount: Number(payload.amount),
      savedByUid: auth.currentUser?.uid || "",
      savedByEmail: auth.currentUser?.email || "",
    };
    const response = await fetch("/api/send-receipt", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestPayload),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Unable to send the receipt.");
    }

    await loadReceiptHistory();
    statusMessage.textContent = result.message || "Receipt sent successfully.";
  } catch (error) {
    statusMessage.textContent = error.message;
  } finally {
    sendButton.disabled = false;
  }
}

authForm.addEventListener("submit", handleAuthSubmit);
logoutButton.addEventListener("click", handleLogout);
openSecurityButton.addEventListener("click", () => setModalOpen(true));
form.addEventListener("input", updatePreview);
form.addEventListener("submit", submitReceipt);

const dateField = form.elements.namedItem("transactionDate");
if (dateField && !dateField.value) {
  dateField.value = new Date().toISOString().slice(0, 10);
}

setReceiptFormEnabled(false);
setModalOpen(true);
updatePreview();
