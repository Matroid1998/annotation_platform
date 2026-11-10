export type CsvDocument = { source: string; question: string; answer: string };
export type CsvPreview = { documents: CsvDocument[]; errors: string[]; totalRows: number };

/** RFC 4180-style parsing: quoted commas, escaped quotes, CRLF and embedded newlines. */
export function parseDocumentCsv(input: string): CsvPreview {
  const text = input.replace(/^\uFEFF/, "");
  const rows: { cells: string[]; line: number }[] = [];
  const errors: string[] = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  let line = 1;
  let rowLine = 1;
  const finishField = () => { cells.push(field); field = ""; closedQuote = false; };
  const finishRow = () => {
    finishField();
    if (cells.some((cell) => cell.trim() !== "")) rows.push({ cells, line: rowLine });
    cells = [];
    rowLine = line + 1;
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closedQuote = true; }
      } else {
        field += char;
        if (char === "\n" || (char === "\r" && text[i + 1] !== "\n")) line++;
      }
    } else if (char === ",") {
      finishField();
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      finishRow();
      line++;
    } else if (char === '"') {
      if (field.length || closedQuote) return { documents: [], errors: [`Line ${line}: unexpected quote. Put the complete field in double quotes and escape a quote as two double quotes.`], totalRows: 0 };
      quoted = true;
    } else {
      if (closedQuote) return { documents: [], errors: [`Line ${line}: unexpected text after a closing quote.`], totalRows: 0 };
      field += char;
    }
  }
  if (quoted) return { documents: [], errors: [`Line ${rowLine}: a quoted field was not closed.`], totalRows: 0 };
  if (field.length || cells.length || closedQuote) finishRow();
  if (!rows.length) return { documents: [], errors: ["The CSV is empty. Add a header row and at least one document."], totalRows: 0 };

  const headers = rows[0].cells.map((header) => header.trim().toLowerCase());
  const required = ["document", "question", "answer"];
  if (headers.length !== 3 || required.some((header) => headers.filter((value) => value === header).length !== 1)) {
    return { documents: [], errors: ["Use exactly these three column headers: document, question, answer. They may appear in any order."], totalRows: rows.length - 1 };
  }
  const documents: CsvDocument[] = [];
  const seen = new Set<string>();
  for (const row of rows.slice(1)) {
    if (row.cells.length !== 3) { errors.push(`Line ${row.line}: expected 3 columns, found ${row.cells.length}. Quote fields containing commas or line breaks.`); continue; }
    const values = required.map((header) => row.cells[headers.indexOf(header)].trim());
    const missing = required.filter((_, index) => !values[index]);
    if (missing.length) { errors.push(`Line ${row.line}: ${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} empty.`); continue; }
    const limits = [200000, 20000, 100000];
    const tooLong = required.filter((_, index) => values[index].length > limits[index]);
    if (tooLong.length) { errors.push(`Line ${row.line}: ${tooLong.join(", ")} exceeds the field length limit (document: 200,000; question: 20,000; answer: 100,000 characters).`); continue; }
    const signature = JSON.stringify(values);
    if (seen.has(signature)) { errors.push(`Line ${row.line}: duplicate document, question and answer within this file.`); continue; }
    seen.add(signature);
    documents.push({ source: values[0], question: values[1], answer: values[2] });
  }
  if (rows.length === 1) errors.push("Add at least one document below the header row.");
  if (rows.length - 1 > 500) errors.push("Import at most 500 documents per file. Split this file into smaller batches.");
  return { documents, errors, totalRows: rows.length - 1 };
}
