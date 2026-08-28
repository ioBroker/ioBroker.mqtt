import assert from 'node:assert';
import Adapter from './lib/adapterSim';
import Client from './lib/mqttClient';

// The compiled adapter under test (build/) ships no type declarations, so load it untyped.
const Server = require('../build/lib/MQTTServer').default;

let port = 1883;

describe('MQTT server', function () {
    let adapter: Adapter;
    let server: any;
    const states: Record<string, any> = {};
    this.timeout(3000);

    before('MQTT server: Start MQTT server', done => {
        adapter = new Adapter({
            port: ++port,
            defaultQoS: 1,
            onchange: true,
            binaryTopics: 'binimg',
        });
        server = new Server(adapter, states);
        done();
    });

    it('MQTT server: Check if connected to MQTT broker', doneCb => {
        let done: Mocha.Done | null = doneCb;
        const client = new Client(
            isConnected => {
                if (done) {
                    assert.strictEqual(isConnected, true);
                    client.destroy();
                    done();
                    done = null;
                }
            },
            null,
            {
                url: `127.0.0.1:${port}`,
                clientId: 'testClient1',
            },
        );
    });

    it('MQTT server: Check if subscribes stored', () => {
        let client: any;
        const data = 1;
        return new Promise<void>(resolve => {
            client = new Client(
                isConnected => {
                    if (isConnected) {
                        client.subscribe('aaa');
                        setTimeout(() => client.destroy(), 200); // let time to send it out
                    } else {
                        adapter.setForeignState('mqtt.0.aaa', data);
                        server.onStateChange('mqtt.0.aaa', { val: data, ack: false });
                        setTimeout(() => resolve(), 100);
                    }
                },
                null,
                {
                    url: `127.0.0.1:${port}`,
                    clean: false,
                    clientId: 'testClient2',
                    resubscribe: false,
                },
            );
        }).then(() => {
            void new Promise<void>(resolve => {
                client = new Client(
                    () => {},
                    (topic, message) => {
                        if (topic === 'aaa') {
                            assert.strictEqual(topic, 'aaa');
                            assert.strictEqual(message.toString(), data.toString());
                            client.destroy();
                            resolve();
                        }
                    },
                    {
                        url: `127.0.0.1:${port}`,
                        clean: false,
                        clientId: 'testClient2',
                        resubscribe: false,
                    },
                );
            });
        });
    });

    it('MQTT server: Check if QoS1 retransmitted', done => {
        let client: any;
        const data = 1;
        let count = 0;
        const id = 'aaa2';
        let allowPuback = false;
        let receiveFunc: ((topic: string, data: Buffer) => void) | undefined;
        void new Promise<void>(resolve => {
            client = new Client(
                isConnected => {
                    if (isConnected) {
                        client.subscribe(id, { qos: 1 });
                        setTimeout(() => resolve(), 100);
                    }
                },
                (topic, data) => receiveFunc && receiveFunc(topic, data),
                {
                    url: `127.0.0.1:${port}`,
                    clean: false,
                    clientId: 'testClient3',
                    resubscribe: false,
                },
            );
            const sendPacket = client.client._sendPacket;
            // do not change "function (...)" to "=>"
            client.client._sendPacket = function (this: any, packet: any, cb: any, cbStorePut: any) {
                // ignore one puback
                if (packet.cmd === 'puback' && !allowPuback) {
                    count++;
                    cb && cb();
                    return;
                }
                sendPacket.call(this, packet, cb, cbStorePut);
            };
        })
            .then(async () => {
                await adapter.setForeignObjectAsync(`mqtt.0.${id}`, {
                    _id: `mqtt.0.${id}`,
                    common: { type: 'number', name: id, role: 'variable', read: true, write: true },
                    native: {},
                    type: 'state',
                });
                await adapter.setForeignStateAsync(`mqtt.0.${id}`, data);
                server.onStateChange(`mqtt.0.${id}`, { val: data, ack: false });

                return new Promise<void>(resolve => {
                    setTimeout(() => resolve(), 1000);
                });
            })
            .then(() => {
                console.log(`[${new Date().toISOString()} continue tests`);
                assert.strictEqual(count, 1);
                allowPuback = true;
                receiveFunc = () => {
                    client.destroy();
                    done();
                };
            });
    }).timeout(5000);

    it('MQTT server: Check if QoS2 retransmitted', done => {
        let receiverClient: any;
        let emitterClient: any;
        const data = 1;
        const id = 'aaa3';
        let count = 0;
        let allowPubrec = false;
        let receiveFunc: ((topic: string, data: Buffer) => void) | undefined;
        void new Promise<void>(resolve => {
            receiverClient = new Client(
                isConnected => {
                    if (isConnected) {
                        receiverClient.subscribe(id, { qos: 2 });
                        setTimeout(() => resolve(), 100);
                    }
                },
                (topic, data) => receiveFunc && receiveFunc(topic, data),
                {
                    url: `127.0.0.1:${port}`,
                    clean: false,
                    clientId: 'receiverClient',
                    resubscribe: false,
                },
            );
            emitterClient = new Client(null, null, {
                url: `127.0.0.1:${port}`,
                clean: true,
                clientId: 'emitterClient',
                resubscribe: false,
            });
            const sendPacket = receiverClient.client._sendPacket;

            // do not change "function (...)" to "=>"
            receiverClient.client._sendPacket = function (this: any, packet: any, cb: any, _cbStorePut: any) {
                // ignore pubrec
                if (packet.cmd === 'pubrec' && !allowPubrec) {
                    count++;
                    cb && cb();
                    return;
                }
                sendPacket.call(this, packet, cb);
            };
        })
            .then(() => {
                return new Promise<void>(resolve => {
                    emitterClient.publish(id, data.toString(), 2, () => {}); // Send QoS 2
                    setTimeout(() => resolve(), 100);
                });
            })
            .then(() => {
                assert.strictEqual(count, 1);
                allowPubrec = true;
                receiveFunc = () => {
                    receiverClient.destroy();
                    emitterClient.destroy();
                    done();
                };
            });
    }).timeout(5000);

    it('MQTT server: Check if message with QoS1 received', done => {
        let receiverClient: any;
        let emitterClient: any;
        const data = 1;
        const id = 'aaa4';
        let receiveFunc: ((topic: string, data: Buffer, packet: any) => void) | undefined;
        void new Promise<void>(resolve => {
            receiverClient = new Client(
                isConnected => {
                    if (isConnected) {
                        receiverClient.subscribe(id, { qos: 1 });
                        setTimeout(() => resolve(), 100);
                    }
                },
                (topic, data, packet) => receiveFunc && receiveFunc(topic, data, packet),
                {
                    url: `127.0.0.1:${port}`,
                    clean: false,
                    clientId: 'receiverClient',
                    resubscribe: false,
                },
            );
            emitterClient = new Client(null, null, {
                url: `127.0.0.1:${port}`,
                clean: true,
                clientId: 'emitterClient',
                resubscribe: false,
            });
        }).then(() => {
            return new Promise<void>(resolve => {
                receiveFunc = (topic, data, packet) => {
                    assert.ok(data);
                    assert.ok(topic);
                    assert.strictEqual(packet.qos, 1);
                    receiverClient.destroy();
                    emitterClient.destroy();
                    done();
                };
                emitterClient.publish(id, data.toString(), 1, () => {}); // Send QoS 2
                setTimeout(() => resolve(), 100);
            });
        });
    }).timeout(1000);

    // check unsubscribe
    it('MQTT server: Check if unsubscribes works', () => {
        let client: any;
        const data = 1;
        let count = 0;
        return new Promise<void>(resolve => {
            client = new Client(
                isConnected => {
                    if (isConnected) {
                        client.subscribe('aaa6');
                        setTimeout(() => {
                            adapter.setForeignState('mqtt.0.aaa6', data);
                            server.onStateChange('mqtt.0.aaa6', { val: data, ack: false });
                        }, 500);
                    }
                },
                (id, topic) => {
                    if (id.includes('aaa6')) {
                        console.log(`Received ${topic.toString()}`);
                        count++;
                        assert.strictEqual(count, 1);
                        setTimeout(() => resolve(), 100);
                    }
                },
                {
                    url: `127.0.0.1:${port}`,
                    clean: true,
                    clientId: 'testClient6',
                    resubscribe: false,
                },
            );
        }).then(() => {
            return new Promise<void>(resolve => {
                client.unsubscribe('aaa6');
                client.unsubscribe('#');
                setTimeout(() => {
                    console.log('Resend data');
                    adapter.setForeignState('mqtt.0.aaa6', 2);
                    server.onStateChange('mqtt.0.aaa6', { val: 2, ack: false });
                    // wait 1 second to not receive the update
                    setTimeout(() => {
                        console.log('Done');
                        client.destroy();
                        resolve();
                    }, 1000);
                }, 300);
            });
        });
    }).timeout(3000);

    it('MQTT server: New topic with {val:null} payload should get type "mixed"', () => {
        let emitterClient: any;
        const topic = 'typetestNull';
        return new Promise<void>(resolve => {
            emitterClient = new Client(
                isConnected => {
                    if (isConnected) {
                        emitterClient.publish(topic, JSON.stringify({ val: null }));
                        setTimeout(() => resolve(), 300);
                    }
                },
                null,
                { url: `127.0.0.1:${port}`, clean: true, clientId: 'typeTestNullClient' },
            );
        }).then(async () => {
            const obj = await adapter.getForeignObjectAsync(`mqtt.0.${topic}`);
            assert.ok(obj);
            assert.strictEqual((obj as ioBroker.StateObject).common.type, 'mixed');
            emitterClient.destroy();
        });
    }).timeout(2000);

    it('MQTT server: Existing numeric topic should keep type "number" after repeated JSON state publish', () => {
        let emitterClient: any;
        const topic = 'typetestNumber';
        return new Promise<void>(resolve => {
            emitterClient = new Client(
                isConnected => {
                    if (isConnected) {
                        // First publish: creates topic with type 'number'
                        emitterClient.publish(topic, JSON.stringify({ val: 42 }));
                        setTimeout(() => {
                            // Second publish: must not flip type to 'object'
                            emitterClient.publish(topic, JSON.stringify({ val: 7 }));
                            setTimeout(() => resolve(), 300);
                        }, 300);
                    }
                },
                null,
                { url: `127.0.0.1:${port}`, clean: true, clientId: 'typeTestNumberClient' },
            );
        }).then(async () => {
            const obj = await adapter.getForeignObjectAsync(`mqtt.0.${topic}`);
            assert.ok(obj);
            assert.strictEqual((obj as ioBroker.StateObject).common.type, 'number');
            emitterClient.destroy();
        });
    }).timeout(3000);

    it('MQTT server: Binary topic payload is stored as a file and the state holds the URL', () => {
        let emitterClient: any;
        const topic = 'binimg';
        // raw bytes that are NOT valid UTF-8 text (would be corrupted by a normal string state)
        const payload = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x10, 0x89, 0x50]);
        return new Promise<void>(resolve => {
            emitterClient = new Client(
                isConnected => {
                    if (isConnected) {
                        emitterClient.publish(topic, payload);
                        setTimeout(() => resolve(), 300);
                    }
                },
                null,
                { url: `127.0.0.1:${port}`, clean: true, clientId: 'binaryServerClient' },
            );
        }).then(async () => {
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

            emitterClient.destroy();
        });
    }).timeout(2000);

    after('MQTT server: Stop MQTT server', done => {
        server.destroy(done);
    });
});

