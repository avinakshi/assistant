declare module 'pdf-parse/lib/pdf-parse.js' {
  const pdfParse: (buffer: Buffer | Uint8Array) => Promise<{ text: string }>;
  export default pdfParse;
}
