/** The characters that can come before a `/name` token. */
const TOKEN_START = String.raw`(?<=^|[\s([{<"'\x60])`;

const SKILL_REF = new RegExp(String.raw`${TOKEN_START}/(?:skill:)?([\w-]+)(?![\w/:-]|\.\w)`, "g");

const SKILL_BLOCK = /<skill name="[^"]*" location="[^"]*">\n[\s\S]*?\n<\/skill>/g;

/**
 * Finds the names in the `/name` and `/skill:name` tokens of the text, in order and without
 * duplicates. A token can be anywhere in the text. The names can be names of skills or not. The
 * function ignores the text in the `<skill>` blocks that `skill-commands` adds.
 */
export function skillRefs(text: string): string[] {
  const user = text.replace(SKILL_BLOCK, "");

  return [...new Set([...user.matchAll(SKILL_REF)].map((match) => match[1] ?? ""))];
}
