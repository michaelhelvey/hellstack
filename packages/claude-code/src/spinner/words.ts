/** A source of random numbers from 0 (included) to 1 (not included), such as `Math.random`. */
export type Random = () => number;

/** The verbs that start a spinner word. */
export const verbs = [
  "Chewing",
  "Gnawing on",
  "Dust bathing in",
  "Hoarding",
  "Popcorning over",
  "Yelling at",
  "Scurrying past",
  "Goblining",
  "Uwuing at",
  "Jorkin",
  "Licking",
  "Biting",
  "Seducing",
  "Fighting",
  "Rewriting",
  "Sniffing",
  "Burying",
  "Stealing",
  "Vibing with",
  "Hissing at",
  "Squeaking at",
  "Nesting in",
  "Pooping on",
  "Gaslighting",
  "Interrogating",
  "Microwaving",
  "Unionizing",
  "Speedrunning",
  "Manifesting",
  "Doomscrolling",
  "Ghosting",
  "Rawdogging",
  "Fucking up",
  "Unfucking",
  "Blessing",
  "Cursing",
  "Haunting",
  "Smuggling",
  "Overthinking",
  "Yeeting",
];

/** The objects that can follow a verb. */
export const targets = [
  "the cables",
  "your codebase",
  "a raisin",
  "the prod database",
  "the stack trace",
  "the borrow checker",
  "a cardboard box",
  "the linter",
  "your git history",
  "node_modules",
  "the CI pipeline",
  "a little guy",
  "the semicolons",
  "the kubernetes cluster",
  "the vibes",
  "my tiny rock",
  "the type system",
  "a pile of dust",
  "the null pointer",
  "your PR",
  "the cache",
  "the documentation",
  "the event loop",
  "the YAML",
  "the senior engineers",
  "a hay cube",
  "the regex",
  "the build",
  "the mainframe",
  "the void",
];

/** The endings that can follow a verb and an object. */
export const tails = [
  "aggressively",
  "for legal reasons",
  "in rust",
  "uwu",
  "with intent",
  "illegally",
  "AT 3AM",
  "for science",
  "respectfully",
  "on purpose",
  "with my teeth",
  "in production",
  "again",
  "while crying",
  "like a little freak",
  "for clout",
  "out of spite",
  "with no survivors",
  "hehe",
  "IN THE DARK",
  "rawr",
  "against medical advice",
  "professionally",
  "one more time",
];

/** The past-tense words for the line at the end of a turn, as in `Gnawed for 3s`. */
export const doneVerbs = [
  "Gnawed",
  "Chewed",
  "Dust bathed",
  "Hoarded",
  "Popcorned",
  "Yelled",
  "Scurried",
  "Goblined",
  "Uwu'd",
  "Jorked",
  "Bit things",
  "Vibed",
  "Hissed",
  "Squeaked",
  "Nested",
  "Gaslit the compiler",
  "Speedran",
  "Manifested",
  "Haunted prod",
  "Smuggled raisins",
  "Overthought",
  "Yeeted",
  "Feralized",
  "Rawdogged it",
  "Fucked around",
  "Found out",
  "Lay in the dust",
  "Committed crimes",
  "Rotted",
  "Went feral",
];

function pick<T>(items: readonly T[], random: Random): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error("cannot pick from an empty list");
  return item;
}

/**
 * Makes a random spinner word: a verb, an object, and sometimes an ending (about half of the
 * time), for example `Gnawing on the prod database aggressively`.
 */
export function spinnerWord(random: Random): string {
  const words = [pick(verbs, random), pick(targets, random)];
  if (random() < 0.5) words.push(pick(tails, random));
  return words.join(" ");
}

/**
 * Picks the past-tense word for one end-of-turn line. The same line always gets the same word,
 * because the transcript draws old lines again.
 */
export function doneWord(word: string, durationMs: number): string {
  return pick(doneVerbs, () => hashUnit(`${word}\0${durationMs}`));
}

function hashUnit(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0) / 2 ** 32;
}
