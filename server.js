require("dotenv").config();

const express = require("express");
const fs = require("fs/promises");
const https = require("https");
const nodemailer = require("nodemailer");
const path = require("path");
const { randomUUID } = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const dataDirectory = path.join(__dirname, "data");
const receiptsFile = path.join(dataDirectory, "receipts.json");

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

async function ensureReceiptsFile() {
  await fs.mkdir(dataDirectory, { recursive: true });

  try {
    await fs.access(receiptsFile);
  } catch {
    await fs.writeFile(receiptsFile, "[]", "utf8");
  }
}

async function readReceiptEntries() {
  await ensureReceiptsFile();
  const content = await fs.readFile(receiptsFile, "utf8");

  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeReceiptEntries(entries) {
  await ensureReceiptsFile();
  await fs.writeFile(receiptsFile, JSON.stringify(entries, null, 2), "utf8");
}

async function saveReceiptEntry(data) {
  const entries = await readReceiptEntries();
  const entry = {
    id: randomUUID(),
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
    savedByUid: data.savedByUid || "",
    savedByEmail: data.savedByEmail || "",
    createdAt: new Date().toISOString(),
  };

  entries.unshift(entry);
  await writeReceiptEntries(entries.slice(0, 100));

  return entry;
}

function maskEmail(value) {
  const email = String(value || "");
  const atIndex = email.indexOf("@");
  if (atIndex <= 1) {
    return email ? "***" : "";
  }

  return `${email.slice(0, 2)}***${email.slice(atIndex)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatAmount(amount, currency) {
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

function parseMailFrom(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return { name: "", email: "" };
  }

  const match = raw.match(/^(.*)<([^>]+)>$/);
  if (!match) {
    return { name: "", email: raw };
  }

  return { name: match[1].trim().replace(/^"|"$/g, ""), email: match[2].trim() };
}

function renderReceiptEmail(data, options = {}) {
  const receiptAmount = formatAmount(data.amount, data.currency);
  const accent = data.accentColor || "#7c9cff";
  const inlineLogo = options.inlineLogo !== false;
  const brandMarkup = inlineLogo
    ? `
      <img
        src="cid:nvlogo"
        alt="${escapeHtml(data.organizationName || "Logo")}"
        width="140"
        style="display:block; margin:0 auto 18px; width:140px; max-width:140px; height:auto;"
      />
    `
    : data.organizationName
      ? `<div class="brand">${escapeHtml(data.organizationName)}</div>`
      : "";
  const rows = [
    ["Recipient", data.recipientName],
    ["Recipient Email", data.recipientEmail],
    ["Reference", data.reference],
    ["Status", data.status],
  ]
    .filter(([, value]) => value)
    .map(
      ([label, value]) => `
        <tr>
          <td class="detail-label">${escapeHtml(label)}</td>
          <td class="detail-value">${escapeHtml(value)}</td>
        </tr>`
    )
    .join("");

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <title>${escapeHtml(data.subject)}</title>
        <style>
          :root {
            color-scheme: light dark;
          }

          body, table, td, div, p, h1 {
            font-family: Arial, Helvetica, sans-serif;
          }

          .screen {
            margin: 0;
            padding: 24px;
            background: #0b1020;
            color: #ffffff;
          }

          .card {
            max-width: 520px;
            margin: 0 auto;
            background: #121a31;
            border-radius: 28px;
            overflow: hidden;
          }

          .content {
            padding: 34px 28px 30px;
            text-align: center;
          }

          .brand {
            display: inline-block;
            max-width: 240px;
            padding: 16px 18px;
            border-radius: 18px;
            background: #eef2ff;
            color: #131722;
            font-size: 12px;
            font-weight: 800;
            letter-spacing: 0.08em;
            line-height: 1.35;
            text-transform: uppercase;
          }

          .title {
            margin: 30px auto 12px;
            max-width: 260px;
            font-size: 42px;
            line-height: 0.98;
            color: #ffffff;
          }

          .copy {
            margin: 0 auto;
            max-width: 280px;
            color: #c3cae4;
            font-size: 16px;
            line-height: 1.6;
          }

          .section-label {
            margin: 34px 0 10px;
            color: #ffffff;
            font-size: 15px;
            font-weight: 800;
          }

          .section-value {
            margin: 0;
            color: #ffffff;
            font-size: 16px;
            line-height: 1.45;
          }

          .section-subvalue {
            margin: 2px 0 0;
            color: #c3cae4;
            font-size: 15px;
            line-height: 1.45;
          }

          .amount {
            margin-top: 26px;
            color: #ffffff;
            font-size: 56px;
            font-weight: 800;
            line-height: 1;
          }

          .meta {
            margin: 10px 0 0;
            color: #c3cae4;
            font-size: 15px;
          }

          .details {
            width: 100%;
            margin-top: 34px;
            border-collapse: collapse;
            text-align: left;
          }

          .detail-label,
          .detail-value {
            padding: 12px 0;
            border-bottom: 1px solid #202640;
            font-size: 14px;
          }

          .detail-label {
            color: #99a3c2;
          }

          .detail-value {
            color: #ffffff;
            text-align: right;
          }

          .note {
            margin: 22px 0 0;
            color: #99a3c2;
            font-size: 13px;
            line-height: 1.6;
            text-align: left;
          }

          .accent {
            color: ${escapeHtml(accent)};
          }

          @media (prefers-color-scheme: light) {
            .screen {
              background: #edf2f8 !important;
              color: #152035 !important;
            }

            .card {
              background: #ffffff !important;
            }

            .brand {
              background: #121622 !important;
              color: #f7f9fc !important;
            }

            .title,
            .section-label,
            .section-value,
            .detail-value,
            .accent {
              color: #152035 !important;
            }

            .copy,
            .section-subvalue,
            .meta,
            .detail-label,
            .note {
              color: #5d6985 !important;
            }

            .detail-label,
            .detail-value {
              border-bottom-color: #e4eaf3 !important;
            }
          }
        </style>
      </head>
      <body class="screen">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="card">
          <tr>
            <td class="content">
              ${brandMarkup}
              <h1 class="title">Transaction Confirmation</h1>
              <p class="copy">You received a new completed transaction on your account.</p>
              <p class="section-label">From</p>
              <p class="section-value">${escapeHtml(data.senderName || "Sender")}</p>
              <p class="section-subvalue">${escapeHtml(data.senderAccount || "Account details unavailable")}</p>
              <div class="amount">${escapeHtml(receiptAmount)}</div>
              <p class="meta">${escapeHtml(data.transactionType)} • ${escapeHtml(data.status)}</p>
              <p class="section-label">Transaction Date</p>
              <p class="section-value accent">${escapeHtml(data.transactionDate || "Not provided")}</p>
              <table role="presentation" class="details" cellspacing="0" cellpadding="0">
                ${rows}
              </table>
              <p class="note">${escapeHtml(data.note || "This is an automated transaction receipt.")}</p>
            </td>
          </tr>
        </table>
      </body>
    </html>`;
}

function renderTextReceipt(data) {
  const receiptAmount = formatAmount(data.amount, data.currency);

  return [
    `${data.organizationName || "Receipt"} - Transaction Confirmation`,
    "",
    `Amount: ${receiptAmount}`,
    `Recipient: ${data.recipientName}`,
    `Recipient Email: ${data.recipientEmail}`,
    `Status: ${data.status}`,
    `Transaction Type: ${data.transactionType}`,
    `Reference: ${data.reference}`,
    `Date: ${data.transactionDate}`,
    `From: ${data.senderName}`,
    `Source Account: ${data.senderAccount}`,
    `Notes: ${data.note || "N/A"}`,
  ].join("\n");
}

function createTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } = process.env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    return null;
  }

  const normalizedPass =
    /gmail\.com$/i.test(SMTP_HOST) || /googlemail\.com$/i.test(SMTP_HOST)
      ? SMTP_PASS.replace(/[\s-]+/g, "")
      : SMTP_PASS;

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: SMTP_SECURE === "true",
    auth: {
      user: SMTP_USER,
      pass: normalizedPass,
    },
  });
}

