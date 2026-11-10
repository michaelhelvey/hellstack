/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BunServices } from "@effect/platform-bun";
import { testRender } from "@opentui/solid";
import { Effect, Layer, Logger } from "effect";
import { Dashboard } from "../src/dashboard.ts";
import { Github } from "../src/github.ts";
import { HiddenStore } from "../src/hidden.ts";
import { DashError, type GithubItem, type SentryItem } from "../src/item.ts";
import { Sentry } from "../src/sentry.ts";
import { App } from "../src/ui/app.tsx";
import { connect } from "../src/ui/run.ts";

const dirs: Array<string> = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const notification = (id: string, title: string): GithubItem => ({
  kind: "github",
  id,
  title,
  url: `https://github.com/o/r/pull/${id}`,
  repo: "o/r",
  reason: "review_requested",
  type: "PullRequest",
  updatedAt: "2026-11-10T00:00:00Z",
});

const issue = (id: string, title: string): SentryItem => ({
  kind: "sentry",
  id,
  title,
  url: `https://example.sentry.io/issues/${id}/`,
  project: "platform",
  shortId: `PLATFORM-${id}`,
  count: 3,
  lastSeen: new Date().toISOString(),
});

/** The fake Sentry source cannot resolve this issue. */
const BROKEN = issue("12", "Issue that cannot be resolved");

/**
 * In-memory sources. `done` and `resolve` remove the item and record the call. `resolve` fails for
 * `BROKEN`.
 */
const fakeSources = () => {
  const calls: Array<string> = [];
  let notifications = [notification("1", "Review the auth PR"), notification("2", "Bump deps")];
  let issues = [issue("10", "TypeError in handler"), issue("11", "NUL byte in text"), BROKEN];

  const resolve = (id: string) =>
    Effect.sync(() => {
      calls.push(`resolve ${id}`);
      issues = issues.filter((item) => item.id !== id);
    });

  const layer = Layer.mergeAll(
    Layer.succeed(
      Github,
      Github.of({
        list: Effect.sync(() => notifications),
        done: (id) =>
          Effect.sync(() => {
            calls.push(`done ${id}`);
            notifications = notifications.filter((item) => item.id !== id);
          }),
      }),
    ),
    Layer.succeed(
      Sentry,
      Sentry.of({
        list: Effect.sync(() => issues),
        resolve: (id) =>
          id === BROKEN.id
            ? Effect.fail(new DashError({ message: "sentry said no" }))
            : resolve(id),
      }),
    ),
  );
  return { calls, layer };
};

/** True if a row of a pane shows `title`. The status line can also show a title, so skip it. */
const listed = (frame: string, title: string) =>
  frame
    .split("\n")
    .filter((line) => line.startsWith("│"))
    .some((line) => line.includes(title));

type Setup = Awaited<ReturnType<typeof testRender>>;

/**
 * Renders until a frame matches `predicate`, for at most 2 seconds. `waitForFrame` counts render
 * passes and not time, so it can stop before a real file write completes.
 */
const until = async (
  app: Setup,
  predicate: (frame: string) => boolean,
  deadline = Date.now() + 2_000,
): Promise<string> => {
  await app.renderOnce();
  const frame = app.captureCharFrame();
  if (predicate(frame)) return frame;
  if (Date.now() > deadline) throw new Error(`no frame matched. last frame:\n${frame}`);
  await Bun.sleep(10);
  return until(app, predicate, deadline);
};

const renderApp = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "dash-app-"));
  dirs.push(dir);
  const sources = fakeSources();
  const layer = Dashboard.layer.pipe(
    Layer.provide(sources.layer),
    Layer.provide(HiddenStore.layerAt(path.join(dir, "hidden.json"))),
    Layer.provideMerge(BunServices.layer),
    Layer.provideMerge(Logger.layer([])),
  );
  const connection = await Effect.runPromise(Effect.provide(connect, layer));
  const app = await testRender(() => <App {...connection} pollMs={3_600_000} />, {
    width: 140,
    height: 24,
  });
  await until(app, (frame) => listed(frame, "TypeError in handler"));
  return { app, calls: sources.calls };
};

test("h hides a sentry row until C clears the hidden list", async () => {
  const { app, calls } = await renderApp();
  try {
    app.mockInput.pressTab();
    app.mockInput.pressKey("h");
    const hidden = await until(
      app,
      (frame) => !listed(frame, "TypeError in handler") && frame.includes("[clear hidden (1)]"),
    );

    expect(listed(hidden, "NUL byte in text")).toBe(true);

    app.mockInput.pressKey("g");
    const refreshed = await until(
      app,
      (frame) => !frame.includes("hide: TypeError") && !frame.includes("loading"),
    );

    expect(listed(refreshed, "TypeError in handler")).toBe(false);

    app.mockInput.pressKey("C");
    const shown = await until(app, (frame) => listed(frame, "TypeError in handler"));

    expect(shown).toContain("[clear hidden (0)]");
    expect(calls).toEqual([]);
  } finally {
    app.renderer.destroy();
  }
});

test("d marks the selected github thread done in the source", async () => {
  const { app, calls } = await renderApp();
  try {
    app.mockInput.pressArrow("down");
    app.mockInput.pressKey("d");
    const frame = await until(app, (frame) => !listed(frame, "Bump deps"));

    expect(listed(frame, "Review the auth PR")).toBe(true);
    expect(calls).toEqual(["done 2"]);
  } finally {
    app.renderer.destroy();
  }
});

test("a click on an action button runs the action of that row", async () => {
  const { app, calls } = await renderApp();
  try {
    const rows = app.captureCharFrame().split("\n");
    const y = rows.findIndex((row) => row.includes("NUL byte in text"));
    const x = rows[y]?.indexOf("[resolve]") ?? -1;

    expect(x).toBeGreaterThan(0);

    await app.mockMouse.click(x + 1, y);
    await until(app, (frame) => !listed(frame, "NUL byte in text"));

    expect(calls).toEqual(["resolve 11"]);
  } finally {
    app.renderer.destroy();
  }
});

test("a failed action puts the row back and shows the error", async () => {
  const { app } = await renderApp();
  try {
    app.mockInput.pressTab();
    app.mockInput.pressKey("j");
    app.mockInput.pressKey("j");
    app.mockInput.pressKey("r");
    const frame = await until(app, (frame) => frame.includes("resolve failed: sentry said no"));

    expect(listed(frame, BROKEN.title)).toBe(true);
    expect(frame).toContain("Sentry (3)");
  } finally {
    app.renderer.destroy();
  }
});
