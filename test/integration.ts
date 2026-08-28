import * as path from 'node:path';
import assert from 'node:assert';
import { tests } from '@iobroker/testing';
import MqttServer from './lib/mqttServer';
import MqttClient from './lib/mqttClient';

// Helper function for encryption (same as in the legacy tests)
function encrypt(key: string, value: string): string {
    let result = '';
    for (let i = 0; i < value.length; ++i) {
        result += String.fromCharCode(key[i % key.length].charCodeAt(0) ^ value.charCodeAt(i));
    }
    return result;
}

/**
 * Topic → ID mapping rules, taken 1:1 from the legacy testClient / testServer suites.
 * They cover the leading slash, the own namespace, a topic without any level, whitespace
 * (which becomes "_") and a foreign object that already exists.
 */
const RULES: Record<string, string> = {
    '/mqtt/0/test1': 'mqtt.0.test1',
    'mqtt/0/test2': 'mqtt.0.test2',
    test3: 'mqtt.0.test3',
    'te s t4': 'mqtt.0.te_s_t4',
    'testAdapter/0/testChannel/testState': 'testAdapter.0.testChannel.testState',
    '/testAdapter/0/testChannel/testState': 'testAdapter.0.testChannel.testState',
};

const USER = 'user';
const PASS = 'pass!?#1';

function wait(ms: number): Promise<void> {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
}

/**
 * Polls `fn` until it returns something truthy.
 *
 * @param what Describes the awaited value, used for the timeout error
 * @param fn Returns the value once it is there, a falsy value otherwise
 * @param timeoutMs How long to poll before giving up
 * @returns The value `fn` returned
 */
async function poll<T>(what: string, fn: () => Promise<T | undefined | null>, timeoutMs = 5000): Promise<T> {
    const until = Date.now() + timeoutMs;
    do {
        const value = await fn();
        if (value) {
            return value;
        }
        await wait(100);
    } while (Date.now() < until);

    throw new Error(`${what} did not appear within ${timeoutMs} ms`);
}

/** Collects everything a test MQTT client receives, so a test can await one specific topic. */
class Receiver {
    private received: { topic: string; message: string }[] = [];

    onMessage = (topic: string, message: Buffer): void => {
        this.received.push({ topic, message: message ? message.toString() : '' });
    };

    reset(): void {
        this.received = [];
    }

    /**
     * Waits until a message for `topic` was received.
     *
     * @param topic The awaited topic
     * @param timeoutMs How long to wait before giving up
     * @returns The payload as string
     */
    async waitFor(topic: string, timeoutMs = 5000): Promise<string> {
        const hit = await poll(
            `Message for topic "${topic}"`,
            () => Promise.resolve(this.received.find(m => m.topic === topic)),
            timeoutMs,
        );
        return hit.message;
    }
}

/**
 * Connects one of the test MQTT clients and resolves once it is connected.
 *
 * @param name The client id
 * @param port The broker port
 * @param receiver Collects the received messages
 * @returns The connected client
 */
