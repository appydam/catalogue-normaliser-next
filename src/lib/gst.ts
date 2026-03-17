// ─── GST Calculation Utilities ────────────────────────────────────────────────

export const GST_RATES = [0, 5, 12, 18, 28] as const;
export type GSTRate = (typeof GST_RATES)[number];

export interface GSTBreakdown {
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  totalAmount: number;
}

export interface QuotationTotals {
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  grandTotal: number;
  gstRate: GSTRate;
  isInterState: boolean;
}

export interface QuotationLineItem {
  productName: string;
  hsn?: string;
  rate: number;
  qty: number;
  unit?: string;
}

/**
 * Calculate GST for a given amount.
 *
 * - Same state (isInterState = false): split into CGST + SGST (each half of rate)
 * - Inter-state (isInterState = true): full IGST
 */
export function calculateGST(
  amount: number,
  gstRate: GSTRate,
  isInterState: boolean
): GSTBreakdown {
  const taxableAmount = round2(amount);
  const taxAmount = round2(taxableAmount * (gstRate / 100));

  if (isInterState) {
    return {
      taxableAmount,
      cgst: 0,
      sgst: 0,
      igst: taxAmount,
      totalTax: taxAmount,
      totalAmount: round2(taxableAmount + taxAmount),
    };
  }

  const halfTax = round2(taxAmount / 2);
  return {
    taxableAmount,
    cgst: halfTax,
    sgst: halfTax,
    igst: 0,
    totalTax: round2(halfTax * 2),
    totalAmount: round2(taxableAmount + halfTax * 2),
  };
}

/**
 * Calculate full quotation totals: sum line items, apply discount, calculate GST.
 */
export function calculateQuotationTotals(
  items: QuotationLineItem[],
  gstRate: GSTRate,
  isInterState: boolean,
  discountPct: number
): QuotationTotals {
  const subtotal = round2(
    items.reduce((sum, item) => sum + item.rate * item.qty, 0)
  );

  const clampedDiscount = Math.max(0, Math.min(100, discountPct));
  const discountAmount = round2(subtotal * (clampedDiscount / 100));
  const taxableAmount = round2(subtotal - discountAmount);

  const gst = calculateGST(taxableAmount, gstRate, isInterState);

  return {
    subtotal,
    discountAmount,
    taxableAmount: gst.taxableAmount,
    cgst: gst.cgst,
    sgst: gst.sgst,
    igst: gst.igst,
    totalTax: gst.totalTax,
    grandTotal: gst.totalAmount,
    gstRate,
    isInterState,
  };
}

/** Round to 2 decimal places */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
