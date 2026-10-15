import type { AutocompleteProviderFactory } from "@earendil-works/pi-coding-agent";
import {
  type AutocompleteItem,
  type AutocompleteProvider,
  type AutocompleteSuggestions,
  fuzzyFilter,
} from "@earendil-works/pi-tui";

import type { SkillCommand } from "./skills.ts";

const SKILL_PREFIX = "skill:";

const SLASH_TOKEN = /(?:^|[\s([{<"'`])\/([\w-]*)$/;

/** A `/name` token that ends at the cursor. */
export interface SlashToken {
  /** The text after `/`. */
  query: string;
  /** True if the token is at the start of the message, where pi completes its commands. */
  atStart: boolean;
}

/** Finds the `/name` token that ends at the cursor. */
export function slashToken(lines: string[], line: number, col: number): SlashToken | undefined {
  const before = (lines[line] ?? "").slice(0, col);
  const query = SLASH_TOKEN.exec(before)?.[1];
  if (query === undefined) return undefined;
  const start = before.length - query.length - 1;

  return { query, atStart: line === 0 && before.slice(0, start).trim() === "" };
}

/**
 * Shows the pi skill commands as `/name`, not `/skill:name`. Removes a skill if a command with
 * the same name is in the list.
 */
export function renameSkillItems(
  suggestions: AutocompleteSuggestions | null,
): AutocompleteSuggestions | null {
  if (!suggestions) return null;
  const names = new Set(suggestions.items.map((item) => item.value));
  const items = suggestions.items.flatMap((item) => {
    if (!item.value.startsWith(SKILL_PREFIX)) return [item];
    const name = item.value.slice(SKILL_PREFIX.length);
    return names.has(name) ? [] : [{ ...item, value: name, label: name }];
  });

  return { ...suggestions, items };
}

type SuggestArgs = Parameters<AutocompleteProvider["getSuggestions"]>;

type ApplyArgs = Parameters<AutocompleteProvider["applyCompletion"]>;

function skillSuggestions(
  token: SlashToken,
  skills: SkillCommand[],
): AutocompleteSuggestions | null {
  const items = fuzzyFilter(skills, token.query, (skill) => skill.name).map(
    ({ name, description }) => ({
      value: name,
      label: name,
      ...(description === undefined ? {} : { description }),
    }),
  );

  return items.length > 0 ? { items, prefix: `/${token.query}` } : null;
}

function insertSkill(lines: string[], line: number, col: number, item: AutocompleteItem) {
  const text = lines[line] ?? "";
  const before = text.slice(0, col).replace(/\/[\w-]*$/, `/${item.value}`);
  const after = text.slice(col);
  const space = /^\s/.test(after) ? "" : " ";
  const result = [...lines];
  result[line] = before + space + after;

  return { lines: result, cursorLine: line, cursorCol: before.length + space.length };
}

/**
 * Wraps the pi autocomplete provider. At the start of the message, it shows skills as `/name`.
 * In other positions, it shows the skills that match a `/name` token.
 */
class SkillAutocomplete implements AutocompleteProvider {
  readonly #base: AutocompleteProvider;
  readonly #skills: () => SkillCommand[];
  readonly #ours = new WeakSet<AutocompleteItem>();
  triggerCharacters?: string[];
  shouldTriggerFileCompletion?: NonNullable<AutocompleteProvider["shouldTriggerFileCompletion"]>;

  constructor(base: AutocompleteProvider, skills: () => SkillCommand[]) {
    this.#base = base;
    this.#skills = skills;
    if (base.triggerCharacters) this.triggerCharacters = base.triggerCharacters;
    if (base.shouldTriggerFileCompletion) {
      this.shouldTriggerFileCompletion = base.shouldTriggerFileCompletion.bind(base);
    }
  }

  async getSuggestions(...args: SuggestArgs): Promise<AutocompleteSuggestions | null> {
    const token = slashToken(args[0], args[1], args[2]);
    if (!token) return this.#base.getSuggestions(...args);
    if (token.atStart) return renameSkillItems(await this.#base.getSuggestions(...args));

    return this.#tokenSuggestions(token, args);
  }

  applyCompletion(...args: ApplyArgs): ReturnType<AutocompleteProvider["applyCompletion"]> {
    const [lines, line, col, item] = args;
    if (!this.#ours.has(item)) return this.#base.applyCompletion(...args);

    return insertSkill(lines, line, col, item);
  }

  async #tokenSuggestions(token: SlashToken, args: SuggestArgs) {
    const found = skillSuggestions(token, this.#skills());
    for (const item of found?.items ?? []) this.#ours.add(item);
    if (found || args[3].force !== true) return found;

    return this.#base.getSuggestions(...args);
  }
}

/** Makes the autocomplete provider factory for `ctx.ui.addAutocompleteProvider`. */
export function skillAutocomplete(skills: () => SkillCommand[]): AutocompleteProviderFactory {
  return (base) => new SkillAutocomplete(base, skills);
}
