# ioBroker MQTT Adapter

MQTT adapter for ioBroker allowing send/receive MQTT messages and acting as a broker. This is a Node.js-based ioBroker adapter written in JavaScript.

Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

## Working Effectively

- Bootstrap and test the repository:
  - `npm install` -- takes 3-25 seconds depending on cache. NEVER CANCEL. Set timeout to 60+ seconds.
  - `npm test` -- takes 2 minutes (1m 40s). NEVER CANCEL. Set timeout to 180+ seconds.
  - `npm run lint` -- takes 5 seconds but will show several existing issues that can be ignored.
- No build step required - this is pure JavaScript.
- ALWAYS test functionality after making changes by running `npm test`.

## Validation

- ALWAYS run the complete test suite after making changes: `npm test` - DO NOT CANCEL, it takes 2 minutes.
- Tests simulate complete MQTT broker/client scenarios including:
  - MQTT server mode (adapter acts as broker)
  - MQTT client mode (adapter connects to external broker)
  - QoS 0, 1, and 2 message delivery
  - WebSocket connections
  - Topic subscriptions and publishing
  - Authentication scenarios
- The test suite creates temporary ioBroker controller instances and simulates real MQTT communication.
- NEVER CANCEL tests early - they require the full 2 minutes to complete all 37 test cases.

## Common Tasks

The following are outputs from frequently run commands. Reference them instead of running bash commands to save time.

### Repo root
```
ls -la
.github/         (GitHub workflows and templates)
.vscode/         (VSCode settings) 
admin/           (Admin UI components and translations)
docs/            (Documentation with images)
lib/             (Core adapter logic)
test/            (Test files and test utilities)
main.js          (Main adapter entry point)
package.json     (Dependencies and scripts)
io-package.json  (ioBroker adapter configuration)
tsconfig.json    (TypeScript checking configuration)
eslint.config.mjs (ESLint configuration)
```

### package.json scripts
```
"test": "node node_modules/mocha/bin/mocha --exit"
"lint": "eslint -c eslint.config.mjs"
"translate": "translate-adapter"
"update-packages": "npx -y npm-check-updates --upgrade"
```

### Core files structure
```
lib/
├── client.js      (MQTT client implementation)
├── server.js      (MQTT broker implementation) 
├── common.js      (Shared utilities)
└── securityChecker.js (Security validation)

test/
├── testClient.js     (Client mode tests)
├── testServer.js     (Server mode tests)
├── testConvert.js    (Data conversion tests)
├── testSimClient.js  (Simulated client tests)
├── testSimServer.js  (Simulated server tests)
└── lib/             (Test utilities and mocks)
```

## Development Workflow

- This adapter can operate in two modes:
  1. **Client mode**: Connects to external MQTT broker
  2. **Server mode**: Acts as MQTT broker for other clients
- The adapter handles ioBroker state changes and converts them to/from MQTT messages
- Admin interface allows configuration of connection settings, topics, and authentication
- Always test both client and server scenarios when making changes
- The adapter supports WebSocket connections (runs on port+1, default 1884)

## Testing Details

- Tests automatically install a temporary js-controller and set up test environment
- DO NOT CANCEL the test process - it needs full time to:
  - Install js-controller (~20 seconds)
  - Pack and install adapter (~30 seconds) 
  - Run 37 test cases covering all functionality (~70 seconds)
- Test output includes extensive MQTT debug information when run with DEBUG=mqttjs*
- Tests clean up automatically but may leave temporary files in tmp/ directory

## Known Issues

- ESLint shows character class warnings in lib/client.js - these are pre-existing and safe to ignore
- ESLint configuration has some parsing issues with admin files - does not affect functionality
- Some tests may show EPIPE errors during teardown - this is normal and tests still pass
- Tests require specific timing - DO NOT interrupt or cancel early

## Validation Scenarios

After making changes, ALWAYS validate by:
1. Run `npm test` and verify all 37 tests pass
2. Check that both client and server test scenarios complete successfully
3. Verify MQTT message publishing/subscribing works in test output
4. Confirm WebSocket functionality is tested
5. Validate QoS level handling (0, 1, 2) works correctly

### Test Coverage Includes:
- MQTT broker startup on ports 1883 (TCP) and 1884 (WebSocket)
- Client authentication with username/password
- Topic subscription with wildcards (#, +)
- Message publishing with different QoS levels
- Binary message handling
- Retain flag behavior
- Clean/persistent session handling
- Client connect/disconnect scenarios
- Error handling and reconnection logic

## Common Commands Reference

```bash
# Install dependencies
npm install

# Run all tests (DO NOT CANCEL - takes 2 minutes)  
npm test

# Run tests with debug output (takes longer)
DEBUG=mqttjs* npm test

# Lint code (will show existing issues)
npm run lint

# Clean up test artifacts
rm -rf tmp/ iobroker.mqtt-*.tgz
```

## Critical Reminders

- **NEVER CANCEL** npm test - it requires 2 minutes to complete properly
- Set timeouts to 180+ seconds for test commands
- Set timeouts to 60+ seconds for npm install  
- Tests create temporary ioBroker installations - this is normal
- The adapter requires ioBroker js-controller to run outside of tests
- Always validate MQTT functionality after code changes by running the full test suite