/**
 * Regression test for the QoS 2 session lockup fix.
 *
 * Scenario being tested:
 *   1. The broker publishes a QoS 2 message to a subscribed client.
 *   2. The client deliberately withholds the PUBREC for 400 ms while the broker
 *      retransmits the message.
 *   3. The client then sends a PUBREC (simulating a late / out-of-order response).
 *   4. The broker must always respond with PUBREL to complete the QoS 2 handshake
 *      (the fix). Without the fix the broker would silently drop the PUBREC, leaving
 *      the client stuck in an infinite PUBREC loop.
 *
 * Note on retransmitCount: the value 0 is falsy and is normalised to 10 by the
 * server (config.retransmitCount ||= 10), so the broker never disconnects the
 * client during the 400 ms window.  The short retransmitInterval (100 ms) is
 * kept only to exercise the retransmit path, not to trigger exhaustion.
 */
describe('MQTT server: QoS2 session lockup regression', function () {
    let adapter2: Adapter;
    let server2: any;
    const states2: Record<string, any> = {};
    this.timeout(5000); // applies to all tests and hooks in this describe

    before('MQTT server: QoS2 lockup: Start server', done => {
        adapter2 = new Adapter({
            port: ++port,
            defaultQoS: 2,
            onchange: true,
            // Very short retransmit interval so the message is retransmitted
            // quickly within the 400 ms wait window.
            // retransmitCount: 0 →  normalised to 10 by the server, so the client
            // is never disconnected during this test.
            retransmitInterval: 100,
            retransmitCount: 0,
        });
        server2 = new Server(adapter2, states2);
        // Give the TCP server a chance to start listening before the tests run
        setTimeout(done, 100);
    });

    it('MQTT server: QoS2 lockup: Broker sends PUBREL for orphaned PUBREC messageId', done => {
        const net = require('net');
        const mqttCon = require('../build/lib/MqttConnection').default;
        const stream = net.createConnection(port, '127.0.0.1');
        const client = new mqttCon(stream);

        let capturedMessageId: number | null = null;
        let firstPublishSeen = false;
        let finished = false;

        const finish = (err?: any): void => {
            if (finished) {
                return;
            }
            finished = true;
            done(err);
        };

        stream.on('error', finish);
        client.on('error', finish);

        // Step 1 – Connected: subscribe to the test topic with QoS 2
        client.on('connack', () => {
            client.subscribe({
                subscriptions: [{ topic: 'qos2orphan', qos: 2 }],
                messageId: 1,
            });
        });

        // Step 2 – Subscribed: trigger the broker to publish a QoS 2 message
        client.on('suback', async () => {
            // Ensure the object exists before calling onStateChange so that
            // getMqttMessage can resolve the id → topic mapping.
            await adapter2.setForeignObjectAsync('mqtt.0.qos2orphan', {
                _id: 'mqtt.0.qos2orphan',
                type: 'state',
                common: { type: 'string', name: 'qos2orphan', role: 'variable', read: true, write: true },
                native: {},
            });
            states2['mqtt.0.qos2orphan'] = { val: 'testPayload', ack: false };
            server2.onStateChange('mqtt.0.qos2orphan', { val: 'testPayload', ack: false });
        });

        // Step 3 – PUBLISH received: capture messageId but intentionally withhold PUBREC
        //          for 400 ms to simulate a slow / delayed client response.
        client.on('publish', (packet: any) => {
            if (!firstPublishSeen && packet.qos === 2) {
                firstPublishSeen = true;
                capturedMessageId = packet.messageId;

                // Wait 400 ms (> 3 × 100 ms retransmit interval) so that the broker
                // retransmits the message several times before we reply.
                setTimeout(() => {
                    assert.strictEqual(typeof capturedMessageId, 'number');
                    // Send PUBREC – the broker must always reply with PUBREL
                    client.pubrec({ messageId: capturedMessageId });
                }, 400);
            }
            // Ignore any retransmitted PUBLISH packets
        });

        // Step 4 – PUBREL received: the broker must reply to every PUBREC with PUBREL,
        //          regardless of whether the messageId is still in the outgoing queue
        //          (this is the behaviour introduced by the fix)
        client.on('pubrel', (packet: any) => {
            if (packet.messageId === capturedMessageId) {
                // Complete the handshake from the client side
                client.pubcomp({ messageId: packet.messageId });
                // Give pubcomp a moment to be flushed before tearing down the stream
                setTimeout(() => {
                    stream.destroy();
                    finish();
                }, 50);
            }
        });

        // Initiate the MQTT connection
        client.connect({
            clientId: 'qos2OrphanRegression',
            clean: true,
            keepalive: 0,
            protocolId: 'MQTT',
            protocolVersion: 4,
        });
    }).timeout(5000);

    after('MQTT server: QoS2 lockup: Stop server', done => {
        server2.destroy(done);
    });
});

