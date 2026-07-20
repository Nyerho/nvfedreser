const form = document.getElementById("receipt-form");
const sendButton = document.getElementById("send-button");
const statusMessage = document.getElementById("status-message");

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

async function submitReceipt(event) {
  event.preventDefault();

  sendButton.disabled = true;
  statusMessage.textContent = "Sending receipt...";

  try {
    const response = await fetch("/api/send-receipt", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(getFormData()),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Unable to send the receipt.");
    }

    statusMessage.textContent = result.message;
  } catch (error) {
    statusMessage.textContent = error.message;
  } finally {
    sendButton.disabled = false;
  }
}

form.addEventListener("input", updatePreview);
form.addEventListener("submit", submitReceipt);

const dateField = form.elements.namedItem("transactionDate");
if (dateField && !dateField.value) {
  dateField.value = new Date().toISOString().slice(0, 10);
}

updatePreview();
