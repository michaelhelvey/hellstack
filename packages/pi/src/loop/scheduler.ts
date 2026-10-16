import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** The shortest delay of a wakeup or a loop, in seconds. */
export const MIN_DELAY_S = 60;

/** The longest delay of a wakeup, in seconds. */
export const MAX_DELAY_S = 3600;

const IDLE_RETRY_MS = 1000;

type Idle = Pick<ExtensionContext, "isIdle">;

/**
 * One pending wakeup and one loop for each session. A fire sends the prompt as a follow-up user
 * message, which runs at once when the agent is idle.
 */
export class Scheduler {
  #wakeup: NodeJS.Timeout | undefined;
  #loop: NodeJS.Timeout | undefined;
  #selfPaced = false;
  /** True while a run is in flight. `ctx.isIdle()` is also false during a manual compaction. */
  #running = false;
  /**
   * True from a `/loop` command that ends or replaces the loop during a run, until that run
   * settles. That run cannot change the wakeup, so the loop that the user ended does not come back,
   * and the loop that replaced it is not cancelled.
   */
  #sealed = false;

  constructor(private readonly send: ExtensionAPI["sendUserMessage"]) {}

  /** Marks the start of a run. */
  onRunStart(): void {
    this.#running = true;
  }

  /** Marks the end of a run. The next run can change the wakeup again. */
  onRunSettled(): void {
    this.#running = false;
    this.#sealed = false;
  }

  /** Schedules a wakeup for the model, unless a `/loop` command sealed this run. */
  requestWakeup(seconds: number, prompt: string, ctx: Idle): string {
    if (this.#sealed) return "Not scheduled: the user ended or replaced the loop during this run.";
    this.scheduleWakeup(seconds, prompt, ctx);
    return `Wakeup scheduled in ${seconds}s. It replaces any earlier wakeup.`;
  }

  /** Cancels the wakeup for the model, unless a `/loop` command sealed this run. */
  requestCancel(): string {
    if (this.#sealed) return "Not cancelled: the user replaced the loop during this run.";
    return this.cancelWakeup() ? "Wakeup cancelled." : "No wakeup.";
  }

  /** Sends the prompt now. */
  fire(prompt: string): void {
    this.send(prompt, { deliverAs: "followUp", expandPromptTemplates: true });
  }

  /** Replaces the pending wakeup. A due wakeup waits until the session is idle. */
  scheduleWakeup(seconds: number, prompt: string, ctx: Idle): void {
    this.cancelWakeup();
    const deliver = (): void => {
      this.#wakeup = ctx.isIdle() ? undefined : setTimeout(deliver, IDLE_RETRY_MS).unref();
      if (this.#wakeup === undefined) this.fire(prompt);
    };
    this.#wakeup = setTimeout(deliver, seconds * 1000).unref();
  }

  /** Cancels the pending wakeup. Returns false when no wakeup was pending. */
  cancelWakeup(): boolean {
    const had = this.#wakeup !== undefined;
    clearTimeout(this.#wakeup);
    this.#wakeup = undefined;
    return had;
  }

  /** Fires the prompt each interval. A tick during a run is dropped, so ticks do not pile up. */
  startLoop(seconds: number, prompt: string, ctx: Idle): void {
    this.#loop = setInterval(() => ctx.isIdle() && this.fire(prompt), seconds * 1000).unref();
  }

  /** Marks a self-paced loop, which has no timer of its own while its iteration runs. */
  startSelfPaced(): void {
    this.#selfPaced = true;
  }

  /** Ends the loop and the pending wakeup. Returns false when there was nothing to end. */
  stopAll(): boolean {
    const had = [this.#loop !== undefined, this.#selfPaced, this.cancelWakeup()].some(Boolean);
    clearInterval(this.#loop);
    this.#loop = undefined;
    this.#selfPaced = false;
    this.#sealed ||= this.#running;
    return had;
  }
}
