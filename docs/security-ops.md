# Security Operations Guide

## Admin Key
- Env: `POKELOG_ADMIN_KEY`
- Shared secret for all admin routes
- Rotate by: update env → restart server
- No per-operator isolation; if compromised, all admins compromised
- Recommendation: if multiple operators, consider per-operator keys (not implemented)