/**
 * Tests the retry-exhaustion-disconnect behaviour introduced in fix/retry-exhaustion-disconnect.
 *
 * Sequence:
 *   1. Broker publishes a QoS 1 message to a subscribed persistent-session client.
 *   2. The client withholds the PUBACK so the broker keeps retransmitting.
 *   3. The client uses keepalive=0 (disabled), so the broker has no keepalive
 *      timeout to rely on.  After exceeding retransmitCount (2) retries (i.e. after 3 retransmissions) the broker therefore
 *      disconnects the client via clientClose().  The message is kept in the
 *      persistent session.
 *   4. The client reconnects with the same clientId and clean=false.
 *   5. The broker calls resendMessages2Client(), which resets count to 0 and
 *      immediately resends the queued message.
 *   6. The client ACKs the message – test passes.
 *
 * keepalive=0 is deliberate: with keepalive > 0 the broker defers to the
 * stream timeout (1.5 × keepalive) as required by MQTT §3.1.2.10 and does
 * NOT disconnect on retry exhaustion.
 *
 * A dedicated server with retransmitInterval:100 / retransmitCount:2 is used
 * so the whole scenario runs within ~600 ms.
 */
describe('MQTT server: retry exhaustion – disconnect and reconnect', function () {
    let adapter3: Adapter;
    let server3: any;
    const states3: Record<string, any> = {};

    before('MQTT server: retry/disconnect: Start server', done => {
        adapter3 = new Adapter({
            port: ++port,
            defaultQoS: 1,
            onchange: true,
            // retransmitCount must be > 0 to avoid being normalised to 10 by ||=
            // count > 2 triggers disconnect → disconnect after 3 retransmissions
            retransmitInterval: 100,
            retransmitCount: 2,
        });
        server3 = new Server(adapter3, states3);
        setTimeout(done, 100);
    });

    it('MQTT server: retry/disconnect: broker disconnects unresponsive client and resends on reconnect', function (done) {
        const net = require('net');
        const mqttCon = require('../build/lib/MqttConnection').default;

        const CLIENT_ID = 'retryExhaustionTest';
        const TOPIC = 'retryDisconnectTopic';
        const PAYLOAD = 'retryPayload42';

        let phase2Started = false;
        // Fallback timer: retransmitInterval(100) × (retransmitCount(2)+2) ticks = ~400ms,
        // plus generous margin so the timer fires only if the close event is missed
        let fallbackTimer: NodeJS.Timeout | undefined;

        // ── Phase 2: reconnect and expect message resend ──────────────────────
        function phase2(): void {
            if (phase2Started) {
                return;
            }
            phase2Started = true;

            // Small delay to let the broker fully process the close before we reconnect
            setTimeout(() => {
                const stream2 = net.createConnection(port, '127.0.0.1');
                const client2 = new mqttCon(stream2);

                stream2.on('error', (err: any) => done(err));
                client2.on('error', (err: any) => done(err));

                client2.on('publish', (packet: any) => {
                    if (packet.qos === 1) {
                        // The broker must resend exactly the same payload
                        assert.strictEqual(packet.payload.toString(), PAYLOAD);
                        // ACK so the broker clears the message from the queue
                        client2.puback({ messageId: packet.messageId });
                        setTimeout(() => {
                            stream2.destroy();
                            done();
                        }, 50);
                    }
                });

                client2.connect({
                    clientId: CLIENT_ID,
                    clean: false, // resume persistent session → triggers resend
                    keepalive: 0,
                    protocolId: 'MQTT',
                    protocolVersion: 4,
                });
            }, 50);
        }

        // ── Phase 1: persistent-session client, subscribe, withhold PUBACK ───
        const stream1 = net.createConnection(port, '127.0.0.1');
        const client1 = new mqttCon(stream1);

        // Catch RST/ECONNRESET emitted when the broker destroys the connection;
        // both the raw stream and the MqttConnection wrapper may surface it.
        stream1.on('error', () => {});
        client1.on('error', () => {});

        // Trigger phase 2 as soon as the broker closes the connection
        stream1.on('close', () => {
            clearTimeout(fallbackTimer);
            phase2();
        });

        client1.on('connack', () => {
            client1.subscribe({
                subscriptions: [{ topic: TOPIC, qos: 1 }],
                messageId: 1,
            });
        });

        client1.on('suback', async () => {
            await adapter3.setForeignObjectAsync(`mqtt.0.${TOPIC}`, {
                _id: `mqtt.0.${TOPIC}`,
                type: 'state',
                common: { type: 'string', name: TOPIC, role: 'variable', read: true, write: true },
                native: {},
            });
            states3[`mqtt.0.${TOPIC}`] = { val: PAYLOAD, ack: false };
            server3.onStateChange(`mqtt.0.${TOPIC}`, { val: PAYLOAD, ack: false });

            // Fallback: if 'close' event is never emitted, trigger phase 2 after
            // we are certain the broker has exhausted retries and disconnected
            fallbackTimer = setTimeout(phase2, 800);
        });

        // Receive the PUBLISH but deliberately never send PUBACK
        client1.on('publish', () => {
            /* intentionally empty – no PUBACK */
        });

        client1.connect({
            clientId: CLIENT_ID,
            clean: false, // persistent session so messages survive disconnect
            keepalive: 0,
            protocolId: 'MQTT',
            protocolVersion: 4,
        });
    }).timeout(3000);

    after('MQTT server: retry/disconnect: Stop server', done => {
        server3.destroy(done);
    });
});

/**
 * Tests that when keepalive > 0 the broker does NOT disconnect the client when
 * retransmitCount is exceeded.  Instead, it defers to the stream timeout
 * (1.5 × keepalive) as required by MQTT §3.1.2.10 and keeps retransmitting.
 *
 * Sequence:
 *   1. Broker publishes a QoS 1 message to a subscribed client with keepalive=10s.
 *   2. The client withholds the PUBACK so the broker keeps retransmitting.
 *   3. retransmitCount is set to 2, so with keepalive=0 a disconnect would
 *      occur after 3 retransmissions.
 *   4. With keepalive > 0 the broker must NOT disconnect; the test verifies that
 *      the client receives at least retransmitCount+2 publish packets (proving
 *      the connection is still alive beyond the threshold).
 *   5. The client ACKs the message so the broker clears it – test passes.
 *
 * A dedicated server with retransmitInterval:100 / retransmitCount:2 is used
 * so the scenario runs in ~500 ms.
 */
describe('MQTT server: retry exhaustion – keepalive>0 keeps retransmitting', function () {
    let adapter4: Adapter;
    let server4: any;
    const states4: Record<string, any> = {};
    const RETRANSMIT_COUNT = 2;

    before('MQTT server: retry/keepalive: Start server', done => {
        adapter4 = new Adapter({
            port: ++port,
            defaultQoS: 1,
            onchange: true,
            retransmitInterval: 100,
            retransmitCount: RETRANSMIT_COUNT,
        });
        server4 = new Server(adapter4, states4);
        setTimeout(done, 100);
    });

    it('MQTT server: retry/keepalive: broker keeps retransmitting when keepalive>0', function (done) {
        const net = require('net');
        const mqttCon = require('../build/lib/MqttConnection').default;

        const CLIENT_ID = 'keepaliveRetryTest';
        const TOPIC = 'keepaliveRetryTopic';
        const PAYLOAD = 'keepalivePayload99';

        // We need to receive at least retransmitCount+2 publish packets to be
        // certain the broker did NOT disconnect after exceeding retransmitCount.
        const REQUIRED_PUBLISHES = RETRANSMIT_COUNT + 2;
        let publishCount = 0;
        let testDone = false;

        const stream = net.createConnection(port, '127.0.0.1');
        const client = new mqttCon(stream);

        stream.on('error', (err: any) => {
            if (!testDone) {
                done(err);
            }
        });
        client.on('error', (err: any) => {
            if (!testDone) {
                done(err);
            }
        });

        // If the broker disconnects us the stream closes – that would be a failure.
        stream.on('close', () => {
            if (!testDone) {
                done(
                    new Error(
                        `Broker disconnected client after only ${publishCount} publish(es) – expected no disconnect with keepalive>0`,
                    ),
                );
            }
        });

        client.on('connack', () => {
            client.subscribe({
                subscriptions: [{ topic: TOPIC, qos: 1 }],
                messageId: 1,
            });
        });

        client.on('suback', async () => {
            await adapter4.setForeignObjectAsync(`mqtt.0.${TOPIC}`, {
                _id: `mqtt.0.${TOPIC}`,
                type: 'state',
                common: { type: 'string', name: TOPIC, role: 'variable', read: true, write: true },
                native: {},
            });
            states4[`mqtt.0.${TOPIC}`] = { val: PAYLOAD, ack: false };
            server4.onStateChange(`mqtt.0.${TOPIC}`, { val: PAYLOAD, ack: false });
        });

        client.on('publish', (packet: any) => {
            if (packet.qos !== 1) {
                return;
            }

            publishCount++;

            if (publishCount < REQUIRED_PUBLISHES) {
                // Withhold PUBACK to force further retransmissions
                return;
            }

            // We have received enough retransmissions – connection is still alive.
            // Verify the payload is correct, then ACK to let the broker clean up.
            assert.strictEqual(packet.payload.toString(), PAYLOAD);
            testDone = true;
            client.puback({ messageId: packet.messageId });
            setTimeout(() => {
                stream.destroy();
                done();
            }, 50);
        });

        client.connect({
            clientId: CLIENT_ID,
            clean: true,
            // keepalive=10s: large enough that the stream timeout (15s) never fires
            // during this short test, proving the broker waits for it.
            keepalive: 10,
            protocolId: 'MQTT',
            protocolVersion: 4,
        });
    }).timeout(3000);

    after('MQTT server: retry/keepalive: Stop server', done => {
        server4.destroy(done);
    });
});

