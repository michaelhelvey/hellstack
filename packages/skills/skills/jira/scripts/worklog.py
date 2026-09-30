#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Print a table of JIRA issues you logged time to on a given day.

Usage:
    worklog.py                  # today
    worklog.py --date 2026-07-23
    worklog.py --yesterday
    worklog.py --json

Environment:
    JIRA_API_TOKEN   Atlassian API token (or JIRA_API_KEY)
    JIRA_USER_EMAIL  Atlassian account email (default: `login` in the jira-cli config)
    JIRA_BASE_URL    Atlassian site (default: `server` in the jira-cli config)
    JIRA_CONFIG_FILE jira-cli config (default: ~/.config/.jira/.config.yml)
"""

from __future__ import annotations

import argparse
import base64
import concurrent.futures
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import zoneinfo

DEFAULT_CONFIG_FILE = "~/.config/.jira/.config.yml"
# Per team convention, "Accounted" tasks are frozen for internal audit and
# "Removed" tasks are dead. Neither is surfaced. They are counted in a footnote
# so the total still reconciles.
HIDDEN_STATUSES = {"accounted", "removed"}
TIMEOUT = 30


def die(msg: str, code: int = 1) -> None:
    print(f"error: {msg}", file=sys.stderr)
    raise SystemExit(code)


def config_value(key: str) -> str | None:
    """A top-level value from the jira-cli config, or None."""
    path = os.path.expanduser(os.environ.get("JIRA_CONFIG_FILE", DEFAULT_CONFIG_FILE))
    try:
        with open(path) as f:
            text = f.read()
    except OSError:
        return None
    match = re.search(rf"^{key}: *(.+)$", text, re.MULTILINE)
    return match.group(1).strip().strip("\"'") if match else None


class Jira:
    def __init__(self, base_url: str, email: str, token: str) -> None:
        self.base_url = base_url.rstrip("/")
        creds = base64.b64encode(f"{email}:{token}".encode()).decode()
        self.headers = {
            "Authorization": f"Basic {creds}",
            "Accept": "application/json",
        }

    def get(self, path: str, params: dict[str, str] | None = None) -> dict:
        url = f"{self.base_url}/rest/api/3/{path.lstrip('/')}"
        if params:
            url += "?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, headers=self.headers)
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")[:400]
            die(f"HTTP {e.code} on {path}\n{body}")
        except urllib.error.URLError as e:
            die(f"could not reach {self.base_url}: {e.reason}")
        raise AssertionError("unreachable")


def worklog_date(started: str, tz: dt.tzinfo) -> dt.date | None:
    """The calendar date a worklog falls on, in the account's timezone.

    JIRA stamps `started` with the UTC offset of wherever the author was when
    they logged it, while JQL's worklogDate is evaluated in the account
    timezone. Comparing the raw string would put a worklog on the wrong side of
    midnight whenever those two disagree, so normalize before taking the date.
    """
    try:
        parsed = dt.datetime.fromisoformat(started)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.date()
    return parsed.astimezone(tz).date()


def fmt_duration(seconds: int) -> str:
    if seconds <= 0:
        return "0m"
    hours, rem = divmod(seconds, 3600)
    minutes = round(rem / 60)
    if minutes == 60:
        hours, minutes = hours + 1, 0
    parts = []
    if hours:
        parts.append(f"{hours}h")
    if minutes:
        parts.append(f"{minutes}m")
    return " ".join(parts)


def truncate(text: str, width: int) -> str:
    text = " ".join(text.split())
    return text if len(text) <= width else text[: width - 1] + "…"


def render_table(rows: list[dict], summary_width: int) -> str:
    headers = ["Key", "Summary", "Type", "Status", "Parent", "Time"]
    body = [
        [
            r["key"],
            truncate(r["summary"], summary_width),
            r["type"],
            r["status"],
            r["parent"] or "—",
            fmt_duration(r["seconds"]),
        ]
        for r in rows
    ]
    widths = [
        max(len(headers[i]), *(len(row[i]) for row in body)) for i in range(len(headers))
    ]

    def line(cells: list[str]) -> str:
        return "  ".join(c.ljust(w) for c, w in zip(cells, widths)).rstrip()

    out = [line(headers), "  ".join("-" * w for w in widths)]
    out.extend(line(row) for row in body)
    return "\n".join(out)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Show JIRA issues you logged time to on a given day."
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--date", metavar="YYYY-MM-DD", help="day to report on")
    group.add_argument(
        "--yesterday", action="store_true", help="shorthand for yesterday's date"
    )
    parser.add_argument("--json", action="store_true", help="emit JSON instead")
    args = parser.parse_args()

    token = os.environ.get("JIRA_API_TOKEN") or os.environ.get("JIRA_API_KEY")
    email = os.environ.get("JIRA_USER_EMAIL") or config_value("login")
    base_url = os.environ.get("JIRA_BASE_URL") or config_value("server")
    if not token:
        die("set JIRA_API_TOKEN (or JIRA_API_KEY)")
    if not email or not base_url:
        die("no Atlassian site or email: run the jira skill's scripts/setup")

    if args.date:
        try:
            day = dt.date.fromisoformat(args.date)
        except ValueError:
            die(f"invalid --date {args.date!r}; expected YYYY-MM-DD")
    elif args.yesterday:
        day = dt.date.today() - dt.timedelta(days=1)
    else:
        day = dt.date.today()
    day_str = day.isoformat()

    jira = Jira(base_url, email, token)

    myself = jira.get("myself")
    account_id = myself.get("accountId")
    if not account_id:
        die("could not determine your accountId (check credentials)")

    # Match JQL's notion of a day, which uses the account timezone.
    try:
        account_tz: dt.tzinfo = zoneinfo.ZoneInfo(myself.get("timeZone") or "UTC")
    except zoneinfo.ZoneInfoNotFoundError:
        account_tz = dt.timezone.utc

    jql = f'worklogAuthor = currentUser() AND worklogDate = "{day_str}"'
    search = jira.get(
        "search/jql",
        {"jql": jql, "fields": "summary,status,issuetype,parent", "maxResults": "100"},
    )
    issues = search.get("issues", [])

    def seconds_for(issue: dict) -> dict:
        data = jira.get(f"issue/{issue['key']}/worklog", {"maxResults": "1000"})
        total = sum(
            w.get("timeSpentSeconds", 0)
            for w in data.get("worklogs", [])
            if w.get("author", {}).get("accountId") == account_id
            and worklog_date(str(w.get("started", "")), account_tz) == day
        )
        fields = issue.get("fields", {})
        return {
            "key": issue["key"],
            "summary": fields.get("summary", ""),
            "type": (fields.get("issuetype") or {}).get("name", ""),
            "status": (fields.get("status") or {}).get("name", ""),
            "parent": (fields.get("parent") or {}).get("key"),
            "seconds": total,
        }

    if issues:
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            rows = list(pool.map(seconds_for, issues))
    else:
        rows = []

    # JQL said these issues have a worklog from you on this day, so a zero here
    # means the two disagree (e.g. an unparseable timestamp). Surface it rather
    # than dropping the row and quietly understating the total.
    unresolved = [r for r in rows if r["seconds"] <= 0]
    rows = [r for r in rows if r["seconds"] > 0]
    hidden = [r for r in rows if r["status"].lower() in HIDDEN_STATUSES]
    visible = [r for r in rows if r["status"].lower() not in HIDDEN_STATUSES]
    visible.sort(key=lambda r: (-r["seconds"], r["key"]))
    total = sum(r["seconds"] for r in rows)

    if args.json:
        print(
            json.dumps(
                {
                    "date": day_str,
                    "issues": visible,
                    "hiddenCount": len(hidden),
                    "hiddenSeconds": sum(r["seconds"] for r in hidden),
                    "unresolved": [r["key"] for r in unresolved],
                    "totalSeconds": total,
                },
                indent=2,
            )
        )
        return 0

    label = "today" if day == dt.date.today() else day.strftime("%a")
    print(f"Time logged {label} ({day_str}):\n")
    if not visible and not hidden and not unresolved:
        print("No worklogs found.")
        return 0
    if visible:
        print(render_table(visible, summary_width=60))
        print()
    if hidden:
        print(
            f"({len(hidden)} Accounted or Removed task(s) hidden, "
            f"{fmt_duration(sum(r['seconds'] for r in hidden))})"
        )
    if unresolved:
        keys = ", ".join(r["key"] for r in unresolved)
        print(
            f"warning: JIRA reports a worklog from you on {day_str} for {keys}, "
            "but no matching entry was found — time below may be understated.",
            file=sys.stderr,
        )
    print(f"Total: {fmt_duration(total)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
