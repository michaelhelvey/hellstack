/** Parses JSON text. Returns undefined if the text is not valid JSON. */
export function parseJsonOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