/**
 * Regression test for the "reject unresolved topic ids with SUBACK failure" fix.
 *
 * When a client subscribes to a wildcard-free topic whose id cannot be resolved
 * to an ioBroker object, the broker must:
 *   1. reject only that subscription with the MQTT SUBACK failure code 0x80, and
 *   2. still send a SUBACK (the previous code returned early from the subscribe
 *      handler, so the client never received a SUBACK and would hang).
 *
 * The server is started with ignoreNewObjects:true so checkObject() throws for any
 * unknown topic, reliably exercising the rejection path.
 */
describe('MQTT server: subscribe rejects unresolvable topic with SUBACK failure', function () {
    let adapter5: Adapter;
    let server5: any;
    const states5: Record<string, any> = {};
    this.timeout(5000);

    before('MQTT server: suback-failure: Start server', done => {
        adapter5 = new Adapter({
            port: ++port,
            defaultQoS: 1,
            onchange: true,
            // make checkObject() reject unknown topics so the subscription cannot be resolved
            ignoreNewObjects: true,
        });
        server5 = new Server(adapter5, states5);
        setTimeout(done, 100);
    });

    it('MQTT server: suback-failure: returns 0x80 for an unresolvable topic and still sends SUBACK', done => {
        const net = require('net');
        const mqttCon = require('../build/lib/MqttConnection').default;
        const stream = net.createConnection(port, '127.0.0.1');
        const client = new mqttCon(stream);

        let finished = false;
        const finish = (err?: any): void => {
            if (finished) {
                return;
            }
            finished = true;
            try {
                stream.destroy();
            } catch {
                /* ignore */
            }
            done(err);
        };

        stream.on('error', finish);
        client.on('error', finish);

        client.on('connack', () => {
            client.subscribe({
                subscriptions: [{ topic: 'unresolvableTopic', qos: 1 }],
                messageId: 1,
            });
        });

        // Receiving a SUBACK at all already proves the handler no longer aborts early.
        client.on('suback', (packet: any) => {
            try {
                assert.ok(Array.isArray(packet.granted));
                assert.strictEqual(packet.granted.length, 1);
                assert.strictEqual(packet.granted[0], 0x80);
                finish();
            } catch (e) {
                finish(e);
            }
        });

        client.connect({
            clientId: 'subackFailureClient',
            clean: true,
            keepalive: 0,
            protocolId: 'MQTT',
            protocolVersion: 4,
        });
    }).timeout(4000);

    after('MQTT server: suback-failure: Stop server', done => {
        server5.destroy(done);
    });
});

// The Shelly adapter creates IDs like "shelly.0.SHCB-1#3494546B9BEC#1"; "#" is an MQTT wildcard,
// so it is published as "_" and cannot be restored from the topic by convertTopic2id.
describe('MQTT server with an ID that cannot be restored from its topic', function () {
    let adapter: Adapter;
    let server: any;
    const states: Record<string, any> = {};
    this.timeout(10000);

    const shellyId = 'shelly.0.SHCB-1#3494546B9BEC#1.lights.Switch';
    const topic = 'shelly/0/SHCB-1_3494546B9BEC_1/lights/Switch';
    const wrongId = 'mqtt.0.shelly.0.SHCB-1_3494546B9BEC_1.lights.Switch';

    before('MQTT server (lossy ID): Start MQTT server', async () => {
        adapter = new Adapter({ port: ++port, defaultQoS: 0, onchange: true });

        // this state is published by the adapter (main.ts pre-loads the "publish" pattern)
        states[shellyId] = { val: false, ack: true };
        await adapter.setForeignObjectAsync(shellyId, {
            _id: shellyId,
            type: 'state',
            common: { name: 'Switch', type: 'boolean', read: true, write: true, role: 'switch' },
            native: {},
        });

        server = new Server(adapter, states);
        await new Promise<void>(resolve => setTimeout(resolve, 200));
    });

    it('MQTT server: a published value is written back to the original state', done => {
        const client: any = new Client(
            isConnected => {
                if (isConnected) {
                    client.publish(topic, 'true');
                    setTimeout(async () => {
                        const st = await adapter.getForeignStateAsync(shellyId);
                        const created = await adapter.getForeignObjectAsync(wrongId);
                        // destroy before asserting, so a failure does not leave the client
                        // reconnecting into the following suites
                        client.destroy();
                        try {
                            assert.ok(st, 'the value must be written back to the original state');
                            assert.strictEqual(st.val, true);
                            assert.strictEqual(created, undefined, 'no state may be created in the own namespace');
                            done();
                        } catch (e) {
                            done(e);
                        }
                    }, 500);
                }
            },
            null,
            { url: `127.0.0.1:${port}`, clean: true, clientId: 'shellyServerPublisher', subscribe: false },
        );
    }).timeout(4000);

    it('MQTT server: a subscription on that topic is registered for the original state', done => {
        const client: any = new Client(
            isConnected => {
                if (isConnected) {
                    client.subscribe(topic);
                    setTimeout(() => {
                        // the value has to reach the subscriber under its original ID
                        server.onStateChange(shellyId, { val: false, ack: true });
                    }, 200);
                }
            },
            (receivedTopic: string, message: Buffer) => {
                if (receivedTopic === topic) {
                    const payload = message.toString();
                    client.destroy();
                    try {
                        assert.strictEqual(payload, 'false');
                        done();
                    } catch (e) {
                        done(e);
                    }
                }
            },
            { url: `127.0.0.1:${port}`, clean: true, clientId: 'shellyServerSubscriber', resubscribe: false },
        );
    }).timeout(4000);

    after('MQTT server (lossy ID): Stop server', done => {
        server.destroy(done);
    });
});