async function sendReceiptViaBrevoApi(data) {
  const apiKey = String(process.env.BREVO_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("BREVO_API_KEY is missing.");
  }

  const senderValue = process.env.MAIL_FROM || process.env.SMTP_USER || "";
  const sender = parseMailFrom(senderValue);
  if (!sender.email) {
    throw new Error("MAIL_FROM is missing a valid sender email.");
  }

  let logoBase64 = "";
  try {
    const logoBuffer = await fs.readFile(path.join(__dirname, "public", "nvlogo.png"));
    logoBase64 = logoBuffer.toString("base64");
  } catch {
    logoBase64 = "";
  }

  const payload = {
    sender: {
      name: sender.name || undefined,
      email: sender.email,
    },
    to: [
      {
        email: data.recipientEmail,
        name: data.recipientName || undefined,
      },
    ],
    subject: data.subject,
    htmlContent: renderReceiptEmail(data, { inlineLogo: false }),
    textContent: renderTextReceipt(data),
  };

  if (logoBase64) {
    payload.attachment = [
      {
        name: "nvlogo.png",
        content: logoBase64,
      },
    ];
  }

  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const request = https.request(
      "https://api.brevo.com/v3/smtp/email",
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "api-key": apiKey,
        },
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            resolve(responseBody);
            return;
          }

          let apiMessage = "";
          try {
            const parsed = JSON.parse(responseBody);
            apiMessage = parsed?.message || parsed?.error || "";
          } catch {
            apiMessage = responseBody;
          }

          reject(new Error(apiMessage || `Brevo API error (${response.statusCode || "unknown"})`));
        });
      }
    );

    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

