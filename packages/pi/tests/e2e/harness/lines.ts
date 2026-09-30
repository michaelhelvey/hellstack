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
    buffer += decoder.decode(bytes, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) onLine(line.replace(/\r$/, ""));
  }
  if (buffer) onLine(buffer);
}

/** Reads all of a byte stream as text. */
export function readText(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}