// MQTT 5.0 support. The broker speaks the protocol level each client announced in its CONNECT,
// so a MQTT 5 and a MQTT 3.1.1 client can be served at the same time.
describe('MQTT server with MQTT 5 clients', function () {
    const mqtt = require('mqtt');
    let adapter: Adapter;
    let server: any;
    const states: Record<string, any> = {};
    this.timeout(20000);
    let suitePort: number;

    /**
     * Connects a real mqtt.js client with the given protocol level.
     *
     * @param clientId The client id
     * @param version The protocol level to announce
     * @returns The connected client together with the CONNACK packet
     */
    function connect(clientId: string, version: 4 | 5): Promise<{ client: any; connack: any }> {
        return new Promise((resolve, reject) => {
            const client = mqtt.connect(`mqtt://127.0.0.1:${suitePort}`, {
                protocolId: 'MQTT',
                protocolVersion: version,
                clientId,
                clean: true,
                reconnectPeriod: 0,
                connectTimeout: 5000,
            });
            const timer = setTimeout(() => reject(new Error(`${clientId} did not connect`)), 8000);
            client.on('connect', (connack: any) => {
                clearTimeout(timer);
                resolve({ client, connack });
            });
            client.on('error', (e: Error) => {
                clearTimeout(timer);
                reject(e);
            });
        });
    }

    const open: any[] = [];
    async function connectTracked(clientId: string, version: 4 | 5): Promise<{ client: any; connack: any }> {
        const c = await connect(clientId, version);
        open.push(c.client);
        return c;
    }

    function wait(ms: number): Promise<void> {
        return new Promise<void>(resolve => setTimeout(resolve, ms));
    }

    before('MQTT server (MQTT 5): Start server', async () => {
        suitePort = ++port;
        adapter = new Adapter({
            port: suitePort,
            defaultQoS: 0,
            onchange: true,
            // "extraSet" normally lets a publisher receive its own message back, which is what
            // makes the "No Local" option observable.
            extraSet: true,
            publishOnSubscribe: true,
        });
        server = new Server(adapter, states);
        await wait(300);
    });

    after('MQTT server (MQTT 5): Stop server', done => {
        for (const client of open) {
            try {
                client.end(true);
            } catch {
                /* ignore */
            }
        }
        server.destroy(done);
    });

    it('MQTT 5: a v5 client connects and gets the announced capabilities', async () => {
        const { connack } = await connectTracked('v5caps', 5);
        const properties = connack.properties || {};

        assert.strictEqual(properties.topicAliasMaximum, 32, 'the broker must announce its topic alias maximum');
        // "Maximum QoS" must not be sent at all when it is 2 (MQTT-5.0 3.2.2.3.4)
        assert.strictEqual(properties.maximumQoS, undefined, 'maximumQoS must be omitted');
        // absent means supported (MQTT-5.0 3.2.2.3.11), the broker only announces what it lacks
        assert.strictEqual(
            properties.sharedSubscriptionAvailable,
            undefined,
            'shared subscriptions must be announced as available',
        );
    });

    it('MQTT 5: a v3.1.1 client is still served next to it', async () => {
        const { client, connack } = await connectTracked('v4next', 4);
        assert.ok(client.connected);
        assert.strictEqual(connack.properties, undefined, 'MQTT 3.1.1 has no CONNACK properties');
    });

    it('MQTT 5: a topic alias is remembered and resolved', async () => {
        const { client } = await connectTracked('v5alias', 5);

        // the first publish carries topic and alias and establishes the mapping
        await client.publishAsync('alias/deep/topic', 'first', { properties: { topicAlias: 1 } });
        await wait(300);
        // the second one refers to the alias with an empty topic name
        await client.publishAsync('', 'second', { properties: { topicAlias: 1 } });
        await wait(500);

        const state = await adapter.getForeignStateAsync('mqtt.0.alias.deep.topic');
        assert.ok(state, 'the aliased topic must have been resolved to its state');
        assert.strictEqual(state.val, 'second');
        assert.ok(client.connected, 'a valid alias must not close the connection');
    });

    it('MQTT 5: an unknown topic alias is rejected', async () => {
        const { client } = await connectTracked('v5badalias', 5);
        await client.publishAsync('', 'nope', { properties: { topicAlias: 7 } });
        await wait(600);
        assert.strictEqual(client.connected, false, 'an alias that was never established is a protocol error');
    });

    it('MQTT 5: "No Local" suppresses the own message', async () => {
        const topic = 'nolocal/on';
        const { client } = await connectTracked('v5nolocal', 5);
        const received: string[] = [];
        client.on('message', (t: string) => received.push(t));

        await client.subscribeAsync({ [topic]: { qos: 0, nl: true } });
        // let the "publish on subscribe" timer pass, it is not a forwarded message
        await wait(700);
        received.length = 0;

        await client.publishAsync(topic, 'x');
        await wait(800);

        assert.deepStrictEqual(received, [], 'a "No Local" subscriber must not get its own message back');
    });

    it('MQTT 5: without "No Local" the own message still arrives', async () => {
        const topic = 'nolocal/off';
        const { client } = await connectTracked('v5local', 5);
        const received: string[] = [];
        client.on('message', (t: string) => received.push(t));

        await client.subscribeAsync({ [topic]: { qos: 0 } });
        await wait(700);
        received.length = 0;

        await client.publishAsync(topic, 'y');
        await wait(800);

        assert.ok(received.includes(topic), 'without "No Local" extraSet sends the message back');
    });

    it('MQTT 5: "Retain Handling" 2 skips the stored value, 0 delivers it', async () => {
        const id = 'mqtt.0.rh.known';
        states[id] = { val: 'stored', ack: true };
        await adapter.setForeignObjectAsync(id, {
            type: 'state',
            common: { name: 'known', type: 'string', read: true, write: true, role: 'variable' },
            native: { topic: 'rh/known' },
        });
        await adapter.setForeignStateAsync(id, 'stored');

        const skipped: string[] = [];
        const { client: rh2 } = await connectTracked('v5rh2', 5);
        rh2.on('message', (t: string) => skipped.push(t));
        await rh2.subscribeAsync({ 'rh/known': { qos: 0, rh: 2 } });
        await wait(800);
        assert.deepStrictEqual(skipped, [], 'Retain Handling 2 must not deliver the known value');

        const delivered: string[] = [];
        const { client: rh0 } = await connectTracked('v5rh0', 5);
        rh0.on('message', (t: string) => delivered.push(t));
        await rh0.subscribeAsync({ 'rh/known': { qos: 0, rh: 0 } });
        await wait(800);
        assert.ok(delivered.includes('rh/known'), 'Retain Handling 0 must still deliver the known value');
    });

    it('MQTT 5: QoS 1 and 2 are acknowledged and unsubscribe answers with reason codes', async () => {
        const { client } = await connectTracked('v5qos', 5);

        await client.subscribeAsync({ 'v5qos/a': { qos: 2 }, 'v5qos/b': { qos: 1 } });
        // every publish resolves only after its PUBACK / PUBCOMP arrived
        await client.publishAsync('v5qos/a', 'q1', { qos: 1 });
        await client.publishAsync('v5qos/a', 'q2', { qos: 2 });
        await wait(400);

        // UNSUBACK carries one reason code per topic in MQTT 5; a wrong count would desynchronise
        // the stream and the following operations would hang
        await client.unsubscribeAsync(['v5qos/a', 'v5qos/b']);
        await wait(200);
        assert.ok(client.connected, 'the connection must survive a multi topic UNSUBACK');

        const state = await adapter.getForeignStateAsync('mqtt.0.v5qos.a');
        assert.ok(state, 'the QoS 2 message must have been stored');
        assert.strictEqual(state.val, 'q2');
    });
});