app.get("/api/health", (req, res) => {
  const host = process.env.SMTP_HOST || "";
  const port = process.env.SMTP_PORT || "";
  const secure = process.env.SMTP_SECURE === "true";
  const user = process.env.SMTP_USER || "";
  const from = process.env.MAIL_FROM || "";

  res.json({
    ok: true,
    smtp: {
      configured: Boolean(host && port && user && process.env.SMTP_PASS),
      host,
      port,
      secure,
      user: maskEmail(user),
      from: from ? from.replace(/<([^>]+)>/, "<***@***>") : "",
    },
  });
});

app.get("/api/receipts/recent", async (req, res) => {
  try {
    const entries = await readReceiptEntries();
    res.json({
      ok: true,
      receipts: entries.slice(0, 6),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message || "Unable to load recent receipt history.",
    });
  }
});

app.post("/api/send-receipt", async (req, res) => {
  const data = {
    recipientEmail: (req.body.recipientEmail || "").trim(),
    recipientName: (req.body.recipientName || "").trim(),
    subject: (req.body.subject || "Transaction Confirmation").trim(),
    organizationName: (req.body.organizationName || "").trim(),
    amount: req.body.amount,
    currency: (req.body.currency || "USD").trim(),
    transactionType: (req.body.transactionType || "Deposit").trim(),
    status: (req.body.status || "Completed").trim(),
    reference: (req.body.reference || "").trim(),
    transactionDate: (req.body.transactionDate || "").trim(),
    senderName: (req.body.senderName || "").trim(),
    senderAccount: (req.body.senderAccount || "").trim(),
    note: (req.body.note || "").trim(),
    accentColor: (req.body.accentColor || "#7c9cff").trim(),
    savedByUid: (req.body.savedByUid || "").trim(),
    savedByEmail: (req.body.savedByEmail || "").trim(),
  };

  if (!data.recipientEmail || !data.recipientName || !data.amount) {
    return res.status(400).json({
      ok: false,
      message: "Recipient email, recipient name, and amount are required.",
    });
  }

  const transporter = createTransporter();

  if (!transporter) {
    return res.status(500).json({
      ok: false,
      message: "SMTP settings are missing. Add them to your .env file before sending.",
    });
  }

  try {
    try {
      await transporter.sendMail({
        from: process.env.MAIL_FROM || process.env.SMTP_USER,
        to: data.recipientEmail,
        subject: data.subject,
        html: renderReceiptEmail(data, { inlineLogo: true }),
        text: renderTextReceipt(data),
        attachments: [
          {
            filename: "nvlogo.png",
            path: path.join(__dirname, "public", "nvlogo.png"),
            cid: "nvlogo",
          },
        ],
      });
    } catch (smtpError) {
      const smtpMessage = String(smtpError?.message || "");
      const isBrevoActivationError =
        /not yet activated/i.test(smtpMessage) ||
        /contact@sendinblue\.com/i.test(smtpMessage) ||
        /502 5\.7\.0/i.test(smtpMessage);

      if (!isBrevoActivationError) {
        throw smtpError;
      }

      await sendReceiptViaBrevoApi(data);
    }

    let historyWarning = "";

    try {
      await saveReceiptEntry(data);
    } catch (historyError) {
      console.error("Unable to save receipt history:", historyError);
      historyWarning = " Email sent, but local receipt history could not be updated.";
    }

    res.json({
      ok: true,
      message: `Receipt sent to ${data.recipientEmail}.${historyWarning}`,
    });
  } catch (error) {
    const message = String(error?.message || "");
    const isGmailAuthError =
      /Invalid login/i.test(message) ||
      /535-5\.7\.8/i.test(message) ||
      /Username and Password not accepted/i.test(message);
    const isBrevoActivationError =
      /not yet activated/i.test(message) ||
      /contact@sendinblue\.com/i.test(message) ||
      /502 5\.7\.0/i.test(message);

    res.status(500).json({
      ok: false,
      message: isGmailAuthError
        ? "Gmail rejected the SMTP login. Use the exact Gmail address that generated the app password, remove spaces or dashes from SMTP_PASS, and update the same values in Vercel env vars before redeploying."
        : isBrevoActivationError
          ? "Brevo rejected SMTP because your account is not activated yet (502 5.7.0). In Brevo: complete account verification, verify your sender/domain (SPF/DKIM), then request SMTP activation from Support. After activation, retry."
          : error.message || "Unable to send the receipt email.",
    });
  }
});

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Receipt sender app running on http://localhost:${PORT}`);
});
