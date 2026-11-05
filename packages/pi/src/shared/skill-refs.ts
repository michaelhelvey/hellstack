/** The characters that can come before a `/name` token. */
const TOKEN_START = String.raw`(?<=^|[\s([{<"'\x60])`;

const SKILL_REF = new RegExp(String.raw`${TOKEN_START}/(?:skill:)?([\w-]+)(?![\w/:-]|\.\w)`, "g");

const SKILL_BLOCK = /<skill name="[^"]*" location="[^"]*">\n[\s\S]*?\n<\/skill>/g;

/** Tells if the match is the `/name` of a closing tag `</name>`. */
function isClosingTag(text: string, match: RegExpExecArray): boolean {
  return text[match.index - 1] === "<" && text[match.index + match[0].length] === ">";
}

/**
 * Finds the names in the `/name` and `/skill:name` tokens of the text, in order and without
 * duplicates. A token can be anywhere in the text. The names can be names of skills or not. The
 * function ignores the text in the `<skill>` blocks that `skill-commands` adds, and closing tags
 * such as `</name>`.
 */
export function skillRefs(text: string): string[] {
  const user = text.replace(SKILL_BLOCK, "");
  const refs = [...user.matchAll(SKILL_REF)].filter((match) => !isClosingTag(user, match));

  return [...new Set(refs.map((match) => match[1] ?? ""))];
}