// "Retain As Published" (MQTT-5.0 3.8.3.1) decides the RETAIN flag of a forwarded message, and
// MQTT 5 separates that from the retained delivery a subscription triggers. MQTT 3.1.1 clients are
// not affected at all and keep the behaviour the adapter always had.
describe('MQTT server: Retain As Published', function () {
    const mqtt = require('mqtt');
    let adapter: Adapter;
    let server: any;
    const states: Record<string, any> = {};
    this.timeout(20000);
    let suitePort: number;
    const open: any[] = [];

    function wait(ms: number): Promise<void> {
        return new Promise<void>(resolve => setTimeout(resolve, ms));
    }

    /**
     * Connects a real mqtt.js client and remembers it for the cleanup.
     *
     * @param clientId The client id
     * @param version The protocol level to announce
     * @returns The connected client
     */
    function connect(clientId: string, version: 4 | 5): Promise<any> {
        return new Promise((resolve, reject) => {
            const client = mqtt.connect(`mqtt://127.0.0.1:${suitePort}`, {
                protocolId: 'MQTT',
                protocolVersion: version,
                clientId,
                clean: true,
                reconnectPeriod: 0,
                connectTimeout: 5000,
            });
            open.push(client);
            const timer = setTimeout(() => reject(new Error(`${clientId} did not connect`)), 8000);
            client.on('connect', () => {
                clearTimeout(timer);
                resolve(client);
            });
            client.on('error', (e: Error) => {
                clearTimeout(timer);
                reject(e);
            });
        });
    }

    /**
     * Records topic and RETAIN flag of everything a client receives.
     *
     * @param client The receiving client
     * @returns The (growing) list of received messages
     */
    function collect(client: any): { topic: string; retain: boolean }[] {
        const seen: { topic: string; retain: boolean }[] = [];
        client.on('message', (topic: string, _payload: Buffer, packet: any) =>
            seen.push({ topic, retain: !!packet.retain }),
        );
        return seen;
    }

    before('MQTT server (rap): Start server', async () => {
        suitePort = ++port;
        adapter = new Adapter({ port: suitePort, defaultQoS: 0, onchange: true, publishOnSubscribe: true });
        server = new Server(adapter, states);
        await wait(300);
    });

    after('MQTT server (rap): Stop server', done => {
        for (const client of open) {
            try {
                client.end(true);
            } catch {
                /* ignore */
            }
        }
        server.destroy(done);
    });

    it('MQTT 5: the value delivered on subscribe is retained even without "Retain As Published"', async () => {
        const id = 'mqtt.0.rap.known';
        states[id] = { val: 'stored', ack: true };
        await adapter.setForeignObjectAsync(id, {
            type: 'state',
            common: { name: 'known', type: 'string', read: true, write: true, role: 'variable' },
            native: { topic: 'rap/known' },
        });
        await adapter.setForeignStateAsync(id, 'stored');

        const client = await connect('rapRetained', 5);
        const seen = collect(client);
        await client.subscribeAsync({ 'rap/known': { qos: 0, rap: false } });
        await wait(900);

        const message = seen.find(m => m.topic === 'rap/known');
        assert.ok(message, 'the known value must be delivered');
        assert.strictEqual(message.retain, true, 'retained delivery always carries RETAIN 1');
    });

    it('MQTT 5: a forwarded message without "Retain As Published" has RETAIN 0', async () => {
        const subscriber = await connect('rapOff', 5);
        const seen = collect(subscriber);
        await subscriber.subscribeAsync({ 'rap/live': { qos: 0, rap: false } });
        // let the publish-on-subscribe timer pass, it is not a forwarded message
        await wait(700);
        seen.length = 0;

        const publisher = await connect('rapPublisher1', 5);
        await publisher.publishAsync('rap/live', 'v', { retain: true });
        await wait(900);

        const message = seen.find(m => m.topic === 'rap/live');
        assert.ok(message, 'the message must be forwarded');
        assert.strictEqual(message.retain, false, 'without rap the forwarded message must not be retained');
    });

    it('MQTT 5: a forwarded message with "Retain As Published" keeps the published flag', async () => {
        const subscriber = await connect('rapOn', 5);
        const seen = collect(subscriber);
        await subscriber.subscribeAsync({ 'rap/live2': { qos: 0, rap: true } });
        await wait(700);
        seen.length = 0;

        const publisher = await connect('rapPublisher2', 5);
        await publisher.publishAsync('rap/live2', 'v', { retain: true });
        await wait(900);

        const message = seen.find(m => m.topic === 'rap/live2');
        assert.ok(message, 'the message must be forwarded');
        assert.strictEqual(message.retain, true, 'with rap the published flag is kept');
    });

    it('MQTT 3.1.1: the flag of the publisher is passed through as before', async () => {
        const subscriber = await connect('rapV4', 4);
        const seen = collect(subscriber);
        await subscriber.subscribeAsync('rap/v4a');
        await subscriber.subscribeAsync('rap/v4b');
        await wait(700);
        seen.length = 0;

        const publisher = await connect('rapPublisher3', 4);
        await publisher.publishAsync('rap/v4a', 'v', { retain: false });
        await publisher.publishAsync('rap/v4b', 'v', { retain: true });
        await wait(900);

        const plain = seen.find(m => m.topic === 'rap/v4a');
        const retained = seen.find(m => m.topic === 'rap/v4b');
        assert.ok(plain && retained, 'both messages must be forwarded');
        assert.strictEqual(plain.retain, false, 'MQTT 3.1.1 must not be touched by the MQTT 5 rules');
        assert.strictEqual(retained.retain, true, 'MQTT 3.1.1 must not be touched by the MQTT 5 rules');
    });
});

// The smaller MQTT 5 features: subscription identifiers, message expiry, will delay,
// maximum packet size and receive maximum.
describe('MQTT server: the smaller MQTT 5 features', function () {
    const mqtt = require('mqtt');
    let adapter: Adapter;
    let server: any;
    const states: Record<string, any> = {};
    this.timeout(30000);
    let suitePort: number;
    const open: any[] = [];

    function wait(ms: number): Promise<void> {
        return new Promise<void>(resolve => setTimeout(resolve, ms));
    }

    /**
     * Connects a real mqtt.js client and remembers it for the cleanup.
     *
     * @param clientId The client id
     * @param version The protocol level to announce
     * @param options Extra connection options, e.g. a will or MQTT 5 properties
     * @returns The connected client
     */
    function connect(clientId: string, version: 4 | 5, options?: Record<string, any>): Promise<any> {
        return new Promise((resolve, reject) => {
            const client = mqtt.connect(`mqtt://127.0.0.1:${suitePort}`, {
                protocolId: 'MQTT',
                protocolVersion: version,
                clientId,
                clean: true,
                reconnectPeriod: 0,
                connectTimeout: 5000,
                ...(options || {}),
            });
            open.push(client);
            const timer = setTimeout(() => reject(new Error(`${clientId} did not connect`)), 8000);
            client.on('connect', () => {
                clearTimeout(timer);
                resolve(client);
            });
            client.on('error', (e: Error) => {
                clearTimeout(timer);
                reject(e);
            });
        });
    }

    /**
     * Records topic and MQTT 5 properties of everything a client receives.
     *
     * @param client The receiving client
     * @returns The (growing) list of received messages
     */
    function collect(client: any): { topic: string; properties?: any; length: number }[] {
        const seen: { topic: string; properties?: any; length: number }[] = [];
        client.on('message', (topic: string, payload: Buffer, packet: any) =>
            seen.push({ topic, properties: packet.properties, length: payload.length }),
        );
        return seen;
    }

    let publisher: any;

    before('MQTT server (MQTT 5 extras): Start server', async () => {
        suitePort = ++port;
        adapter = new Adapter({ port: suitePort, defaultQoS: 0, onchange: true, publishOnSubscribe: true });
        server = new Server(adapter, states);
        await wait(300);
        publisher = await connect('extrasPublisher', 5);
    });

    after('MQTT server (MQTT 5 extras): Stop server', done => {
        for (const client of open) {
            try {
                client.end(true);
            } catch {
                /* ignore */
            }
        }
        server.destroy(done);
    });

    it('MQTT 5: the subscription identifier is echoed on a forwarded message', async () => {
        const subscriber = await connect('extrasSubId', 5);
        const seen = collect(subscriber);
        await subscriber.subscribeAsync({ 'subid/topic': { qos: 0 } }, { properties: { subscriptionIdentifier: 77 } });
        await wait(600);
        seen.length = 0;

        await publisher.publishAsync('subid/topic', 'v');
        await wait(800);

        const message = seen.find(m => m.topic === 'subid/topic');
        assert.ok(message, 'the message must be forwarded');
        assert.strictEqual(message.properties?.subscriptionIdentifier, 77);
    });

    it('MQTT 3.1.1: a forwarded message carries no properties', async () => {
        const subscriber = await connect('extrasSubIdV4', 4);
        const seen = collect(subscriber);
        await subscriber.subscribeAsync('subid/v4');
        await wait(600);
        seen.length = 0;

        await publisher.publishAsync('subid/v4', 'v');
        await wait(800);

        const message = seen.find(m => m.topic === 'subid/v4');
        assert.ok(message, 'the message must be forwarded');
        assert.strictEqual(message.properties, undefined, 'MQTT 3.1.1 has no properties');
    });

    it('MQTT 5: an expired value is not delivered on subscribe', async () => {
        await publisher.publishAsync('expiry/short', 'gone', { properties: { messageExpiryInterval: 1 } });
        // wait until the announced lifetime has passed
        await wait(1600);

        const subscriber = await connect('extrasExpired', 5);
        const seen = collect(subscriber);
        await subscriber.subscribeAsync({ 'expiry/short': { qos: 0 } });
        await wait(900);

        assert.ok(
            !seen.some(m => m.topic === 'expiry/short'),
            'a value whose message expiry interval has passed must not be handed out',
        );
    });

    it('MQTT 5: a living value is delivered with its remaining lifetime', async () => {
        await publisher.publishAsync('expiry/long', 'here', { properties: { messageExpiryInterval: 120 } });
        await wait(400);

        const subscriber = await connect('extrasAlive', 5);
        const seen = collect(subscriber);
        await subscriber.subscribeAsync({ 'expiry/long': { qos: 0 } });
        await wait(900);

        const message = seen.find(m => m.topic === 'expiry/long');
        assert.ok(message, 'the value must still be delivered');
        const remaining = message.properties?.messageExpiryInterval;
        assert.ok(remaining > 0 && remaining <= 120, `the remaining lifetime must be sent along, got ${remaining}`);
    });

    it('MQTT 5: the will is held back until its delay passed', async () => {
        const topic = 'will/delayed';
        const watcher = await connect('extrasWillWatcher', 5);
        const seen = collect(watcher);
        await watcher.subscribeAsync({ [topic]: { qos: 0 } });
        await wait(500);
        seen.length = 0;

        const dying = await connect('extrasWillDying', 5, {
            will: { topic, payload: 'bye', qos: 0, retain: false, properties: { willDelayInterval: 2 } },
            properties: { sessionExpiryInterval: 60 },
        });
        await wait(400);
        // a hard drop, not a clean DISCONNECT, so the will applies
        dying.stream.destroy();

        await wait(900);
        assert.ok(!seen.some(m => m.topic === topic), 'the will must not be published before its delay passed');

        await wait(2200);
        assert.ok(
            seen.some(m => m.topic === topic),
            'the will must be published once the delay passed',
        );
    });

    it('MQTT 5: a message above the announced maximum packet size is dropped', async () => {
        const subscriber = await connect('extrasSmall', 5, { properties: { maximumPacketSize: 200 } });
        const seen = collect(subscriber);
        await subscriber.subscribeAsync({ 'size/#': { qos: 0 } });
        await wait(600);
        seen.length = 0;

        await publisher.publishAsync('size/small', 'x'.repeat(20));
        await publisher.publishAsync('size/big', 'y'.repeat(4000));
        await wait(900);

        assert.ok(
            seen.some(m => m.topic === 'size/small'),
            'a message below the limit must still arrive',
        );
        assert.ok(!seen.some(m => m.topic === 'size/big'), 'a message above the limit must not be sent');
        assert.ok(subscriber.connected, 'dropping it must not break the connection');
    });

    it('MQTT 5: "Receive Maximum" limits how many QoS 1 messages are in flight', async () => {
        const subscriber = await connect('extrasSlow', 5, { properties: { receiveMaximum: 1 } });
        const seen = collect(subscriber);

        // never acknowledge anything, so the single slot stays occupied
        const sendPacket = subscriber._sendPacket.bind(subscriber);
        subscriber._sendPacket = (packet: any, cb: any, cbStorePut: any) => {
            if (packet.cmd === 'puback') {
                cb?.();
                return;
            }
            return sendPacket(packet, cb, cbStorePut);
        };

        await subscriber.subscribeAsync({ 'flow/#': { qos: 1 } });
        await wait(600);
        seen.length = 0;

        await publisher.publishAsync('flow/a', '1', { qos: 1 });
        await wait(400);
        await publisher.publishAsync('flow/b', '2', { qos: 1 });
        await wait(900);

        assert.strictEqual(
            seen.length,
            1,
            `only one message may be in flight, got ${JSON.stringify(seen.map(m => m.topic))}`,
        );
    });
});

