# Rippling 1:1 docs

## Page layout

- The 1:1 page has a list of meeting notes in a left panel. The newest note is at the top. Each note
  has the title `<Member first name> / <Manager first name> - <Mon DD>`. A note without a date has
  no date in its title.
- The notes show in one column on the right, newest first. Each note is a separate Lexical editor
  (`[data-lexical-editor="true"]`). The editor of the newest note is the first one in the DOM.
- Each note has a date chip (`MM/DD/YYYY`) and a **Templates** button next to its title.
- The editor uses its own node types: `p-paragraph`, `p-heading`, `p-text`, `p-list`, and
  `p-list-item`. Links in the Wins/Progress list are plain `p-text` nodes, not link nodes.

Do not read `innerHTML` with a browser tool. Some tools block output that has URLs with query
strings. Use the scripts below. They replace URLs with `<URL>` where the full URL is not necessary.

<a id="read"></a>

## Read a doc

Click the note in the left panel first, so that its editor is the first editor in the DOM. Then run
this script in the page. It prints the text of the Wins/Progress section with full URLs.

```js
(() => {
  const root = document.querySelector('[data-lexical-editor="true"]');
  const blocks = root.__lexicalEditor.getEditorState().toJSON().root.children;
  const text = (n) => n.text ?? (n.children ?? []).map(text).join("");
  const own = (n) =>
    n.children
      .filter((c) => c.type !== "p-list")
      .map(text)
      .join("");
  const lines = (n, depth) =>
    n.type === "p-list"
      ? n.children.flatMap((item) => lines(item, depth))
      : [own(n).trim() && "  ".repeat(depth) + "- " + own(n)]
          .concat(n.children.filter((c) => c.type === "p-list").flatMap((l) => lines(l, depth + 1)))
          .filter(Boolean);
  const start = blocks.findIndex((b) => text(b).startsWith("Wins/Progress"));
  const end = blocks.findIndex((b, i) => i > start && b.type === "p-heading" && text(b).trim());
  return blocks
    .slice(start + 1, end)
    .flatMap((b) => (b.type === "p-list" ? lines(b, 0) : [text(b)]))
    .join("\n");
})();
```

<a id="new-note"></a>

## Make a note

1. Click **New meeting notes** at the top of the notes column. A menu opens.
2. Click **Notes without calendar event**. Rippling adds an empty note at the top.
3. Click **Templates** next to the title of the new note, and click the template from the config.
   The search box in the menu does not always get the focus, so click the template name directly.
   The template adds the headings and empty bullets.
4. Click the date chip (`MM/DD/YYYY`) and click **Today**. The title changes to include the date.
5. Fill in the header lines. For each of "Team Member:", "Manager:", and "Date:", click the line,
   press `End`, and type a space and the value (use the names from the config, and the date as
   `MM/DD/YYYY`). Do not fill in "Core Value Shared:".

<a id="write"></a>

## Write the list

Run this script in the page. Set `note` and `items` first. The script does not use the caret. It
finds the Wins/Progress heading in the newest note and puts the note paragraph and the list after
it:

- If the block after the heading is the empty list of the template, the script replaces it.
- If the block after the heading is the next heading, the script adds the blocks after the
  Wins/Progress heading.
- If the block after the heading has text, the script stops and changes nothing. Ask the user what
  to do.

```js
(() => {
  const note = "Generated with the assistance of <model name>";
  const items = [{ label: "[Workstream]", text: "Result sentence", links: ["https://..."] }];

  const editor = document.querySelector('[data-lexical-editor="true"]').__lexicalEditor;
  const t = (text, format = 0) => ({
    type: "p-text",
    detail: 0,
    format,
    mode: "normal",
    style: "",
    text,
  });
  const li = (children, value, indent = 0) => ({ type: "p-list-item", indent, value, children });
  const ul = (children) => ({ type: "p-list", listType: "bullet", start: 1, tag: "ul", children });
  const list = ul(
    items.flatMap((item, i) => [
      li([t(item.label, 1), t(" " + item.text)], i * 2 + 1),
      li([ul(item.links.map((url, j) => li([t(url)], j + 1, 1)))], i * 2 + 2),
    ]),
  );
  const para = { type: "p-paragraph", textFormat: 2, children: [t(note, 2)] };
  const build = (json) => {
    const base = { version: 1, direction: null, format: "", indent: 0, style: "" };
    const node = editor._nodes.get(json.type).klass.importJSON({ ...base, ...json });
    for (const child of json.children ?? []) node.append(build(child));
    return node;
  };

  let result = "";
  editor.update(() => {
    const blocks = editor._pendingEditorState._nodeMap.get("root").getChildren();
    const heading = blocks.find((b) => b.getTextContent().startsWith("Wins/Progress"));
    const next = heading?.getNextSibling();
    if (!heading || !next) {
      result = "no Wins/Progress heading";
      return;
    }
    const empty = next.getType() === "p-list" && next.getTextContent().trim() === "";
    if (!empty && next.getType() !== "p-heading") {
      result = "Wins/Progress is not empty: " + next.getTextContent().slice(0, 80);
      return;
    }
    const listNode = build(list);
    if (empty) next.replace(listNode);
    else heading.insertAfter(listNode);
    listNode.insertBefore(build(para));
    result = "inserted " + items.length + " items";
  });
  return result;
})();
```

Then [read the doc](#read) again. Make sure that the note paragraph and the list are under
Wins/Progress, and that the next heading did not move. If the result is not correct, press `Cmd+Z`
(or `Ctrl+Z`) until the change is gone, and try again.

Rippling saves the doc automatically. There is no save button.
