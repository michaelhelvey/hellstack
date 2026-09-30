#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "beautifulsoup4>=4.15.0",
#     "markdownify>=1.2.3",
#     "pydantic>=2.11",
# ]
# ///
"""Print a Confluence page as Markdown.

Usage:
    render-confluence.py <PAGE-ID or page URL>

Mermaid diagrams become ```mermaid code blocks. The "mermaid-cloud" macro keeps
the diagram source in a page attachment, so the script downloads that attachment.
Tables stay tables. A cell with more than one line uses <br> between the lines.
"""

from __future__ import annotations

import re
import subprocess
import sys
import urllib.parse
from pathlib import Path

from bs4 import BeautifulSoup, Tag
from bs4.element import CData, NavigableString
from markdownify import ATX, MarkdownConverter
from pydantic import BaseModel, Field

API = Path(__file__).resolve().parent / "api"
PANELS = {"info", "note", "tip", "warning", "panel", "success", "error"}
DROPPED_MACROS = {"toc", "anchor", "children", "pagetree", "recently-updated"}
LINE_BREAK = "\ue000"


class Storage(BaseModel):
    """The storage format (XHTML) body of a page."""

    value: str


class Body(BaseModel):
    """The body of a page."""

    storage: Storage


class Page(BaseModel):
    """A Confluence page from the v2 API."""

    id: str
    title: str
    body: Body


class Version(BaseModel):
    """The version of a Confluence object."""

    number: int


class Attachment(BaseModel):
    """A page attachment from the v2 API."""

    id: str
    title: str
    media_type: str = Field(alias="mediaType")
    version: Version


class Links(BaseModel):
    """Pagination links from the v2 API."""

    next: str | None = None


class Attachments(BaseModel):
    """One page of attachments from the v2 API."""

    results: list[Attachment]
    links: Links = Field(default_factory=Links, alias="_links")


class User(BaseModel):
    """A Confluence user."""

    account_id: str = Field(alias="accountId")
    display_name: str = Field(alias="displayName")


class Users(BaseModel):
    """The response of the bulk user API."""

    results: list[User]


def api(path: str) -> bytes:
    """Send a GET request through the `api` script and return the body."""
    result = subprocess.run([API, path, "-L"], capture_output=True)
    if result.returncode != 0:
        sys.stderr.buffer.write(result.stderr + result.stdout)
        raise SystemExit(f"error: request failed: {path}")
    return result.stdout


def page_id(arg: str) -> str:
    """Get the page ID from a page ID or a page URL."""
    if arg.isdigit():
        return arg
    match = re.search(r"/pages/(\d+)", arg) or re.search(r"[?&]pageId=(\d+)", arg)
    if not match:
        raise SystemExit(f"error: no page ID in {arg!r}")
    return match.group(1)


def attachments(pid: str) -> list[Attachment]:
    """Get all attachments of a page."""
    found: list[Attachment] = []
    path: str | None = f"/wiki/api/v2/pages/{pid}/attachments?limit=250"
    while path:
        batch = Attachments.model_validate_json(api(path))
        found.extend(batch.results)
        path = batch.links.next
    return found


def user_names(account_ids: set[str]) -> dict[str, str]:
    """Get the display name for each account ID."""
    if not account_ids:
        return {}
    query = urllib.parse.urlencode([("accountId", a) for a in sorted(account_ids)])
    users = Users.model_validate_json(api(f"/wiki/rest/api/user/bulk?{query}"))
    return {u.account_id: u.display_name for u in users.results}


def find_diagram(found: list[Attachment], filename: str) -> Attachment | None:
    """Find the attachment that holds the source of a diagram.

    Try an exact title, then a title with different case and spaces, then the
    only title that starts with `filename`.
    """
    sources = [a for a in found if not a.media_type.startswith("image/")]
    key = " ".join(filename.split()).casefold()

    def norm(a: Attachment) -> str:
        return " ".join(a.title.split()).casefold()

    for candidates in (
        [a for a in sources if a.title == filename],
        [a for a in sources if norm(a) == key],
        [a for a in sources if norm(a).startswith(key)],
    ):
        if len(candidates) == 1:
            return candidates[0]
    return None


