export interface TallyFieldMapping {
  stockItemName: string;
  parent: string;
  category: string;
  baseUnit: string;
  rate: string;
  hsnCode?: string;
  gstRate?: string;
}

export interface TallyExportOptions {
  gstApplicable?: boolean;
  defaultStockGroup?: string;
  defaultCategory?: string;
  defaultUnit?: string;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getField(product: Record<string, unknown>, fieldName: string): string {
  const val = product[fieldName];
  if (val == null) return "";
  return String(val).trim();
}

function generateStockItem(
  product: Record<string, unknown>,
  mapping: TallyFieldMapping,
  options: TallyExportOptions
): string {
  const name = escapeXml(getField(product, mapping.stockItemName) || "Unnamed Product");
  const parent = escapeXml(getField(product, mapping.parent) || options.defaultStockGroup || "Primary");
  const category = escapeXml(getField(product, mapping.category) || options.defaultCategory || "Primary");
  const unit = escapeXml(getField(product, mapping.baseUnit) || options.defaultUnit || "Nos");
  const rateRaw = getField(product, mapping.rate);
  const rate = rateRaw ? escapeXml(rateRaw) : "0";
  const hsnCode = mapping.hsnCode ? escapeXml(getField(product, mapping.hsnCode)) : "";
  const gstRate = mapping.gstRate ? escapeXml(getField(product, mapping.gstRate)) : "";
  const gstApplicable = options.gstApplicable !== false;

  const lines: string[] = [];
  lines.push(`        <TALLYMESSAGE xmlns:UDF="TallyUDF">`);
  lines.push(`          <STOCKITEM NAME="${name}" ACTION="Create">`);
  lines.push(`            <NAME.LIST>`);
  lines.push(`              <NAME>${name}</NAME>`);
  lines.push(`            </NAME.LIST>`);
  lines.push(`            <PARENT>${parent}</PARENT>`);
  lines.push(`            <CATEGORY>${category}</CATEGORY>`);

  if (gstApplicable) {
    lines.push(`            <GSTAPPLICABLE>&#4;Applicable</GSTAPPLICABLE>`);
  }

  if (hsnCode) {
    lines.push(`            <HSNCODE>${hsnCode}</HSNCODE>`);
  }

  if (gstRate) {
    lines.push(`            <TAXCLASSIFICATIONNAME>${gstRate}</TAXCLASSIFICATIONNAME>`);
  }

  lines.push(`            <BASEUNITS>${unit}</BASEUNITS>`);
  lines.push(`            <OPENINGBALANCE>0</OPENINGBALANCE>`);
  lines.push(`            <OPENINGRATE>${rate}</OPENINGRATE>`);
  lines.push(`            <OPENINGVALUE>0</OPENINGVALUE>`);
  lines.push(`          </STOCKITEM>`);
  lines.push(`        </TALLYMESSAGE>`);

  return lines.join("\n");
}

export function generateTallyXML(
  products: Record<string, unknown>[],
  fieldMapping: TallyFieldMapping,
  options: TallyExportOptions = {}
): string {
  const stockItems = products
    .map((p) => generateStockItem(p, fieldMapping, options))
    .join("\n");

  return `<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
      </REQUESTDESC>
      <REQUESTDATA>
${stockItems}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}
