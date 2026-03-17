import { NextRequest, NextResponse } from "next/server";
import { calculateQuotationTotals, type GSTRate, type QuotationLineItem } from "@/lib/gst";

interface QuotationRequest {
  customerName: string;
  customerAddress: string;
  items: QuotationLineItem[];
  gstRate: GSTRate;
  isInterState: boolean;
  discountPct: number;
  notes: string;
}

export async function POST(req: NextRequest) {
  let body: QuotationRequest;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { customerName, customerAddress, items, gstRate, isInterState, discountPct, notes } = body;

  if (!items || items.length === 0) {
    return NextResponse.json({ error: "At least one item is required" }, { status: 400 });
  }

  const totals = calculateQuotationTotals(items, gstRate, isInterState, discountPct);

  const now = new Date();
  const quotationNumber = `QTN-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
  const dateStr = now.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const validityDate = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);
  const validityStr = validityDate.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const fmt = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const itemRows = items
    .map((item, i) => {
      const amount = item.rate * item.qty;
      return `<tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(item.productName)}</td>
        <td>${escapeHtml(item.hsn || "-")}</td>
        <td class="right">${item.qty}</td>
        <td>${escapeHtml(item.unit || "Nos")}</td>
        <td class="right">${fmt(item.rate)}</td>
        <td class="right">${fmt(amount)}</td>
      </tr>`;
    })
    .join("\n");

  const gstRows = isInterState
    ? `<tr><td colspan="6" class="right label">IGST @ ${gstRate}%</td><td class="right">${fmt(totals.igst)}</td></tr>`
    : `<tr><td colspan="6" class="right label">CGST @ ${gstRate / 2}%</td><td class="right">${fmt(totals.cgst)}</td></tr>
       <tr><td colspan="6" class="right label">SGST @ ${gstRate / 2}%</td><td class="right">${fmt(totals.sgst)}</td></tr>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Quotation ${quotationNumber}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #1e293b;
    font-size: 13px;
    line-height: 1.5;
    background: #f8fafc;
    padding: 20px;
  }
  .page {
    max-width: 800px;
    margin: 0 auto;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    overflow: hidden;
  }
  .header {
    background: linear-gradient(135deg, #4f46e5, #6366f1);
    color: #fff;
    padding: 28px 32px;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }
  .header .company h1 { font-size: 22px; font-weight: 700; letter-spacing: -0.5px; }
  .header .company p { font-size: 12px; opacity: 0.85; margin-top: 4px; }
  .header .quotation-info { text-align: right; }
  .header .quotation-info h2 { font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; opacity: 0.85; }
  .header .quotation-info .qno { font-size: 18px; font-weight: 700; margin-top: 2px; }
  .header .quotation-info .qdate { font-size: 12px; opacity: 0.8; margin-top: 4px; }
  .body { padding: 28px 32px; }
  .meta-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin-bottom: 28px;
  }
  .meta-box h3 {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #94a3b8;
    font-weight: 600;
    margin-bottom: 6px;
  }
  .meta-box p { font-size: 13px; color: #334155; }
  .meta-box .name { font-weight: 600; font-size: 14px; color: #1e293b; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 4px;
    font-size: 12px;
  }
  thead th {
    background: #f1f5f9;
    padding: 10px 12px;
    text-align: left;
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #64748b;
    border-bottom: 2px solid #e2e8f0;
  }
  thead th.right, td.right { text-align: right; }
  tbody td {
    padding: 10px 12px;
    border-bottom: 1px solid #f1f5f9;
    color: #334155;
  }
  tbody tr:last-child td { border-bottom: 2px solid #e2e8f0; }
  .totals-section td {
    padding: 6px 12px;
    border-bottom: none;
    font-size: 12px;
  }
  .totals-section td.label { color: #64748b; font-weight: 500; }
  .totals-section tr.subtotal td { padding-top: 12px; }
  .totals-section tr.grand-total td {
    font-size: 16px;
    font-weight: 700;
    color: #1e293b;
    padding-top: 10px;
    border-top: 2px solid #4f46e5;
  }
  .amount-words {
    margin-top: 12px;
    padding: 10px 14px;
    background: #f0f0ff;
    border-radius: 6px;
    font-size: 12px;
    color: #4f46e5;
    font-weight: 500;
  }
  .footer-section {
    margin-top: 28px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
  }
  .footer-box h3 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #64748b;
    font-weight: 600;
    margin-bottom: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid #e2e8f0;
  }
  .footer-box p, .footer-box li {
    font-size: 11px;
    color: #64748b;
    line-height: 1.7;
  }
  .footer-box ul { padding-left: 16px; }
  .page-footer {
    margin-top: 28px;
    padding: 16px 32px;
    background: #f8fafc;
    border-top: 1px solid #e2e8f0;
    text-align: center;
    font-size: 11px;
    color: #94a3b8;
  }
  .signature {
    margin-top: 40px;
    text-align: right;
    padding-right: 20px;
  }
  .signature .line {
    width: 180px;
    border-top: 1px solid #cbd5e1;
    margin-left: auto;
    margin-bottom: 4px;
  }
  .signature p { font-size: 11px; color: #64748b; }

  @media print {
    body { background: #fff; padding: 0; }
    .page { border: none; border-radius: 0; box-shadow: none; max-width: none; }
    .header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    thead th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .amount-words { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page-footer { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    @page { margin: 10mm; }
  }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="company">
      <h1>Your Company Name</h1>
      <p>Your Address Line 1, City, State - PIN</p>
      <p>GSTIN: XXXXXXXXXXXXXXX</p>
      <p>Phone: +91 XXXXX XXXXX &nbsp;|&nbsp; Email: info@company.com</p>
    </div>
    <div class="quotation-info">
      <h2>Quotation</h2>
      <div class="qno">${quotationNumber}</div>
      <div class="qdate">Date: ${dateStr}</div>
    </div>
  </div>

  <div class="body">
    <div class="meta-grid">
      <div class="meta-box">
        <h3>Quotation To</h3>
        <p class="name">${escapeHtml(customerName || "—")}</p>
        <p>${escapeHtml(customerAddress || "—")}</p>
      </div>
      <div class="meta-box" style="text-align:right;">
        <h3>Details</h3>
        <p><strong>Valid Until:</strong> ${validityStr}</p>
        <p><strong>Payment:</strong> As per terms</p>
        <p><strong>Supply Type:</strong> ${isInterState ? "Inter-State" : "Intra-State"}</p>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="width:40px">#</th>
          <th>Product / Description</th>
          <th style="width:80px">HSN</th>
          <th class="right" style="width:60px">Qty</th>
          <th style="width:60px">Unit</th>
          <th class="right" style="width:100px">Rate (&#8377;)</th>
          <th class="right" style="width:110px">Amount (&#8377;)</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>

    <table class="totals-section">
      <tbody>
        <tr class="subtotal">
          <td colspan="6" class="right label">Subtotal</td>
          <td class="right" style="width:110px">${fmt(totals.subtotal)}</td>
        </tr>
        ${discountPct > 0 ? `<tr><td colspan="6" class="right label">Discount @ ${discountPct}%</td><td class="right" style="color:#ef4444">-${fmt(totals.discountAmount)}</td></tr>` : ""}
        ${discountPct > 0 ? `<tr><td colspan="6" class="right label">Taxable Amount</td><td class="right">${fmt(totals.taxableAmount)}</td></tr>` : ""}
        ${gstRate > 0 ? gstRows : ""}
        <tr class="grand-total">
          <td colspan="6" class="right">Grand Total</td>
          <td class="right">&#8377; ${fmt(totals.grandTotal)}</td>
        </tr>
      </tbody>
    </table>

    <div class="amount-words">
      Total Amount: &#8377; ${fmt(totals.grandTotal)} (${numberToWords(totals.grandTotal)} only)
    </div>

    <div class="footer-section">
      <div class="footer-box">
        <h3>Terms &amp; Conditions</h3>
        <ul>
          ${escapeHtml(notes || "Prices are subject to change without prior notice.\nDelivery within 7-10 working days.\nGoods once sold will not be taken back.\nPayment due within 30 days.")
            .split("\n")
            .filter((l) => l.trim())
            .map((l) => `<li>${l.trim()}</li>`)
            .join("\n          ")}
        </ul>
      </div>
      <div class="footer-box">
        <h3>Bank Details</h3>
        <p><strong>Bank Name:</strong> Your Bank Name</p>
        <p><strong>A/C No:</strong> XXXXXXXXXXXXXXXXX</p>
        <p><strong>IFSC:</strong> XXXXXXXXXXX</p>
        <p><strong>Branch:</strong> Your Branch</p>
      </div>
    </div>

    <div class="signature">
      <div class="line"></div>
      <p>Authorized Signatory</p>
    </div>
  </div>

  <div class="page-footer">
    This is a computer-generated quotation. &nbsp;|&nbsp; Generated by CatalogAI
  </div>
</div>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function numberToWords(n: number): string {
  if (n === 0) return "Zero";

  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen",
    "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  function convert(num: number): string {
    if (num === 0) return "";
    if (num < 20) return ones[num] + " ";
    if (num < 100) return tens[Math.floor(num / 10)] + " " + convert(num % 10);
    if (num < 1000) return ones[Math.floor(num / 100)] + " Hundred " + convert(num % 100);
    if (num < 100000) return convert(Math.floor(num / 1000)) + "Thousand " + convert(num % 1000);
    if (num < 10000000) return convert(Math.floor(num / 100000)) + "Lakh " + convert(num % 100000);
    return convert(Math.floor(num / 10000000)) + "Crore " + convert(num % 10000000);
  }

  const rupees = Math.floor(n);
  const paise = Math.round((n - rupees) * 100);

  let result = "Rupees " + convert(rupees).trim();
  if (paise > 0) {
    result += " and " + convert(paise).trim() + " Paise";
  }
  return result;
}
