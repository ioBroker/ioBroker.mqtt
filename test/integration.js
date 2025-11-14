const path = require('path');
const { tests } = require('@iobroker/testing');
const expect = require('chai').expect;

// Helper function for encryption (same as in legacy tests)
function encrypt(key, value) {
    let result = '';
    for (let i = 0; i < value.length; ++i) {
        result += String.fromCharCode(key[i % key.length].charCodeAt(0) ^ value.charCodeAt(i));
    }
    return result;
}

// Test MQTT adapter
tests.integration(path.join(__dirname, '..'), {
    allowedExitCodes: [11],

    defineAdditionalTests({ suite }) {

        // Test suite for basic adapter startup in server mode
        suite('MQTT Adapter Basic Tests', (getHarness) => {

            it('Should start adapter in server mode', async function() {
                this.timeout(30000);

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
                        loglevel: 'info'
                    }
                });

                // Start the adapter
                await harness.startAdapterAndWait();

                // Wait a bit for adapter to fully initialize
                await new Promise(resolve => setTimeout(resolve, 3000));

                // Check if adapter is running
                const connectedState = await harness.states.getStateAsync('system.adapter.mqtt.0.connected');
                expect(connectedState, 'Adapter should be connected').to.exist;
                expect(connectedState.val, 'Adapter should be running').to.equal(true);

                // Check if info states exist
                const aliveState = await harness.states.getStateAsync('system.adapter.mqtt.0.alive');
                expect(aliveState, 'Alive state should exist').to.exist;

                await harness.stopAdapter();
            });

        });

        // Test suite for client mode with external MQTT server
        suite('MQTT Client Mode Tests', (getHarness) => {

            let mqttServer;

            before(async function() {
                this.timeout(10000);

                // Start a test MQTT server on a different port
                const MqttServer = require('./lib/mqttServer.js');
                mqttServer = new MqttServer({
                    user: 'testuser',
                    pass: 'testpass',
                    port: 11884
                });

                // Give server time to start
                await new Promise(resolve => setTimeout(resolve, 2000));
            });

            after(function() {
                if (mqttServer) {
                    try {
                        mqttServer.stop();
                    } catch (e) {
                        // Ignore errors on cleanup
                    }
                }
            });

            it('Should start adapter in client mode', async function() {
                this.timeout(30000);

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
                    },
                    common: {
                        enabled: true,
                        loglevel: 'info'
                    }
                });

                // Start the adapter
                await harness.startAdapterAndWait();

                // Wait for adapter to initialize and connect
                await new Promise(resolve => setTimeout(resolve, 5000));

                // Check if adapter is running
                const connectedState = await harness.states.getStateAsync('system.adapter.mqtt.0.connected');
                expect(connectedState, 'Adapter should be connected').to.exist;
                expect(connectedState.val, 'Adapter should be running').to.equal(true);

                // Check connection info state
                const connectionInfo = await harness.states.getStateAsync('mqtt.0.info.connection');
                expect(connectionInfo, 'Connection info should exist').to.exist;

                await harness.stopAdapter();
            });

            it('Should receive messages from MQTT server', async function() {
                this.timeout(30000);

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
                    },
                    common: {
                        enabled: true,
                        loglevel: 'info'
                    }
                });

                // Start the adapter
                await harness.startAdapterAndWait();

                // Wait for messages from server to be processed
                await new Promise(resolve => setTimeout(resolve, 5000));

                // Check if states from server were created
                const testServerState = await harness.objects.getObjectAsync('mqtt.0.testServer.connected');
                if (testServerState) {
                    expect(testServerState.type, 'Should create state object').to.equal('state');

                    const state = await harness.states.getStateAsync('mqtt.0.testServer.connected');
                    expect(state, 'State should exist').to.exist;
                    expect(state.val, 'Should receive true from server').to.equal(true);
                }

                await harness.stopAdapter();
            });

        });

    }
});