function connectClient(name: string, port: number, receiver: Receiver): Promise<MqttClient> {
    return new Promise<MqttClient>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${name} could not connect to 127.0.0.1:${port}`)), 15000);
        const client: MqttClient = new MqttClient(
            connected => {
                if (connected) {
                    clearTimeout(timer);
                    resolve(client);
                }
            },
            receiver.onMessage,
            { name, url: `127.0.0.1:${port}`, user: USER, pass: PASS },
        );
    });
}

// Test the MQTT adapter with the modern @iobroker/testing integration harness
tests.integration(path.join(__dirname, '..'), {
    allowedExitCodes: [11],

    defineAdditionalTests({ suite }) {
        // Test suite for basic adapter startup in server mode
        suite('MQTT Adapter Server Mode Tests', getHarness => {
            it('Should start adapter in server mode', async function () {
                this.timeout(40000);

                const harness = getHarness();

                // Get system config for secret
                const systemConfig = await harness.objects.getObjectAsync('system.config');
                const secret = systemConfig?.native?.secret || 'Zgfr56gFe87jJOM';

                // Configure adapter as server
                await harness.changeAdapterConfig('mqtt', {
                    native: {
                        type: 'server',
                        port: 11883,
                        bind: '127.0.0.1',
                        user: 'testuser',
                        pass: encrypt(secret, 'testpass'),
                        publish: '',
                        debug: false,
                        onchange: true,
                    },
                    common: {
                        enabled: true,
                        loglevel: 'info',
                    },
                });

                // Start the adapter
                await harness.startAdapterAndWait();

                // Wait for adapter to fully initialize
                await new Promise<void>(resolve => setTimeout(resolve, 3000));

                // Check if adapter is running
                const connectedState = await harness.states.getStateAsync('system.adapter.mqtt.0.connected');
                assert.ok(connectedState, 'Adapter should be connected');
                assert.strictEqual(connectedState.val, true, 'Adapter should be running');

                // Check if info states exist
                const aliveState = await harness.states.getStateAsync('system.adapter.mqtt.0.alive');
                assert.ok(aliveState, 'Alive state should exist');

                // Check that connection info state was created
                const connectionInfo = await harness.states.getStateAsync('mqtt.0.info.connection');
                assert.ok(connectionInfo, 'Connection info state should exist');
            });
        });

        // Test suite for client mode with external MQTT server
        suite('MQTT Adapter Client Mode Tests', getHarness => {
            let mqttServer: MqttServer;

            before(async function () {
                this.timeout(10000);

                // Start a test MQTT server on a different port (compiled from test/lib/mqttServer.ts)
                mqttServer = new MqttServer({
                    user: 'testuser',
                    pass: 'testpass',
                    port: 11884,
                });

                // Give server time to start
                await new Promise<void>(resolve => setTimeout(resolve, 2000));
            });

            after(async function () {
                if (mqttServer) {
                    try {
                        await new Promise<void>(resolve => {
                            mqttServer.stop(() => resolve());
                        });
                    } catch (e) {
                        // Ignore errors on cleanup
                        console.log('Error stopping MQTT server:', (e as Error).message);
                    }
                }
            });

            it('Should start adapter in client mode and connect', async function () {
                this.timeout(40000);

                const harness = getHarness();

                // Get system config for secret
                const systemConfig = await harness.objects.getObjectAsync('system.config');
                const secret = systemConfig?.native?.secret || 'Zgfr56gFe87jJOM';

                // Configure adapter as client
                await harness.changeAdapterConfig('mqtt', {
                    native: {
                        type: 'client',
                        url: '127.0.0.1',
                        port: 11884,
                        user: 'testuser',
                        pass: encrypt(secret, 'testpass'),
                        publish: '',
                        debug: false,
                        onchange: true,
                        patterns: '#', // Subscribe to all topics
                    },
                    common: {
                        enabled: true,
                        loglevel: 'info',
                    },
                });

                // Start the adapter
                await harness.startAdapterAndWait();

                // Wait for adapter to connect
                await new Promise<void>(resolve => setTimeout(resolve, 5000));

                // Check if adapter is running
                const connectedState = await harness.states.getStateAsync('system.adapter.mqtt.0.connected');
                assert.ok(connectedState, 'Adapter should be connected');
                assert.strictEqual(connectedState.val, true, 'Adapter should be running');

                // Check connection info state exists
                const connectionInfo = await harness.states.getStateAsync('mqtt.0.info.connection');
                assert.ok(connectionInfo, 'Connection info should exist');
            });
        });

        // Ported from the legacy testServer suite (@iobroker/legacy-testing): the adapter acts as
        // the broker and a real js-controller stores the objects/states. This covers what the
        // simulated-adapter unit tests cannot — the object DB, the auto-created folder structure,
        // the encrypted credentials and the adapter process itself.
        suite('MQTT Adapter Server Mode: topic mapping', getHarness => {
            const PORT = 11887;
            const emitterRx = new Receiver();
            const detectorRx = new Receiver();
            let emitter: MqttClient;
            let detector: MqttClient;

            before(async function () {
                this.timeout(90000);

                const harness = getHarness();
                const systemConfig = await harness.objects.getObjectAsync('system.config');
                const secret = systemConfig?.native?.secret || 'Zgfr56gFe87jJOM';

                // A foreign state the adapter has to write into instead of creating one of its own
                await harness.objects.setObjectAsync('testAdapter.0.testChannel.testState', {
                    type: 'state',
                    common: { name: 'testState', type: 'string', read: true, write: true, role: 'variable' },
                    native: {},
                });

                await harness.changeAdapterConfig('mqtt', {
                    native: {
                        type: 'server',
                        port: PORT,
                        bind: '127.0.0.1',
                        user: USER,
                        pass: encrypt(secret, PASS),
                        publish: 'mqtt.0.*',
                        debug: false,
                        onchange: false,
                    },
                    common: {
                        enabled: true,
                        loglevel: 'info',
                    },
                });

                await harness.startAdapterAndWait();
                await wait(2000);

                emitter = await connectClient('Emitter', PORT, emitterRx);
                detector = await connectClient('Detector', PORT, detectorRx);
                await wait(500);
            });

            after(async () => {
                emitter?.stop();
                detector?.stop();
                await wait(500);
            });

            it('MQTT server: the authenticated clients show up in info.connection', async function () {
                this.timeout(15000);
                const harness = getHarness();

                await poll(
                    'info.connection with both clients',
                    async () => {
                        const state = await harness.states.getStateAsync('mqtt.0.info.connection');
                        const val = typeof state?.val === 'string' ? state.val : '';
                        return (val.includes('Emitter') && val.includes('Detector')) || undefined;
                    },
                    10000,
                );
            });

            for (const topic of Object.keys(RULES)) {
                const id = RULES[topic];

                it(`MQTT server: a message on "${topic}" is stored in "${id}"`, async function () {
                    this.timeout(15000);
                    const harness = getHarness();
                    const value = `Roger${Math.round(Math.random() * 100)}`;

                    await new Promise<void>((resolve, reject) =>
                        emitter.publish(topic, value, (err?: Error) => (err ? reject(err) : resolve())),
                    );

                    const obj = await poll<ioBroker.Object>(`Object "${id}"`, () => harness.objects.getObjectAsync(id));
                    assert.strictEqual(obj._id, id);
                    assert.strictEqual(obj.type, 'state');
                    if (topic.includes('mqtt')) {
                        assert.strictEqual(obj.native.topic, topic, 'The object must remember its topic');
                    }

                    const state = await poll(`State "${id}" with value "${value}"`, async () => {
                        const s = await harness.states.getStateAsync(id);
                        return s?.val === value ? s : undefined;
                    });
                    assert.strictEqual(state.ack, true, 'A value from a client is an acknowledged status');
                });
            }

            for (const topic of Object.keys(RULES)) {
                const id = RULES[topic];
                if (!id.includes('mqtt')) {
                    // Only the states covered by the "publish" mask are sent back to the clients
                    continue;
                }

                it(`MQTT server: a change of "${id}" is published as "${topic}"`, async function () {
                    this.timeout(15000);
                    const harness = getHarness();
                    const value = `NewRoger${Math.round(Math.random() * 100)}`;

                    emitterRx.reset();
                    await harness.states.setStateAsync(id, { val: value, ack: false });

                    assert.strictEqual(await emitterRx.waitFor(topic), value);
                });
            }

            it('MQTT server: a message of one client is forwarded to the other one', async function () {
                this.timeout(15000);
                const topic = '/mqtt/0/test1';
                const value = 'AABB';

                detectorRx.reset();
                await new Promise<void>((resolve, reject) =>
                    emitter.publish(topic, JSON.stringify({ val: value, ack: false }), (err?: Error) =>
                        err ? reject(err) : resolve(),
                    ),
                );

                assert.strictEqual(await detectorRx.waitFor(topic), value);
            });

            it('MQTT server: info.connection follows a client reconnect', async function () {
                this.timeout(60000);
                const harness = getHarness();

                emitter.stop();
                detector.stop();

                await poll(
                    'info.connection without the test clients',
                    async () => {
                        const state = await harness.states.getStateAsync('mqtt.0.info.connection');
                        const val = typeof state?.val === 'string' ? state.val : '';
                        return (!val.includes('Emitter') && !val.includes('Detector')) || undefined;
                    },
                    30000,
                );

                emitter = await connectClient('Emitter', PORT, emitterRx);
                detector = await connectClient('Detector', PORT, detectorRx);

                await poll(
                    'info.connection with the test clients again',
                    async () => {
                        const state = await harness.states.getStateAsync('mqtt.0.info.connection');
                        const val = typeof state?.val === 'string' ? state.val : '';
                        return (val.includes('Emitter') && val.includes('Detector')) || undefined;
                    },
                    30000,
                );
            });
        });

        // Ported from the legacy testClient suite (@iobroker/legacy-testing): the adapter is a
        // client of an external broker.
        suite('MQTT Adapter Client Mode: topic mapping', getHarness => {
            const PORT = 11889;
            const emitterRx = new Receiver();
            let mqttServer: MqttServer;
            let emitter: MqttClient;

            before(async function () {
                this.timeout(90000);

                const harness = getHarness();
                const systemConfig = await harness.objects.getObjectAsync('system.config');
                const secret = systemConfig?.native?.secret || 'Zgfr56gFe87jJOM';

                await harness.objects.setObjectAsync('testAdapter.0.testChannel.testState', {
                    type: 'state',
                    common: { name: 'testState', type: 'string', read: true, write: true, role: 'variable' },
                    native: {},
                });

                // The test broker announces the "testServer/..." topics to every client that
                // connects, which is what the folder test below relies on.
                mqttServer = new MqttServer({ user: USER, pass: PASS, port: PORT });
                await wait(2000);

                emitter = await connectClient('Emitter', PORT, emitterRx);

                await harness.changeAdapterConfig('mqtt', {
                    native: {
                        type: 'client',
                        url: '127.0.0.1',
                        port: PORT,
                        user: USER,
                        pass: encrypt(secret, PASS),
                        publish: 'mqtt.0.*',
                        patterns: '#',
                        debug: false,
                        onchange: false,
                    },
                    common: {
                        enabled: true,
                        loglevel: 'info',
                    },
                });

                await harness.startAdapterAndWait();
                await wait(3000);
            });

            after(async () => {
                emitter?.stop();
                if (mqttServer) {
                    await new Promise<void>(resolve => mqttServer.stop(() => resolve()));
                }
                await wait(500);
            });

            it('MQTT client: the parent folders of a deep topic are created', async function () {
                this.timeout(20000);
                const harness = getHarness();

                const folder = await poll<ioBroker.Object>('Folder "mqtt.0.testServer"', () =>
                    harness.objects.getObjectAsync('mqtt.0.testServer'),
                );
                assert.strictEqual(folder.type, 'folder');

                const deepFolder = await poll<ioBroker.Object>(
                    'Folder "mqtt.0.testServer.long.test.path.into.ioBroker"',
                    () => harness.objects.getObjectAsync('mqtt.0.testServer.long.test.path.into.ioBroker'),
                );
                assert.strictEqual(deepFolder.type, 'folder');

                const leaf = await poll<ioBroker.Object>('Object of the deep state', () =>
                    harness.objects.getObjectAsync('mqtt.0.testServer.long.test.path.into.ioBroker.connected'),
                );
                assert.strictEqual(leaf.type, 'state');

                const state = await poll('Value of the deep state', async () => {
                    const s = await harness.states.getStateAsync(
                        'mqtt.0.testServer.long.test.path.into.ioBroker.connected',
                    );
                    return s?.val === true ? s : undefined;
                });
                assert.strictEqual(state.val, true);
            });

            for (const topic of Object.keys(RULES)) {
                const id = RULES[topic];

                it(`MQTT client: a message on "${topic}" is stored in "${id}"`, async function () {
                    this.timeout(15000);
                    const harness = getHarness();
                    const value = `Roger${Math.round(Math.random() * 100)}`;

                    await new Promise<void>((resolve, reject) =>
                        emitter.publish(topic, value, (err?: Error) => (err ? reject(err) : resolve())),
                    );

                    const obj = await poll<ioBroker.Object>(`Object "${id}"`, () => harness.objects.getObjectAsync(id));
                    assert.strictEqual(obj._id, id);
                    assert.strictEqual(obj.type, 'state');
                    if (topic.includes('mqtt')) {
                        assert.strictEqual(obj.native.topic, topic, 'The object must remember its topic');
                    }

                    const state = await poll(`State "${id}" with value "${value}"`, async () => {
                        const s = await harness.states.getStateAsync(id);
                        return s?.val === value ? s : undefined;
                    });
                    assert.strictEqual(state.ack, true, 'A value from the broker is an acknowledged status');
                });
            }

            for (const topic of Object.keys(RULES)) {
                const id = RULES[topic];
                if (!id.includes('mqtt')) {
                    continue;
                }

                it(`MQTT client: a change of "${id}" is published as "${topic}"`, async function () {
                    this.timeout(15000);
                    const harness = getHarness();
                    const value = `NewRoger${Math.round(Math.random() * 100)}`;

                    emitterRx.reset();
                    await harness.states.setStateAsync(id, { val: value, ack: false });

                    assert.strictEqual(await emitterRx.waitFor(topic), value);
                });
            }

            it('MQTT client: reconnects after the broker was down', async function () {
                this.timeout(120000);
                const harness = getHarness();

                await new Promise<void>(resolve => mqttServer.stop(() => resolve()));

                await poll(
                    'info.connection === false',
                    async () => {
                        const state = await harness.states.getStateAsync('mqtt.0.info.connection');
                        return (state && !state.val) || undefined;
                    },
                    45000,
                );

                mqttServer = new MqttServer({ user: USER, pass: PASS, port: PORT });

                await poll(
                    'info.connection === true',
                    async () => {
                        const state = await harness.states.getStateAsync('mqtt.0.info.connection');
                        return state?.val || undefined;
                    },
                    45000,
                );
            });
        });
    },
});
