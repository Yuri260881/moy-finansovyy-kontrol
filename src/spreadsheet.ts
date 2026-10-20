import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
const escape = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const col = (n: number) => {
  let s = "";
  for (n++; n; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
export function toXlsx(rows: (string | number)[][]) {
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((row, i) => `<row r="${i + 1}">${row.map((v, j) => (typeof v === "number" ? `<c r="${col(j)}${i + 1}"><v>${v}</v></c>` : `<c r="${col(j)}${i + 1}" t="inlineStr"><is><t>${escape(String(v ?? ""))}</t></is></c>`)).join("")}</row>`).join("")}</sheetData></worksheet>`;
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Оплаты" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    ),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
  };
  return zipSync(files, { level: 6 });
}
export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    value = "",
    quoted = false;
  const sep = text.slice(0, text.indexOf("\n")).includes(";") ? ";" : ",";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === sep && !quoted) {
      row.push(value);
      value = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(value);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else value += c;
  }
  row.push(value);
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
export function parseXlsx(bytes: Uint8Array) {
  const files = unzipSync(bytes);
  const workbook = new DOMParser().parseFromString(
    strFromU8(files["xl/workbook.xml"]),
    "application/xml",
  );
  const relId = workbook.getElementsByTagName("sheet")[0]?.getAttribute("r:id");
  const rels = new DOMParser().parseFromString(
    strFromU8(files["xl/_rels/workbook.xml.rels"]),
    "application/xml",
  );
  const target =
    Array.from(rels.getElementsByTagName("Relationship"))
      .find((x) => x.getAttribute("Id") === relId)
      ?.getAttribute("Target") || "worksheets/sheet1.xml";
  const sheetPath = target.startsWith("/")
    ? target.slice(1)
    : `xl/${target.replace(/^\.\//, "")}`;
  const xml = new DOMParser().parseFromString(
    strFromU8(files[sheetPath]),
    "application/xml",
  );
  const strings = files["xl/sharedStrings.xml"]
    ? Array.from(
        new DOMParser()
          .parseFromString(
            strFromU8(files["xl/sharedStrings.xml"]),
            "application/xml",
          )
          .getElementsByTagName("si"),
      ).map((si) => si.textContent || "")
    : [];
  return Array.from(xml.getElementsByTagName("row")).map((row) => {
    const result: string[] = [];
    for (const cell of Array.from(row.getElementsByTagName("c"))) {
      const ref = cell.getAttribute("r") || "A1";
      let index = 0;
      for (const letter of ref.match(/^[A-Z]+/)?.[0] || "A")
        index = index * 26 + letter.charCodeAt(0) - 64;
      const raw =
        cell.getElementsByTagName("v")[0]?.textContent ||
        cell.getElementsByTagName("is")[0]?.textContent ||
        "";
      result[index - 1] =
        cell.getAttribute("t") === "s" ? strings[Number(raw)] || "" : raw;
    }
    return result;
  });
}
export function rowsToObjects(rows: string[][]) {
  const [head, ...body] = rows;
  return body.map((r) =>
    Object.fromEntries(
      head.map((h, i) => [h.replace(/^\uFEFF/, ""), r[i] || ""]),
    ),
  );
}
