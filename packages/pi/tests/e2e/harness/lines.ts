/**
 * Reads a byte stream and calls `onLine` for each LF-terminated line. Pi RPC records can contain
 * U+2028 and U+2029 inside JSON strings, so this function splits only on LF.
 */
export async function readLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const bytes of stream) {
    buffer = emitLines(buffer + decoder.decode(bytes, { stream: true }), onLine);
  }
  if (buffer) onLine(buffer);
}

/** Calls `onLine` for each complete line of `text`. Returns the text after the last LF. */
function emitLines(text: string, onLine: (line: string) => void): string {
  const lines = text.split("\n");
  const rest = lines.pop() ?? "";
  for (const line of lines) onLine(line.replace(/\r$/, ""));
  return rest;
}

/** Reads all of a byte stream as text. */
export function readText(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}
