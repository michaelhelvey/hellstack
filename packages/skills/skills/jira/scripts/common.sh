# Shared helpers for the jira skill scripts. Source this file. Do not run it.

JIRA_CONFIG_FILE="${JIRA_CONFIG_FILE:-$HOME/.config/.jira/.config.yml}"
export JIRA_CONFIG_FILE

die() {
  echo "error: $*" >&2
  exit 1
}

# Print a top-level value from the jira-cli config, or nothing.
config_value() {
  [ -f "$JIRA_CONFIG_FILE" ] || return 0
  sed -n "s/^$1: *//p" "$JIRA_CONFIG_FILE" | head -n 1 | tr -d "\"'"
}

jira_token() { printf '%s' "${JIRA_API_TOKEN:-${JIRA_API_KEY:-}}"; }

jira_email() { printf '%s' "${JIRA_USER_EMAIL:-${JIRA_EMAIL:-$(config_value login)}}"; }

jira_site() {
  local site="${JIRA_BASE_URL:-$(config_value server)}"
  printf '%s' "${site%/}"
}

require_auth() {
  local setup
  setup="$(dirname "${BASH_SOURCE[0]}")/setup"
  [ -n "$(jira_token)" ] || die "set JIRA_API_TOKEN (or JIRA_API_KEY) to an Atlassian API token"
  [ -n "$(jira_email)" ] || die "no Atlassian email: run $setup, or set JIRA_USER_EMAIL"
  [ -n "$(jira_site)" ] || die "no Atlassian site: run $setup, or set JIRA_BASE_URL"
}
