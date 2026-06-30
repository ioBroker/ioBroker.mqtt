'use strict';
const assert = require('node:assert');
const Adapter = require('./lib/adapterSim');
const Server = require('../build/lib/MQTTServer').default;
const Client = require('./lib/mqttClient');

let port = 1883;

describe('MQTT server', function () {
    let adapter;
    let server;
    const states = {};
    this.timeout(3000);

    before('MQTT server: Start MQTT server', done => {
        adapter = new Adapter({
            port: ++port,
            defaultQoS: 1,
            onchange: true,
        });
        server = new Server(adapter, states);
        done();
    });

    it('MQTT server: Check if connected to MQTT broker', done => {
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
                url: '127.0.0.1:' + port,
                clientId: 'testClient1',
            },
        );
    });

    it('MQTT server: Check if subscribes stored', () => {
        let client;
        const data = 1;
        return new Promise(resolve => {
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
            new Promise(resolve => {
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
        let client;
        const data = 1;
        let count = 0;
        const id = 'aaa2';
        let allowPuback = false;
        let receiveFunc;
        new Promise(resolve => {
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
            client.client._sendPacket = function (packet, cb, cbStorePut) {
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
                    common: { type: 'number' },
                    native: {},
                    type: 'state',
                });
                await adapter.setForeignStateAsync(`mqtt.0.${id}`, data);
                server.onStateChange(`mqtt.0.${id}`, { val: data, ack: false });

                return new Promise(resolve => {
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
        let receiverClient;
        let emitterClient;
        const data = 1;
        const id = 'aaa3';
        let count = 0;
        let allowPubrec = false;
        let receiveFunc;
        new Promise(resolve => {
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
            receiverClient.client._sendPacket = function (packet, cb, cbStorePut) {
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
                return new Promise(resolve => {
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
        let receiverClient;
        let emitterClient;
        const data = 1;
        const id = 'aaa4';
        let receiveFunc;
        new Promise(resolve => {
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
            return new Promise(resolve => {
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
        let client;
        const data = 1;
        let count = 0;
        return new Promise(resolve => {
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
            return new Promise(resolve => {
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
        let emitterClient;
        const topic = 'typetestNull';
        return new Promise(resolve => {
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
            assert.strictEqual(obj.common.type, 'mixed');
            emitterClient.destroy();
        });
    }).timeout(2000);

    it('MQTT server: Existing numeric topic should keep type "number" after repeated JSON state publish', () => {
        let emitterClient;
        const topic = 'typetestNumber';
        return new Promise(resolve => {
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
            assert.strictEqual(obj.common.type, 'number');
            emitterClient.destroy();
        });
    }).timeout(3000);

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
    let adapter2;
    let server2;
    const states2 = {};
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
        const mqttCon = require('mqtt-connection');
        const stream = net.createConnection(port, '127.0.0.1');
        const client = mqttCon(stream);

        let capturedMessageId = null;
        let firstPublishSeen = false;
        let finished = false;

        const finish = err => {
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
        client.on('publish', packet => {
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
        client.on('pubrel', packet => {
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
    let adapter3;
    let server3;
    const states3 = {};

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
        const mqttCon = require('mqtt-connection');

        const CLIENT_ID = 'retryExhaustionTest';
        const TOPIC     = 'retryDisconnectTopic';
        const PAYLOAD   = 'retryPayload42';

        let phase2Started = false;

        // ── Phase 2: reconnect and expect message resend ──────────────────────
        function phase2() {
            if (phase2Started) {
                return;
            }
            phase2Started = true;

            // Small delay to let the broker fully process the close before we reconnect
            setTimeout(() => {
                const stream2 = net.createConnection(port, '127.0.0.1');
                const client2 = mqttCon(stream2);

                stream2.on('error', err => done(err));
                client2.on('error', err => done(err));

                client2.on('publish', packet => {
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
        const client1 = mqttCon(stream1);

        // Catch RST/ECONNRESET emitted when the broker destroys the connection;
        // both the raw stream and the mqtt-connection wrapper may surface it.
        stream1.on('error', () => {});
        client1.on('error', () => {});

        // Trigger phase 2 as soon as the broker closes the connection
        stream1.on('close', () => {
            clearTimeout(fallbackTimer);
            phase2();
        });
        // Fallback timer: retransmitInterval(100) × (retransmitCount(2)+2) ticks = ~400ms,
        // plus generous margin so the timer fires only if the close event is missed
        let fallbackTimer;

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
        client1.on('publish', () => { /* intentionally empty – no PUBACK */ });

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
 * retransmitCount is exceeded.  Instead it defers to the stream timeout
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
    let adapter4;
    let server4;
    const states4 = {};
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
        const mqttCon = require('mqtt-connection');

        const CLIENT_ID = 'keepaliveRetryTest';
        const TOPIC     = 'keepaliveRetryTopic';
        const PAYLOAD   = 'keepalivePayload99';

        // We need to receive at least retransmitCount+2 publish packets to be
        // certain the broker did NOT disconnect after exceeding retransmitCount.
        const REQUIRED_PUBLISHES = RETRANSMIT_COUNT + 2;
        let publishCount = 0;
        let testDone = false;

        const stream = net.createConnection(port, '127.0.0.1');
        const client = mqttCon(stream);

        stream.on('error', err => { if (!testDone) done(err); });
        client.on('error', err => { if (!testDone) done(err); });

        // If the broker disconnects us the stream closes – that would be a failure.
        stream.on('close', () => {
            if (!testDone) {
                done(new Error(`Broker disconnected client after only ${publishCount} publish(es) – expected no disconnect with keepalive>0`));
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

        client.on('publish', packet => {
            if (packet.qos !== 1) { return; }

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
    let adapter5;
    let server5;
    const states5 = {};
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
        const mqttCon = require('mqtt-connection');
        const stream = net.createConnection(port, '127.0.0.1');
        const client = mqttCon(stream);

        let finished = false;
        const finish = err => {
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
        client.on('suback', packet => {
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