// MQTT 5 shared subscriptions (MQTT-5.0 4.8.2): every message matching the filter goes to exactly
// one member of the group, while normal subscriptions and other groups are unaffected.
describe('MQTT server: shared subscriptions', function () {
    const mqtt = require('mqtt');
    let adapter: Adapter;
    let server: any;
    const states: Record<string, any> = {};
    this.timeout(30000);
    let suitePort: number;
    const open: any[] = [];
    let publisher: any;

    function wait(ms: number): Promise<void> {
        return new Promise<void>(resolve => setTimeout(resolve, ms));
    }

    /**
     * Connects a real mqtt.js client and remembers it for the cleanup.
     *
     * @param clientId The client id
     * @returns The connected client
     */
    function connect(clientId: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const client = mqtt.connect(`mqtt://127.0.0.1:${suitePort}`, {
                protocolId: 'MQTT',
                protocolVersion: 5,
                clientId,
                clean: true,
                reconnectPeriod: 0,
                connectTimeout: 5000,
            });
            open.push(client);
            const timer = setTimeout(() => reject(new Error(`${clientId} did not connect`)), 8000);
            client.on('connect', () => {
                clearTimeout(timer);
                resolve(client);
            });
            client.on('error', (e: Error) => {
                clearTimeout(timer);
                reject(e);
            });
        });
    }

    /**
     * Records the topics a client receives.
     *
     * @param client The receiving client
     * @returns The (growing) list of received topics
     */
    function collect(client: any): string[] {
        const seen: string[] = [];
        client.on('message', (topic: string) => seen.push(topic));
        return seen;
    }

    before('MQTT server (shared): Start server', async () => {
        suitePort = ++port;
        adapter = new Adapter({ port: suitePort, defaultQoS: 0, onchange: true, publishOnSubscribe: true });
        server = new Server(adapter, states);
        await wait(300);
        publisher = await connect('sharePublisher');
    });

    after('MQTT server (shared): Stop server', done => {
        for (const client of open) {
            try {
                client.end(true);
            } catch {
                /* ignore */
            }
        }
        server.destroy(done);
    });

    it('a group splits the messages, each one delivered exactly once', async () => {
        const a = await connect('shareA');
        const b = await connect('shareB');
        const seenA = collect(a);
        const seenB = collect(b);

        await a.subscribeAsync({ '$share/grp/share/work': { qos: 0 } });
        await b.subscribeAsync({ '$share/grp/share/work': { qos: 0 } });
        await wait(600);
        seenA.length = 0;
        seenB.length = 0;

        for (let i = 0; i < 6; i++) {
            await publisher.publishAsync('share/work', `m${i}`);
            await wait(220);
        }
        await wait(700);

        assert.strictEqual(seenA.length + seenB.length, 6, 'every message must be delivered exactly once');
        assert.ok(seenA.length > 0 && seenB.length > 0, 'both members must get a share');
    });

    it('a normal subscription is not affected by the group', async () => {
        const a = await connect('shareNormalA');
        const b = await connect('shareNormalB');
        const plain = await connect('sharePlain');
        const seenA = collect(a);
        const seenB = collect(b);
        const seenPlain = collect(plain);

        await a.subscribeAsync({ '$share/grp2/share/mixed': { qos: 0 } });
        await b.subscribeAsync({ '$share/grp2/share/mixed': { qos: 0 } });
        await plain.subscribeAsync({ 'share/mixed': { qos: 0 } });
        await wait(600);
        seenA.length = 0;
        seenB.length = 0;
        seenPlain.length = 0;

        await publisher.publishAsync('share/mixed', 'x');
        await wait(800);

        assert.strictEqual(seenPlain.length, 1, 'the normal subscriber must get the message');
        assert.strictEqual(seenA.length + seenB.length, 1, 'the group must get it exactly once');
    });

    it('two groups each receive their own copy', async () => {
        const a = await connect('shareTwoA');
        const b = await connect('shareTwoB');
        const seenA = collect(a);
        const seenB = collect(b);

        await a.subscribeAsync({ '$share/left/share/two': { qos: 0 } });
        await b.subscribeAsync({ '$share/right/share/two': { qos: 0 } });
        await wait(600);
        seenA.length = 0;
        seenB.length = 0;

        await publisher.publishAsync('share/two', 'x');
        await wait(800);

        assert.strictEqual(seenA.length, 1, 'the first group must get a copy');
        assert.strictEqual(seenB.length, 1, 'the second group must get its own copy');
    });

    it('unsubscribing leaves the group', async () => {
        const a = await connect('shareLeaveA');
        const b = await connect('shareLeaveB');
        const seenA = collect(a);
        const seenB = collect(b);

        await a.subscribeAsync({ '$share/grp3/share/leave': { qos: 0 } });
        await b.subscribeAsync({ '$share/grp3/share/leave': { qos: 0 } });
        await wait(600);

        await b.unsubscribeAsync('$share/grp3/share/leave');
        await wait(500);
        seenA.length = 0;
        seenB.length = 0;

        for (let i = 0; i < 4; i++) {
            await publisher.publishAsync('share/leave', `n${i}`);
            await wait(200);
        }
        await wait(700);

        assert.strictEqual(seenB.length, 0, 'the client that left must not get anything any more');
        assert.strictEqual(seenA.length, 4, 'the remaining member must get everything');
    });

    it('a shared subscribe does not deliver the stored value', async () => {
        const id = 'mqtt.0.share.known';
        states[id] = { val: 'stored', ack: true };
        await adapter.setForeignObjectAsync(id, {
            type: 'state',
            common: { name: 'known', type: 'string', read: true, write: true, role: 'variable' },
            native: { topic: 'share/known' },
        });
        await adapter.setForeignStateAsync(id, 'stored');

        const client = await connect('shareRetained');
        const seen = collect(client);
        await client.subscribeAsync({ '$share/grp4/share/known': { qos: 0 } });
        await wait(900);

        assert.deepStrictEqual(seen, [], 'a shared subscription must not get the value on subscribe');
    });

    it('"No Local" on a shared subscription is a protocol error', async () => {
        const client = await connect('shareNoLocal');
        client.subscribe({ '$share/grp5/share/nl': { qos: 0, nl: true } }, () => {
            /* the broker closes the connection instead of answering */
        });
        await wait(900);

        assert.strictEqual(client.connected, false, 'the connection must be closed');
    });
});

