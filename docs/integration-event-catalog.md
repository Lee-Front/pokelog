# Integration Event Catalog

Updated: 2026-03-29

## Purpose

`connect` integrations should not hardcode one fixed reward rule per provider. The server now exposes a provider event catalog and default admin reward rules so operators can decide which events count and how much they are worth.

## Config Shape

`config.rewards.integrations`

```json
{
  "git": {
    "commit": { "enabled": true, "points": 0, "exp": 0 }
  },
  "notion": {
    "page_created": { "enabled": true, "points": 30, "exp": 0 },
    "page_content_edited": { "enabled": true, "points": 10, "exp": 0, "cooldownMinutes": 15 },
    "status_done": { "enabled": true, "points": 40, "exp": 0 }
  },
  "jira": {
    "issue_created": { "enabled": true, "points": 20, "exp": 0 },
    "issue_done": { "enabled": true, "points": 50, "exp": 0 }
  },
  "slack": {
    "message_posted": { "enabled": false, "points": 0, "exp": 0, "cooldownMinutes": 5, "dailyMax": 20 }
  }
}
```

Each rule can control:

- `enabled`
- `points`
- `exp`
- `cooldownMinutes`
- `dailyMax`

## Catalog Endpoint

Admin API:

- `GET /api/admin/config/integration-events`

Response:

- `catalog`: provider -> event definitions
- `rules`: current admin reward rules for those events

## Event Candidates

These candidates were chosen from provider capabilities that are realistically checkable through the official APIs we already rely on for connection tests and future polling.

### Git

- `commit`

### Notion

- `page_created`
- `page_content_edited`
- `page_archived`
- `database_item_created`
- `database_item_edited`
- `status_changed`
- `status_done`
- `comment_created`

### Jira

- `issue_created`
- `issue_updated`
- `issue_transitioned`
- `issue_done`
- `comment_created`
- `worklog_created`
- `assignee_changed`

### Slack

- `message_posted`
- `app_mention`
- `reaction_added`
- `file_shared`
- `thread_reply`

## Notes

- This is a catalog and default rule layer only. Actual polling and reward attribution for Notion/Jira/Slack still need provider-specific collectors.
- Existing Git byte-based rewards remain unchanged. `rewards.integrations.git.commit` is reserved for the event-catalog path if Git is later unified with the same rule engine.
