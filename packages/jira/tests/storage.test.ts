import { describe, expect, test } from "bun:test";
import { storageRefs, storageToMarkdown, type Lookups } from "../src/confluence/storage.ts";

const LOOKUPS: Lookups = {
  users: new Map([["u1", "Ann Lee"]]),
  diagrams: new Map<string, string | null>([
    ["flow", "flowchart TD\n  A --> B\n"],
    ["lost", null],
  ]),
};

const render = (xhtml: string) => storageToMarkdown(xhtml, LOOKUPS);

const macro = (name: string, inner: string) =>
  `<ac:structured-macro ac:name="${name}">${inner}</ac:structured-macro>`;

const param = (name: string, value: string) =>
  `<ac:parameter ac:name="${name}">${value}</ac:parameter>`;

describe("storageToMarkdown", () => {
  test("keeps tables as tables, with multi-line cells, escaped pipes, and colspan", () => {
    const xhtml = `<table><tbody>
      <tr><th><p>Field</p></th><th><p>Source</p></th><th><p>Target</p></th></tr>
      <tr><td><p>Destination</p></td><td><p>CO and CP</p><p>a|b</p></td><td>CP<br/>only</td></tr>
      <tr><td colspan="2">Merged</td><td>z</td></tr>
    </tbody></table>`;
    expect(render(xhtml)).toBe(
      [
        "| Field | Source | Target |",
        "| --- | --- | --- |",
        "| Destination | CO and CP<br>a\\|b | CP<br>only |",
        "| Merged |  | z |",
      ].join("\n"),
    );
  });

  test("changes Mermaid macros to mermaid code blocks", () => {
    const cloud = macro("mermaid-cloud", param("filename", "flow") + param("revision", "2"));
    const missing = macro("mermaid-cloud", param("filename", "lost"));
    const inline = macro(
      "mermaid-macro",
      "<ac:plain-text-body><![CDATA[graph LR\n  X --> Y]]></ac:plain-text-body>",
    );
    expect(render(cloud + missing + inline)).toBe(
      [
        "```mermaid",
        "flowchart TD",
        "  A --> B",
        "```",
        "",
        "[Mermaid diagram 'lost': no source found]",
        "",
        "```mermaid",
        "graph LR",
        "  X --> Y",
        "```",
      ].join("\n"),
    );
  });

  test("changes links, mentions, status labels, and code macros", () => {
    const xhtml = [
      "<p>See ",
      '<ac:link><ri:page ri:content-title="Spec" /></ac:link>, ',
      '<ac:link><ri:page ri:content-title="PRD" /><ac:plain-text-link-body><![CDATA[the PRD]]></ac:plain-text-link-body></ac:link>, ',
      '<ac:link><ri:user ri:account-id="u1" /></ac:link> and ',
      '<ri:user ri:account-id="u2" />. ',
      macro("status", param("title", "IN REVIEW")),
      "</p>",
      macro(
        "code",
        param("language", "ts") +
          "<ac:plain-text-body><![CDATA[const a = 1 < 2;]]></ac:plain-text-body>",
      ),
    ].join("");
    expect(render(xhtml)).toBe(
      [
        "See [[Spec]], the PRD [[PRD]], @Ann Lee and @unknown user. [IN REVIEW]",
        "",
        "```ts",
        "const a = 1 < 2;",
        "```",
      ].join("\n"),
    );
  });

  test("changes panels to block quotes and tasks to check boxes", () => {
    const xhtml =
      macro(
        "warning",
        param("title", "Careful") +
          "<ac:rich-text-body><p>Line one</p><p>Line two</p></ac:rich-text-body>",
      ) +
      "<ac:task-list>" +
      "<ac:task><ac:task-id>1</ac:task-id><ac:task-status>complete</ac:task-status><ac:task-body>Done thing</ac:task-body></ac:task>" +
      "<ac:task><ac:task-id>2</ac:task-id><ac:task-status>incomplete</ac:task-status><ac:task-body>Open thing</ac:task-body></ac:task>" +
      "</ac:task-list>" +
      macro("toc", "") +
      macro("roadmap", "");
    expect(render(xhtml)).toBe(
      [
        "> **Warning: Careful**",
        ">",
        "> Line one",
        ">",
        "> Line two",
        "",
        "- [x] Done thing",
        "- [ ] Open thing",
        "",
        "[roadmap macro]",
      ].join("\n"),
    );
  });

  test("indents nested lists and formats headings and inline marks", () => {
    const xhtml =
      "<h2>Plan</h2><ul><li><p><strong>Bold</strong> and <em>soft</em></p><ol><li>first</li><li>second</li></ol></li><li>last</li></ul>";
    expect(render(xhtml)).toBe(
      ["## Plan", "", "- **Bold** and _soft_", "  1. first", "  2. second", "- last"].join("\n"),
    );
  });
});

test("storageRefs finds each user once and the mermaid-cloud diagrams", () => {
  const xhtml =
    '<p><ri:user ri:account-id="u1" /><ri:user ri:account-id="u1" /><ri:user ri:account-id="u2" /></p>' +
    macro("mermaid-cloud", param("filename", "flow") + param("revision", "3")) +
    macro("info", "<ac:rich-text-body><p>x</p></ac:rich-text-body>");
  expect(storageRefs(xhtml)).toEqual({
    accountIds: ["u1", "u2"],
    diagrams: [{ filename: "flow", revision: "3" }],
  });
});
