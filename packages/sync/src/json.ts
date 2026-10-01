import { applyEdits, findNodeAtLocation, type JSONPath, modify, parseTree } from "jsonc-parser";

const editOptions = { formattingOptions: { insertSpaces: true, tabSize: 2 } };

/**
 * Sets the value at a path in a JSON or JSONC text. It makes the parent objects when they do not
 * exist. It keeps the comments and the format of the other text.
 */
export function setJsonValue(text: string, path: JSONPath, value: unknown): string {
  return applyEdits(text, modify(text, path, value, editOptions));
}

function appendJsonValue(text: string, path: JSONPath, value: unknown): string {
  const options = { ...editOptions, isArrayInsertion: true };
  return applyEdits(text, modify(text, [...path, -1], value, options));
}

/**
 * Adds values to the end of the array at a path in a JSON or JSONC text. It makes the array when it
 * does not exist. It keeps the comments and the format of the other text.
 */
export function appendJsonValues(text: string, path: JSONPath, values: unknown[]): string {
  const tree = parseTree(text, [], { allowTrailingComma: true });
  const node = tree === undefined ? undefined : findNodeAtLocation(tree, path);
  if (node === undefined) return setJsonValue(text, path, values);
  if (node.type !== "array") throw new Error(`${JSON.stringify(path)} is not an array`);
  return values.reduce<string>((next, value) => appendJsonValue(next, path, value), text);
}