def child(tag: Tag, name: str) -> Tag | None:
    """Get the first direct child of `tag` with the tag name `name`."""
    found = tag.find(name, recursive=False)
    return found if isinstance(found, Tag) else None


def params(macro: Tag) -> dict[str, str]:
    """Get the parameters of a macro."""
    return {
        str(p.get("ac:name", "")): p.get_text()
        for p in macro.find_all("ac:parameter", recursive=False)
    }


class Renderer:
    """Change Confluence storage format to HTML that markdownify can convert."""

    def __init__(self, soup: BeautifulSoup, pid: str) -> None:
        self.soup = soup
        self.pid = pid
        self._attachments: list[Attachment] | None = None

    def text(self, value: str) -> NavigableString:
        return NavigableString(value)

    def tag(self, name: str, content: str | None = None, **attrs: str) -> Tag:
        new = self.soup.new_tag(name, attrs=attrs)
        if content is not None:
            new.string = content
        return new

    def block(self, name: str, source: Tag | None) -> Tag:
        """Make a new tag, and move the children of `source` into it."""
        new = self.soup.new_tag(name)
        if source is not None:
            new.extend(list(source.contents))
        return new

    def titled(self, name: str, title: str, source: Tag | None) -> Tag:
        """Make a block with a bold title paragraph, then the children of `source`."""
        heading = self.tag("p")
        heading.append(self.tag("strong", title))
        new = self.block(name, source)
        new.insert(0, heading)
        return new

    def code(self, language: str, source: str) -> Tag:
        pre = self.tag("pre", **{"data-lang": language})
        pre.append(self.tag("code", source))
        return pre

    def mermaid_source(self, filename: str, revision: str) -> str | None:
        if self._attachments is None:
            self._attachments = attachments(self.pid)
        match = find_diagram(self._attachments, filename)
        if match is None:
            return None
        latest = match.version.number
        version = int(revision) if revision.isdigit() and int(revision) < latest else latest
        path = f"/wiki/rest/api/content/{self.pid}/child/attachment/{match.id}/download"
        return api(f"{path}?version={version}").decode()

    def macro(self, macro: Tag) -> Tag | NavigableString | None:
        name = str(macro.get("ac:name", ""))
        p = params(macro)
        rich = child(macro, "ac:rich-text-body")
        plain = child(macro, "ac:plain-text-body")
        if name == "mermaid-cloud":
            source = self.mermaid_source(p.get("filename", ""), p.get("revision", ""))
            if source is None:
                return self.tag(
                    "p", f"[Mermaid diagram {p.get('filename', '')!r}: no source found]"
                )
            return self.code("mermaid", source)
        if plain is not None:
            language = "mermaid" if "mermaid" in name else p.get("language", "")
            return self.code(language, plain.get_text())
        if name in PANELS:
            label = name.capitalize() + (f": {p['title']}" if p.get("title") else "")
            return self.titled("blockquote", label, rich)
        if name == "expand":
            return self.titled("div", p.get("title", "Details"), rich)
        if name == "status":
            return self.text(f"[{p.get('title', '')}]")
        if name == "jira":
            return self.text(p.get("key", "[JIRA issues]"))
        if name in DROPPED_MACROS:
            return None
        if rich is not None:
            return self.block("div", rich)
        return self.text(f"[{name} macro]")

    def link(self, link: Tag, users: dict[str, str]) -> Tag | NavigableString:
        body = child(link, "ac:link-body") or child(link, "ac:plain-text-link-body")
        label = body.get_text().strip() if body else ""
        if (page := link.find("ri:page")) and isinstance(page, Tag):
            title = str(page.get("ri:content-title", ""))
            return self.text(f"{label} [[{title}]]" if label and label != title else f"[[{title}]]")
        if (user := link.find("ri:user")) and isinstance(user, Tag):
            return self.text(f"@{users.get(str(user.get('ri:account-id', '')), 'unknown user')}")
        if (att := link.find("ri:attachment")) and isinstance(att, Tag):
            return self.text(f"[[attachment: {att.get('ri:filename', '')}]]")
        if (url := link.find("ri:url")) and isinstance(url, Tag):
            return self.tag(
                "a", label or str(url.get("ri:value", "")), href=str(url.get("ri:value", ""))
            )
        return self.text(label)

    def image(self, image: Tag) -> Tag:
        source = image.find(["ri:attachment", "ri:url"])
        src = ""
        if isinstance(source, Tag):
            src = str(source.get("ri:filename") or source.get("ri:value") or "")
        return self.tag("img", src=src, alt=str(image.get("ac:alt") or src))

    def task(self, task: Tag) -> Tag:
        status = child(task, "ac:task-status")
        done = status is not None and status.get_text().strip() == "complete"
        item = self.block("li", child(task, "ac:task-body"))
        item.insert(0, self.text("[x] " if done else "[ ] "))
        return item

    def run(self) -> None:
        for macro in reversed(self.soup.find_all("ac:structured-macro")):
            replace(macro, self.macro(macro))
        for ext in self.soup.find_all("ac:adf-extension"):
            fallback = ext.find("ac:adf-fallback")
            replace(ext, self.block("div", fallback) if isinstance(fallback, Tag) else None)
        ids = {str(u.get("ri:account-id", "")) for u in self.soup.find_all("ri:user")}
        users = user_names(ids - {""})
        for link in self.soup.find_all("ac:link"):
            replace(link, self.link(link, users))
        for user in self.soup.find_all("ri:user"):
            replace(
                user, self.text(f"@{users.get(str(user.get('ri:account-id', '')), 'unknown user')}")
            )
        for image in self.soup.find_all("ac:image"):
            replace(image, self.image(image))
        for emoticon in self.soup.find_all("ac:emoticon"):
            replace(emoticon, self.text(str(emoticon.get("ac:emoji-fallback") or "")))
        for time in self.soup.find_all("time"):
            replace(time, self.text(str(time.get("datetime") or time.get_text())))
        for task_list in self.soup.find_all("ac:task-list"):
            task_list.name = "ul"
        for task in self.soup.find_all("ac:task"):
            replace(task, self.task(task))
        for tag in self.soup.find_all(["ac:parameter", "ac:placeholder"]):
            tag.decompose()
        for tag in self.soup.find_all(re.compile(r"^(ac|ri):")):
            tag.unwrap()
        for cell in self.soup.find_all(["td", "th"]):
            for br in cell.find_all("br"):
                br.replace_with(LINE_BREAK)
            for block in cell.find_all(["p", "h1", "h2", "h3", "h4", "h5", "h6"]):
                block.append(LINE_BREAK)


