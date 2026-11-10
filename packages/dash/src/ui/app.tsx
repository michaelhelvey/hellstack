/** @jsxImportSource @opentui/solid */
import type { KeyEvent, MouseEvent, ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/solid";
import { Result } from "effect";
import { createEffect, createSignal, For, onCleanup, onMount } from "solid-js";
import type { Action, Row } from "../dashboard.ts";
import { ACTIONS, type Item, itemKey, KINDS } from "../item.ts";
import { makeHolds } from "./holds.ts";
import type { Connection } from "./run.ts";

type Kind = Item["kind"];

const TITLES = { github: "GitHub", sentry: "Sentry" } as const satisfies Record<Kind, string>;

const NEXT_PANE = { github: "sentry", sentry: "github" } as const satisfies Record<Kind, Kind>;

const COLORS = {
  accent: "#7aa2f7",
  muted: "#737aa2",
  border: "#3b4261",
  selected: "#283457",
  status: "#e0af68",
} as const;

const HINTS =
  "↑↓/jk move  tab pane  enter/click open  d done  r resolve  h hide  C clear hidden  g refresh  q quit";

const ago = (iso: string) => {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`;
};

const context = (item: Item) =>
  item.kind === "github"
    ? `${item.repo} · ${item.reason} · ${item.type}`
    : `${item.project} · ${item.shortId} · ${item.count}× · ${ago(item.lastSeen)}`;

const keyId = (key: KeyEvent) =>
  key.shift && key.name.length === 1 ? key.name.toUpperCase() : key.name;

const sameItem = (a: Row) => (b: Row) => itemKey(a.item) === itemKey(b.item);

const restore = (rows: ReadonlyArray<Row>, row: Row, index: number) =>
  rows.some(sameItem(row)) ? rows : rows.toSpliced(index, 0, row);

const clicked = (handler: () => void) => (event: MouseEvent) => {
  event.stopPropagation();
  handler();
};

interface RowViewProps {
  readonly row: Row;
  readonly selected: boolean;
  readonly onOpen: () => void;
  readonly onAct: (action: Action) => void;
}

const RowView = (props: RowViewProps) => (
  <box
    id={itemKey(props.row.item)}
    flexDirection="row"
    height={1}
    flexShrink={0}
    backgroundColor={props.selected ? COLORS.selected : "transparent"}
    onMouseUp={clicked(props.onOpen)}
  >
    <text flexGrow={1} flexShrink={1} wrapMode="none" truncate>
      {` ${props.row.item.title}`}
    </text>
    <text fg={COLORS.muted} wrapMode="none" flexShrink={0}>
      {`  ${context(props.row.item)} `}
    </text>
    <For each={props.row.actions}>
      {(action) => (
        <text fg={COLORS.accent} flexShrink={0} onMouseUp={clicked(() => props.onAct(action))}>
          {`[${ACTIONS[action.name].label}] `}
        </text>
      )}
    </For>
  </box>
);

interface PaneProps {
  readonly kind: Kind;
  readonly rows: ReadonlyArray<Row>;
  readonly index: number;
  readonly focused: boolean;
  readonly onOpen: (index: number) => void;
  readonly onAct: (row: Row, action: Action) => void;
}

const Pane = (props: PaneProps) => {
  const [scroll, setScroll] = createSignal<ScrollBoxRenderable>();

  createEffect(() => {
    const row = props.rows[props.index];
    if (row !== undefined) scroll()?.scrollChildIntoView(itemKey(row.item));
  });

  return (
    <box
      border
      title={` ${TITLES[props.kind]} (${props.rows.length}) `}
      borderColor={props.focused ? COLORS.accent : COLORS.border}
      flexGrow={1}
      flexDirection="column"
    >
      <scrollbox ref={setScroll} flexGrow={1}>
        <For each={props.rows}>
          {(row, index) => (
            <RowView
              row={row}
              selected={props.focused && index() === props.index}
              onOpen={() => props.onOpen(index())}
              onAct={(action) => props.onAct(row, action)}
            />
          )}
        </For>
      </scrollbox>
    </box>
  );
};

/** The properties of `App`. `pollMs` is the time between two loads of the items. */
export interface AppProps extends Connection {
  readonly pollMs: number;
}

/**
 * The full-screen dashboard. It shows one pane for each kind of item, and loads the items again
 * each `pollMs`. An action removes its row at once, and puts the row back if the action fails.
 * Only the newest load changes the rows. A load that started before an action completed can have
 * old data, thus it does not show the row of that action again.
 *
 * @example
 * ```tsx
 * const connection = yield* connect;
 * await render(() => <App {...connection} pollMs={60_000} />, { useMouse: true });
 * ```
 */
export const App = (props: AppProps) => {
  const renderer = useRenderer();
  const holds = makeHolds();
  const [rows, setRows] = createSignal<ReadonlyArray<Row>>([]);
  const [hidden, setHidden] = createSignal(0);
  const [status, setStatus] = createSignal("loading…");
  const [pane, setPane] = createSignal<Kind>("github");
  const [cursor, setCursor] = createSignal<Record<Kind, number>>({ github: 0, sentry: 0 });

  const paneRows = (kind: Kind) => rows().filter((row) => row.item.kind === kind);
  const index = (kind: Kind) => Math.max(0, Math.min(cursor()[kind], paneRows(kind).length - 1));
  const selected = (): Row | undefined => paneRows(pane())[index(pane())];

  const select = (kind: Kind, to: number) => {
    setPane(kind);
    setCursor((current) => ({ ...current, [kind]: to }));
  };

  const move = (delta: number) => select(pane(), index(pane()) + delta);

  const refreshHidden = async () =>
    Result.match(await props.run(props.dashboard.hiddenCount), {
      onSuccess: setHidden,
      onFailure: setStatus,
    });

  const refresh = async () => {
    const load = holds.start();
    setStatus("loading…");
    const snapshot = Result.getOrThrow(await props.run(props.dashboard.load));
    const fresh = holds.apply(load, snapshot.rows, (row) => itemKey(row.item));
    if (fresh === undefined) return;
    setRows(fresh);
    setHidden(snapshot.hidden);
    setStatus(snapshot.errors.join("; "));
  };

  const act = async (row: Row, action: Action) => {
    const at = rows().findIndex(sameItem(row));
    const key = itemKey(row.item);
    holds.hold(key);
    setRows((current) => current.filter((other) => !sameItem(row)(other)));
    Result.match(await props.run(action.run), {
      onSuccess: () => {
        holds.settle(key);
        setStatus(`${action.name}: ${row.item.title}`);
      },
      onFailure: (message) => {
        holds.release(key);
        setRows((current) => restore(current, row, at));
        setStatus(`${action.name} failed: ${message}`);
      },
    });
    await refreshHidden();
  };

  const open = async (row: Row) =>
    Result.match(await props.run(props.dashboard.open(row.item)), {
      onSuccess: () => setStatus(`opened ${row.item.url}`),
      onFailure: setStatus,
    });

  const clearHidden = async () => {
    Result.match(await props.run(props.dashboard.clearHidden), {
      onSuccess: () => setHidden(0),
      onFailure: setStatus,
    });
    await refresh();
  };

  const withSelected = (handler: (row: Row) => unknown) => () => {
    const row = selected();
    if (row !== undefined) void handler(row);
  };

  const actByKey = (key: string) =>
    withSelected((row) => {
      const action = row.actions.find((candidate) => ACTIONS[candidate.name].key === key);
      return action === undefined ? undefined : act(row, action);
    });

  const keys: Readonly<Record<string, () => unknown>> = {
    up: () => move(-1),
    k: () => move(-1),
    down: () => move(1),
    j: () => move(1),
    tab: () => setPane(NEXT_PANE[pane()]),
    return: withSelected(open),
    g: refresh,
    C: clearHidden,
    q: () => renderer.destroy(),
  };

  useKeyboard((key) => {
    const id = keyId(key);
    (keys[id] ?? actByKey(id))();
  });

  onMount(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), props.pollMs);
    onCleanup(() => clearInterval(timer));
  });

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="row" height={1} flexShrink={0}>
        <text fg={COLORS.accent}>{" whatsgoingon  "}</text>
        <text onMouseUp={clicked(() => void refresh())}>{"[refresh] "}</text>
        <text onMouseUp={clicked(() => void clearHidden())}>{`[clear hidden (${hidden()})]`}</text>
      </box>
      <For each={KINDS}>
        {(kind) => (
          <Pane
            kind={kind}
            rows={paneRows(kind)}
            index={index(kind)}
            focused={pane() === kind}
            onOpen={(to) => {
              select(kind, to);
              withSelected(open)();
            }}
            onAct={(row, action) => void act(row, action)}
          />
        )}
      </For>
      <text fg={COLORS.status} height={1} flexShrink={0} wrapMode="none" truncate>
        {` ${status()}`}
      </text>
      <text fg={COLORS.muted} height={1} flexShrink={0} wrapMode="none" truncate>
        {` ${HINTS}`}
      </text>
    </box>
  );
};
