# Chat turns

`POST /api/conversations/:id/respond` accepts exactly `{}`. The backend
claims the conversation before asynchronous work, validates persisted history,
and creates a UUID turn tied to the conversation, backend agent and last user
message. Chat uses only processing → completed or processing → failed.
A timed-out active turn becomes expired; a late model response cannot persist.

Successful responses and `GET /api/conversations/:id/turns/:turnId` return
`{ turnId, state, message: { role: 'assistant', content } }`. Processing and
expired queries return only `{ turnId, state }`; failed turns additionally
return a fixed safe `{ error: { code, message } }`. GET checks conversation
existence, UUID syntax and ownership. Internal metadata is never serialized.

The RAM store keeps UUID, conversation/agent/user IDs, state, timestamps,
null actionId, a persisted assistant message ID on success, and a fixed error
on failure. It retains no prompt, instructions, file data, raw model response,
or assistant text. GET reads the referenced assistant from existing persistence.
Defaults: 10-minute active TTL, 10-minute terminal retention, 1000 entries and
2,048,000 approximate reserved bytes (2 KiB per bounded metadata entry).
A 30-second cleanup and lazy cleanup expire active entries and remove old
terminals. Future active transitions never extend the initial deadline.

Internal transition table:

- processing → completed, failed, awaiting_permission, expired
- awaiting_permission → continuing, denied, expired
- continuing → completed, failed, expired
- terminal states have no outgoing transitions

Only the store exposes internal attachAction/getForContinuation operations;
Chat never calls them. They require matching IDs and awaiting_permission;
action attachment is single-use and no public mutation routes exist.

One active turn per conversation; different conversations run independently.
The same user message cannot create another turn while its record is retained,
including after failure. A failed attempt requires a new user message for retry.
After completion, persisted assistant-final history also prevents regeneration
when the RAM record expires or the process restarts. No SQL schema changes.

Restart creates an empty store: all turn IDs, nonterminal states and continuation
authority are invalidated. Nothing reconstructs permissions or old states.
A persisted user-only history may start a fresh turn after restart; pending model
work belonged to the terminated process. Terminal lookup/idempotency records are
bounded RAM retention, not a durable operation log. Assistant messages remain in
the existing database. No agent file-reading capability or Actions integration.
