import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDocumentCsv } from './csv.ts';

test('parses BOM, reordered headers, embedded newlines, commas, and escaped quotes', () => {
  const result = parseDocumentCsv('\uFEFFanswer,document,question\r\n"The \"\"right\"\" answer","First paragraph, here.\r\nSecond paragraph.","What is it?"\r\n');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.documents, [{ source: 'First paragraph, here.\r\nSecond paragraph.', question: 'What is it?', answer: 'The "right" answer' }]);
  assert.equal(result.totalRows, 1);
});

test('rejects a truncated quoted row without returning partial data', () => {
  const result = parseDocumentCsv('document,question,answer\nFirst,Question,Answer\n"Unclosed,Question,Answer');
  assert.equal(result.documents.length, 0);
  assert.match(result.errors[0], /not closed/);
});

test('rejects duplicate/missing/extra column headers', () => {
  for (const input of ['document,question,question\nA,B,C', 'document,question\nA,B', 'document,question,answer,other\nA,B,C,D']) {
    assert.equal(parseDocumentCsv(input).errors.length, 1);
  }
});

test('flags missing fields and malformed columns with source line numbers', () => {
  const result = parseDocumentCsv('document,question,answer\n"Paragraph\ncontinued",Question,Answer\nOnly,Two\nSource,,Answer');
  assert.equal(result.documents.length, 1);
  assert.match(result.errors[0], /Line 4: expected 3 columns/);
  assert.match(result.errors[1], /Line 5: question is empty/);
});

test('rejects duplicate content within an import', () => {
  const result = parseDocumentCsv('document,question,answer\nSource,Question,Answer\nSource,Question,Answer\n');
  assert.equal(result.documents.length, 1);
  assert.match(result.errors[0], /duplicate/);
});

test('handles trailing empty fields, blank lines, and final row without newline', () => {
  const result = parseDocumentCsv('document,question,answer\r\n\r\nSource,Question,\r\nGood source,Good question,Good answer');
  assert.equal(result.totalRows, 2);
  assert.match(result.errors[0], /answer is empty/);
  assert.equal(result.documents[0].source, 'Good source');
});

test('rejects text after closing quotes and stray quotes in unquoted fields', () => {
  for (const row of ['"Source"oops,Question,Answer', 'So"urce,Question,Answer']) {
    const result = parseDocumentCsv(`document,question,answer\n${row}`);
    assert.equal(result.documents.length, 0);
    assert.equal(result.errors.length, 1);
  }
});

test('caps row count and field lengths before import', () => {
  const rows = Array.from({length: 501}, (_, i) => `Source ${i},Question,Answer`).join('\n');
  assert.match(parseDocumentCsv(`document,question,answer\n${rows}`).errors[0], /500 documents/);
  assert.match(parseDocumentCsv(`document,question,answer\nSource,${'q'.repeat(20001)},Answer`).errors[0], /length limit/);
});
