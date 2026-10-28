// Offline stub: records calls so tests can assert export behaviour.
const calls = (globalThis.__xlsxCalls = globalThis.__xlsxCalls || []);
export const utils = {
  book_new: () => ({ SheetNames: [], Sheets: {} }),
  json_to_sheet: (rows) => ({ __rows: rows }),
  book_append_sheet: (wb, ws, name) => { wb.SheetNames.push(name); wb.Sheets[name] = ws; },
  sheet_to_json: (ws) => (ws && ws.__rows) || [],
};
export const writeFile = (wb, name) => { calls.push({ name, sheets: wb.SheetNames, counts: wb.SheetNames.map(n => wb.Sheets[n].__rows.length), wb }); };
export const read = (data) => globalThis.__xlsxReadResult || { SheetNames: ['S'], Sheets: { S: { __rows: [] } } };
