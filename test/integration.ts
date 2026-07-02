import * as path from 'node:path';
import assert from 'node:assert';
import { tests } from '@iobroker/testing';
import MqttServer from './lib/mqttServer';

// Helper function for encryption (same as in the legacy tests)
function encrypt(key: string, value: string): string {
    let result = '';
    for (let i = 0; i < value.length; ++i) {
        result += String.fromCharCode(key[i % key.length].charCodeAt(0) ^ value.charCodeAt(i));
    }
    return result;
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
    },
});
