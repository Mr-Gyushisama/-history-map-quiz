# BALLNOTE Sync Protocol v0.1

## 1. Purpose

BALLNOTE records the complete game locally first. Cloud synchronization must never block LIVE scoring.

Current client state:
- Game is fully recordable offline.
- Each game has a device-generated `gameId`.
- Local state is persisted in IndexedDB with localStorage as a compatibility mirror.
- On game end, the client builds a sync envelope and stores it in IndexedDB `syncQueue`.
- No server endpoint is connected yet.
- The client must not display `uploaded` until a server reconciliation response passes all checks.

## 2. Canonical client envelope

The current client produces:

```json
{
  "schemaVersion": 1,
  "idempotencyKey": "<gameId>:r<revision>:s<eventSequence>",
  "gameId": "<gameId>",
  "revision": 123,
  "eventSequence": 456,
  "reason": "game_end",
  "queuedAt": "ISO-8601",
  "game": { "...complete local game snapshot..." }
}
```

The rendered scorebook is not canonical. Canonical information remains structured inside Game / Pitch / Play / RunnerAction / FieldingAction / SubstitutionEvent / revision history.

## 3. Idempotency

Recommended request:

`POST /games/{gameId}/revisions`

Header:

`Idempotency-Key: <idempotencyKey>`

The server must persist the idempotency key and return the same logical result for a replay of the same request.

The same `gameId + revision + eventSequence` must not create duplicate:
- pitches
- plays
- runner events
- substitutions
- runs
- player statistics

## 4. Reconciliation response

Accepted response:

```json
{
  "status": "accepted",
  "gameId": "<gameId>",
  "idempotencyKey": "<same key>",
  "acceptedRevision": 123,
  "acceptedSequence": 456,
  "serverRevision": 123
}
```

Replay of an already-applied envelope:

```json
{
  "status": "already_applied",
  "gameId": "<gameId>",
  "idempotencyKey": "<same key>",
  "acceptedRevision": 123,
  "acceptedSequence": 456,
  "serverRevision": 123
}
```

The current client marks the game `uploaded` only when all of the following are true:
1. `gameId` matches the active local game.
2. `idempotencyKey` matches the last locally queued key.
3. `acceptedRevision >= lastQueuedRevision`.
4. `acceptedSequence >= lastQueuedSequence`.
5. status is `accepted` or `already_applied`.

Anything else must remain local / pending / conflict.

## 5. Conflict response

Recommended conflict response:

```json
{
  "status": "conflict",
  "gameId": "<gameId>",
  "idempotencyKey": "<request key>",
  "serverRevision": 124,
  "serverSequence": 460,
  "reason": "server_ahead"
}
```

Initial BALLNOTE rule:
- one official scoring device per game
- no offline simultaneous editing
- therefore server-ahead conflicts are exceptional and must not be auto-merged silently

A conflict must require reconciliation rather than overwriting newer server state.

## 6. Server validation

Before accepting a revision, validate at minimum:
- valid gameId
- supported schemaVersion
- non-negative revision and eventSequence
- monotonically valid sequence
- no duplicate event IDs within the envelope
- referenced player / scorecard / runner IDs are internally resolvable
- outs are 0-3 within a half inning
- bases do not contain duplicate active runners
- team score is consistent with scoring RunnerAction events
- final uploaded state can be rebuilt from structured events without relying on rendered BOX text

Do not reject the entire game merely because scorer-judgment fields differ from an automatic candidate. Scorer overrides are first-class data.

## 7. Upload timing

MVP:
- never wait for network during LIVE
- local save occurs first
- game-end queues the envelope locally
- upload may occur only after the game data is safely persisted
- failed upload stays queued
- retry uses the same idempotency key for the same revision
- a later local revision gets a new idempotency key

## 8. Local retention

After accepted reconciliation:
- do not immediately delete the local game
- retain the game snapshot and event history for a defined backup period
- removing old local backups is a separate retention policy, not part of reconciliation

## 9. Security before production connection

A real cloud endpoint must not be connected until these are decided:
- authentication method
- authorization scope by team / organization
- HTTPS only
- server-side access logs
- personal-information handling for player names and game data
- retention / deletion policy
- backup and restore policy

## 10. Current implementation boundary

Implemented now:
- local sync status
- IndexedDB `syncQueue`
- deterministic idempotency key
- sync envelope generation
- local game-end queueing
- reconciliation guard
- uploaded state only after a valid reconciliation response
- conflict state helper

Not implemented yet:
- production API endpoint
- authentication
- network upload transport
- server database
- server-side event validation / aggregation
- retry scheduler

This boundary is intentional. The static GitHub Pages client must not pretend a cloud upload succeeded without a real authoritative server response.