// MQTT 5 enhanced authentication (MQTT-5.0 4.12) with SCRAM-SHA-256: the password never travels
// over the wire, both sides prove to each other that they know it.
describe('MQTT server: enhanced authentication', function () {
    const net = require('node:net');
    const crypto = require('node:crypto');
    const Connection = require('../build/lib/MqttConnection').default;
    let adapter: Adapter;
    let server: any;
    const states: Record<string, any> = {};
    this.timeout(30000);
    let suitePort: number;

    const USER = 'user';
    const PASS = 'pass!?#1';

    const hmac = (key: Buffer, data: string): Buffer => crypto.createHmac('sha256', key).update(data).digest();
    const sha256 = (data: Buffer): Buffer => crypto.createHash('sha256').update(data).digest();
    const xor = (a: Buffer, b: Buffer): Buffer => Buffer.from(a.map((value: number, i: number) => value ^ b[i]));

    /**
     * A SCRAM-SHA-256 client, written from the RFC rather than reusing the server code.
     *
     * @param username The user name to authenticate as
     * @param password The password to prove
     * @returns The first message, the final message builder and the expected server signature
     */
    function scramClient(
        username: string,
        password: string,
    ): { first: Buffer; final: (serverFirst: Buffer) => Buffer; serverSignature: () => string } {
        const gs2 = 'n,,';
        const clientFirstBare = `n=${username},r=${crypto.randomBytes(18).toString('base64')}`;
        let expected = '';
        return {
            first: Buffer.from(gs2 + clientFirstBare, 'utf8'),
            final(serverFirstBuffer: Buffer): Buffer {
                const serverFirst = serverFirstBuffer.toString('utf8');
                const attrs: Record<string, string> = {};
                for (const part of serverFirst.split(',')) {
                    attrs[part[0]] = part.substring(2);
                }
                const salted = crypto.pbkdf2Sync(
                    Buffer.from(password, 'utf8'),
                    Buffer.from(attrs.s, 'base64'),
                    parseInt(attrs.i, 10),
                    32,
                    'sha256',
                );
                const clientKey = hmac(salted, 'Client Key');
                const withoutProof = `c=${Buffer.from(gs2).toString('base64')},r=${attrs.r}`;
                const authMessage = `${clientFirstBare},${serverFirst},${withoutProof}`;
                const proof = xor(clientKey, hmac(sha256(clientKey), authMessage));
                expected = hmac(hmac(salted, 'Server Key'), authMessage).toString('base64');
                return Buffer.from(`${withoutProof},p=${proof.toString('base64')}`, 'utf8');
            },
            serverSignature: () => expected,
        };
    }

    /**
     * Runs a complete CONNECT + AUTH exchange against the broker.
     *
     * @param clientId The client id
     * @param username The user name to authenticate as
     * @param password The password to prove
     * @param method The authentication method to announce
     * @returns What the broker answered
     */
    function authenticate(
        clientId: string,
        username: string,
        password: string,
        method = 'SCRAM-SHA-256',
    ): Promise<{ reasonCode: number | null; serverVerified: boolean }> {
        return new Promise(resolve => {
            const stream = net.createConnection(suitePort, '127.0.0.1');
            const connection = new Connection(stream);
            const scram = scramClient(username, password);
            const result: { reasonCode: number | null; serverVerified: boolean } = {
                reasonCode: null,
                serverVerified: false,
            };
            let done = false;
            const finish = (): void => {
                if (!done) {
                    done = true;
                    try {
                        stream.destroy();
                    } catch {
                        /* ignore */
                    }
                    resolve(result);
                }
            };

            stream.on('connect', () =>
                connection.connect({
                    clientId,
                    protocolId: 'MQTT',
                    protocolVersion: 5,
                    clean: true,
                    keepalive: 0,
                    properties: { authenticationMethod: method, authenticationData: scram.first },
                }),
            );

            connection.on('auth', (packet: any) => {
                try {
                    connection.auth({
                        reasonCode: 0x18,
                        properties: {
                            authenticationMethod: method,
                            authenticationData: scram.final(packet.properties.authenticationData),
                        },
                    });
                } catch {
                    finish();
                }
            });

            connection.on('connack', (packet: any) => {
                result.reasonCode = packet.reasonCode;
                const data = packet.properties?.authenticationData;
                if (data && scram.serverSignature()) {
                    result.serverVerified = data.toString('utf8') === `v=${scram.serverSignature()}`;
                }
                setTimeout(finish, 150);
            });

            connection.on('close', finish);
            stream.on('error', finish);
            setTimeout(finish, 8000);
        });
    }

    before('MQTT server (auth): Start server', done => {
        suitePort = ++port;
        adapter = new Adapter({ port: suitePort, defaultQoS: 0, user: USER, pass: PASS });
        server = new Server(adapter, states);
        setTimeout(done, 300);
    });

    after('MQTT server (auth): Stop server', done => {
        server.destroy(done);
    });

    it('accepts the correct credentials and proves itself in return', async () => {
        const result = await authenticate('scramGood', USER, PASS);
        assert.strictEqual(result.reasonCode, 0, 'the connection must be accepted');
        assert.ok(result.serverVerified, 'the CONNACK must carry a valid server-final message');
    });

    it('rejects a wrong password with "not authorized"', async () => {
        const result = await authenticate('scramBadPassword', USER, 'wrong');
        assert.strictEqual(result.reasonCode, 0x87);
    });

    it('rejects a wrong user name the same way', async () => {
        const result = await authenticate('scramBadUser', 'nobody', PASS);
        assert.strictEqual(result.reasonCode, 0x87, 'a wrong user must not be distinguishable from a wrong password');
    });

    it('answers an unsupported method with "bad authentication method"', async () => {
        const result = await authenticate('scramBadMethod', USER, PASS, 'SCRAM-SHA-1');
        assert.strictEqual(result.reasonCode, 0x8c);
    });

    it('still accepts a plain MQTT 3.1.1 login', done => {
        const stream = net.createConnection(suitePort, '127.0.0.1');
        const connection = new Connection(stream);
        let finished = false;
        const finish = (err?: any): void => {
            if (!finished) {
                finished = true;
                try {
                    stream.destroy();
                } catch {
                    /* ignore */
                }
                done(err);
            }
        };

        stream.on('connect', () =>
            connection.connect({
                clientId: 'plainLogin',
                protocolId: 'MQTT',
                protocolVersion: 4,
                clean: true,
                keepalive: 0,
                username: USER,
                password: Buffer.from(PASS),
            }),
        );
        connection.on('connack', (packet: any) => {
            try {
                assert.strictEqual(packet.returnCode, 0, 'username and password must keep working');
                finish();
            } catch (e) {
                finish(e);
            }
        });
        stream.on('error', finish);
        setTimeout(() => finish(new Error('no CONNACK')), 8000);
    });

    it('rejects a plain login with a wrong password', done => {
        const stream = net.createConnection(suitePort, '127.0.0.1');
        const connection = new Connection(stream);
        let finished = false;
        const finish = (err?: any): void => {
            if (!finished) {
                finished = true;
                try {
                    stream.destroy();
                } catch {
                    /* ignore */
                }
                done(err);
            }
        };

        stream.on('connect', () =>
            connection.connect({
                clientId: 'plainWrong',
                protocolId: 'MQTT',
                protocolVersion: 4,
                clean: true,
                keepalive: 0,
                username: USER,
                password: Buffer.from('nope'),
            }),
        );
        connection.on('connack', (packet: any) => {
            try {
                // the rejection has to reach the client, not be cut off by the closing socket
                assert.strictEqual(packet.returnCode, 4, 'bad user name or password');
                finish();
            } catch (e) {
                finish(e);
            }
        });
        stream.on('error', finish);
        setTimeout(() => finish(new Error('no CONNACK')), 8000);
    });
});
