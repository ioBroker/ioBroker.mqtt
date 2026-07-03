import assert from 'node:assert';
import Adapter from './lib/adapterSim';
import SimulatedServer from './lib/mqttServer';
import ClientEmitter from './lib/mqttClient';

// The compiled adapter under test (build/) ships no type declarations, so load it untyped.
const Client = require('../build/lib/MQTTClient').default;

let port = 1883;

describe('MQTT client', function () {
    let adapter: Adapter;
    let simulatedServer: SimulatedServer;
    let client: any;
    const states: Record<string, ioBroker.State> = {};
    this.timeout(3000);

    before('MQTT client: Start MQTT simulatedServer', done => {
        adapter = new Adapter({
            port: ++port,
            url: '127.0.0.1',
            onchange: true,
            clientId: 'testAdapter',
            binaryTopics: 'binimg',
        });
        simulatedServer = new SimulatedServer({ port, dontSend: true });
        client = new Client(adapter, states);
        done();
    });

    it('MQTT client: Check if connected to MQTT broker', done => {
        setTimeout(async () => {
            const data = await adapter.getStateAsync('info.connection');
            assert.ok(data);
            assert.strictEqual(data.val, true);
            done();
        }, 200);
    });

    it('MQTT client: New topic with {val:null} payload should get type "mixed"', done => {
        const topic = 'clientTypetestNull';
        // A separate MQTT client publishes to the simulated broker;
        // the broker forwards it to the ioBroker client adapter under test.
        const publisher = new ClientEmitter(
            isConnected => {
                if (isConnected) {
                    publisher.publish(topic, JSON.stringify({ val: null }));
                    setTimeout(async () => {
                        const obj = await adapter.getForeignObjectAsync(`mqtt.0.${topic}`);
                        assert.ok(obj);
                        assert.strictEqual((obj as ioBroker.StateObject).common.type, 'mixed');
                        publisher.destroy();
                        done();
                    }, 500);
                }
            },
            null,
            { url: `127.0.0.1:${port}`, clean: true, clientId: 'clientTypeTestPublisher', subscribe: false },
        );
    }).timeout(3000);

    it('MQTT client: Existing numeric topic should keep type "number" after repeated JSON state publish', done => {
        const topic = 'clientTypetestNumber';
        const publisher = new ClientEmitter(
            isConnected => {
                if (isConnected) {
                    // First publish: creates topic with type 'number'
                    publisher.publish(topic, JSON.stringify({ val: 42 }));
                    setTimeout(() => {
                        // Second publish: must not flip type to 'object'/'mixed'
                        publisher.publish(topic, JSON.stringify({ val: 7 }));
                        setTimeout(async () => {
                            const obj = await adapter.getForeignObjectAsync(`mqtt.0.${topic}`);
                            assert.ok(obj);
                            assert.strictEqual((obj as ioBroker.StateObject).common.type, 'number');
                            publisher.destroy();
                            done();
                        }, 500);
                    }, 500);
                }
            },
            null,
            { url: `127.0.0.1:${port}`, clean: true, clientId: 'clientTypeTestNumberPublisher', subscribe: false },
        );
    }).timeout(3000);

    it('MQTT client: Binary topic payload is stored as a file and the state holds the URL', done => {
        const topic = 'binimg';
        // raw bytes that are NOT valid UTF-8 text (would be corrupted by a normal string state)
        const payload = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x10, 0x89, 0x50]);
        const publisher = new ClientEmitter(
            isConnected => {
                if (isConnected) {
                    publisher.publish(topic, payload);
                    setTimeout(async () => {
                        // the exact raw bytes are stored as a file
                        const stored = (adapter as any).getStoredFile('mqtt.0', topic) as Buffer | undefined;
                        assert.ok(stored, 'binary payload should be stored as a file');
                        assert.strictEqual(Buffer.compare(stored, payload), 0, 'stored bytes must match the payload');

                        // the object is a url string state marked as binary
                        const obj = (await adapter.getForeignObjectAsync(`mqtt.0.${topic}`)) as ioBroker.StateObject;
                        assert.ok(obj);
                        assert.strictEqual(obj.common.type, 'string');
                        assert.strictEqual(obj.common.role, 'url');
                        assert.strictEqual((obj.native as any).binary, true);
                        assert.strictEqual((obj.native as any).file, topic);

                        // the state value points to the stored file
                        const st = await adapter.getForeignStateAsync(`mqtt.0.${topic}`);
                        assert.ok(st);
                        assert.strictEqual(st.val, `/files/mqtt.0/${topic}`);

                        publisher.destroy();
                        done();
                    }, 500);
                }
            },
            null,
            { url: `127.0.0.1:${port}`, clean: true, clientId: 'binaryTestPublisher', subscribe: false },
        );
    }).timeout(3000);

    after('MQTT simulatedServer: Stop MQTT simulatedServer', done => {
        simulatedServer.stop(done);
        client.destroy();
    });
});
