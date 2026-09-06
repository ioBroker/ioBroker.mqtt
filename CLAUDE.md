# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An ioBroker adapter that bridges ioBroker states and MQTT. It runs in one of two mutually
exclusive modes (set by `config.type`):
- **`client`** — connects to an external MQTT broker (uses the `mqtt` library → `MQTTClient`).
- **`server`** — acts as an MQTT broker itself (own `MqttConnection` on `mqtt-packet`, over
  net/tls/http/ws → `MQTTServer`). Since v8.0.0 this replaces the unmaintained `mqtt-connection`
  package; it is API-compatible with the parts the adapter used, but carries the per-connection
  `protocolVersion`, so MQTT 5 and MQTT 3.1.1 clients can be served by one instance.

The adapter is `compact: true` (can run in-process in js-controller) and `blockly: true`.

## Build / test / lint

The source is **TypeScript in `src/`, compiled to `build/`**. The published package
(`main: build/main.js`) and the tests both consume `build/`, **never `src/`**.

- `npm run build` — `build:ts` (`tsc -p tsconfig.build.json`, emits CommonJS into `build/`)
  plus `build:blockly` (`src-blockly/` → `admin/blockly.js`). `npm run build:ts` alone is
  enough for adapter code. **You must rebuild after editing `src/` before running tests**,
  or tests run stale code.
- `npm test` — runs the four suites `test:package`, `test:unit`, `test:legacy` and
  `test:integration` in order. Each first compiles the tests (`cd test && tsc -p tsconfig.build.json`)
  and then runs Mocha (`--exit`). Slow (~2 min): it installs a temporary js-controller,
  packs/installs the adapter, and simulates full broker/client scenarios (QoS 0/1/2,
  WebSocket, auth, wildcards, retain, sessions). Do not cancel early.
- Run a single test file: build `src/` and the tests first, then
  `npx mocha test/testConvert.js --exit`.
- Verbose MQTT logs: `DEBUG=mqttjs* npm test`.
- `npm run lint` — ESLint (`@iobroker/eslint-config`). Some pre-existing warnings exist
  (e.g. the large character-class regex in `MQTTClient.ts`); they are expected.
- Type-check only (no emit): `tsc -p tsconfig.json` (`strict`, `checkJs` on).
- `npm run translate` — regenerate admin i18n via `translate-adapter`.

Tests are TypeScript in `test/`, compiled in place to `test/*.js` (that is what Mocha runs),
and they `require('../build/...')`. Files directly under `test/` are the suites; `test/lib/`
holds mocks/utilities (MQTT client/server harnesses, sim adapter).

## Architecture

**Entry point `src/main.ts`** (`class MQTT extends Adapter`):
- Lifecycle `onReady → main()`. In `main()` it subscribes to foreign states matching the
  `publish` pattern(s) (plus the adapter's own `namespace.*` in client mode), pre-loads them
  into `this.states` — a `Record<stateId, ioBroker.State>` cache that is **passed by reference**
  to `MQTTClient`/`MQTTServer`.
- `onStateChange` forwards changes to the active client/server (respecting `sendAckToo` and
  `onchange` de-duplication).
- `onMessage` handles `sendTo` commands: `sendMessage2Client` (publish raw topic/message),
  `sendState2Client` (publish a state), and `test` (try-connect for the admin UI).
- Many config fields arrive as strings from the admin UI and are coerced here
  (`parseInt`, `=== 'true'`); `MqttAdapterConfig` in `src/lib/types.d.ts` is the typed shape.

**The core problem is bidirectional ID↔topic mapping**: ioBroker state IDs are
dot-separated and namespaced (`mqtt.0.foo.bar`); MQTT topics are slash-separated
(`foo/bar`). The pure, well-tested logic lives in **`src/lib/common.ts`**:
- `convertID2topic` / `convertTopic2id` — name translation, prefix/namespace handling.
- `pattern2RegEx` — converts MQTT wildcards (`#`, `+`) and ioBroker patterns (`*`) to a RegExp.
- `convertMessage` — parses an incoming payload into a number/boolean/ioBroker state object.
  How far it goes is set by `payloadParsing`: `full` (default), `noStateObjects` (JSON stays a
  string) or `none` (no conversion at all).
- `state2string` — serializes a state for publishing (raw value or full JSON per `sendStateObject`).
- `ensureObjectStructure` — lazily auto-creates parent `folder` objects for new state IDs.
- `isIgnoredTopic` — applies the `ignoredTopics` filters.

**`src/lib/MQTTClient.ts`** and **`src/lib/MQTTServer.ts`** are the two mode implementations;
both consume the same `common.ts` helpers and the shared `states` cache. The server tracks
persistent sessions, QoS retransmission, and creates `info.clients.<clientId>` objects per
connected client (disable with `doNotCreateClientObjects`).

**`src/lib/MqttConnection.ts`** — the wire layer under `MQTTServer` (server mode only; client
mode uses the `mqtt` library). One instance per connection, on a TCP/TLS socket or a WebSocket
duplex, encoding and decoding with `mqtt-packet`. Incoming packets are emitted as events named
after their `cmd` (`connect`, `publish`, …) and every outgoing packet has a method of the same
name, which is the API `mqtt-connection` had. It holds the `protocolVersion` from the CONNECT
packet, so each connection is answered on its own protocol level and MQTT 5 and MQTT 3.1.1
clients can share one instance; the MQTT 5 spelling of the acknowledgements is applied here
alone, so callers keep passing the MQTT 3.1.1 shape.

**`src/lib/scram.ts`** — server side of SCRAM-SHA-256 (RFC 7677) for the MQTT 5 enhanced
authentication. Used by `MQTTServer` (`ScramExchange` per client) so the password is never
sent over the connection.

**`src/lib/securityChecker.ts`** — in server mode with no username/password, it probes
whether the broker is reachable from the public internet (via `ip.iobroker.in`) and, if so,
raises a js-controller security notification.

## Admin & metadata

- Admin UI is JSON-config (`admin/jsonConfig.json`), declared in `io-package.json`
  (`adminUI.config: "json"`). Translations live in `admin/i18n/`. Blockly block: `admin/blockly.js`.
- `io-package.json` holds adapter metadata, default `native` config, and upgrade `messages`
  (migration dialogs keyed by version ranges).

## Notes

- Requires Node `>=18`.
- `.github/copilot-instructions.md` predates the TypeScript migration: it claims "no build
  step" and references root `main.js` / `lib/*.js`. That is **outdated** — trust this file
  for the build/structure instead.
