import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** A status word that herdr-core accepts in an OSC 7501 report. */
export type StatusState = "idle" | "working" | "done" | "blocked";

/** The reason that a blocked program needs the user. */
export type StatusKind = "permission" | "question" | "auth";

/** One status record for herdr-core. */
export interface StatusReport {
  state: StatusState;
  kind?: StatusKind;
  message?: string;
}

/** The longest `msg` value after base64 decoding, from the Program Status Protocol. */
const MAX_MESSAGE_BYTES = 2048;

/** True for a C0 or C1 control character, which OSC 7501 does not allow in text. */
function isControl(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

/** Removes control characters and cuts the text to a maximum UTF-8 byte length. */
export function statusText(text: string, maxBytes = MAX_MESSAGE_BYTES): string {
  const clean = Array.from(text, (character) => (isControl(character) ? " " : character))
    .join("")
    .trim();

  let bytes = 0;
  const kept: string[] = [];
  for (const character of clean) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > maxBytes) break;
    bytes += size;
    kept.push(character);
  }
  return kept.join("");
}

/** Returns the OSC 7501 report for herdr-core. */
export function statusReport(report: StatusReport): string {
  const fields = [`state=${report.state}`, "app=pi"];
  if (report.kind !== undefined) fields.push(`kind=${report.kind}`);
  const message = report.message === undefined ? "" : statusText(report.message);
  if (message.length > 0) fields.push(`msg=${Buffer.from(message, "utf8").toString("base64")}`);

  return `\x1b]7501;${fields.join(":")}\x1b\\`;
}

/** Returns the OSC 7501 report that removes the status of pi. */
export function clearReport(): string {
  return "\x1b]7501;state=clear:app=pi\x1b\\";
}

/**
 * Reports the state of pi to herdr-core through OSC 7501. It reports `working` during a run,
 * `done` when a run settles, `blocked` while a dialog waits for the user, and `idle` at rest. It
 * also emits the `herdr:blocked` event for other extensions. Outside a herdr-core terminal or
 * outside the TUI, it does nothing.
 */
export default function herdrStatus(pi: ExtensionAPI): void {
  if (!process.env.HC_TERMINAL_ID) return;

  let root = false;
  let active = false;
  let rest: "idle" | "done" = "idle";
  let blocked = 0;
  let blockedKind: StatusKind = "question";
  let blockedMessage: string | undefined;
  let last = "";

  function report(): StatusReport {
    if (blocked > 0) {
      return {
        state: "blocked",
        kind: blockedKind,
        ...(blockedMessage === undefined ? {} : { message: blockedMessage }),
      };
    }
    return active ? { state: "working" } : { state: rest };
  }

  function publish(force = false): void {
    const sequence = statusReport(report());
    if (!force && sequence === last) return;
    last = sequence;
    process.stdout.write(sequence);
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    root = true;
    active = !ctx.isIdle();
    rest = "idle";
    publish(true);
  });

  pi.on("agent_start", () => {
    if (!root) return;
    active = true;
    publish();
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (!root || ctx.isIdle() !== true) return;
    active = false;
    rest = "done";
    publish();
  });

  pi.on("ui_prompt_start", (event) => {
    pi.events.emit("herdr:blocked", { active: true, label: event.title });
    if (!root) return;
    blocked += 1;
    blockedKind = event.kind === "confirm" ? "permission" : "question";
    if (event.title !== undefined) blockedMessage = event.title;
    publish();
  });

  pi.on("ui_prompt_end", () => {
    pi.events.emit("herdr:blocked", { active: false });
    if (!root) return;
    blocked = Math.max(0, blocked - 1);
    if (blocked === 0) blockedMessage = undefined;
    publish();
  });

  pi.on("session_shutdown", () => {
    if (!root) return;
    root = false;
    process.stdout.write(clearReport());
  });
}