def replace(tag: Tag, new: Tag | NavigableString | None) -> None:
    """Replace `tag` with `new`, or remove `tag` if `new` is None."""
    if new is None:
        tag.decompose()
    else:
        tag.replace_with(new)


class Converter(MarkdownConverter):
    """A markdownify converter that keeps multi-line table cells in one row."""

    def convert_td(self, el: Tag, text: str, parent_tags: set[str]) -> str:
        colspan = el.get("colspan")
        span = int(colspan) if isinstance(colspan, str) and colspan.isdigit() else 1
        lines = [line.strip() for line in text.replace(LINE_BREAK, "\n").split("\n")]
        cell = "<br>".join(line for line in lines if line).replace("|", "\\|")
        return f" {cell} |" + " |" * (span - 1)

    convert_th = convert_td


def markdown(page: Page) -> str:
    """Change a page to Markdown."""
    soup = BeautifulSoup(page.body.storage.value, "html.parser")
    for cdata in soup.find_all(string=lambda s: isinstance(s, CData)):
        cdata.replace_with(NavigableString(str(cdata)))
    Renderer(soup, page.id).run()
    body = Converter(
        heading_style=ATX,
        bullets="-",
        table_infer_header=True,
        escape_underscores=False,
        escape_asterisks=False,
        code_language_callback=lambda el: el.get("data-lang") or "",
    ).convert_soup(soup)
    return f"# {page.title}\n\n{re.sub(r'\n{3,}', '\n\n', body).strip()}\n"


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] in {"-h", "--help"}:
        print((__doc__ or "").strip(), file=sys.stderr)
        return 1
    pid = page_id(sys.argv[1])
    page = Page.model_validate_json(api(f"/wiki/api/v2/pages/{pid}?body-format=storage"))
    sys.stdout.write(markdown(page))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
