import assert from 'node:assert';
import MqttClient from './lib/mqttClient';

// @iobroker/legacy-testing ships no type declarations, so it is loaded untyped.
const setup = require('@iobroker/legacy-testing');

let objects: any = null;
let states: any = null;
let mqttClientEmitter: MqttClient;
let mqttClientDetector: MqttClient;
let connected: boolean | string = false;
let lastReceivedTopic1: string | null = null;
let lastReceivedMessage1: string | null = null;
let lastReceivedTopic2: string | null = null;
let lastReceivedMessage2: string | null = null;

let clientConnected1 = false;
let clientConnected2 = false;
let brokerStarted = false;

const rules: Record<string, string> = {
    '/mqtt/0/test1': 'mqtt.0.test1',
    'mqtt/0/test2': 'mqtt.0.test2',
    test3: 'mqtt.0.test3',
    'te s t4': 'mqtt.0.te_s_t4',
    'testAdapter/0/testChannel/testState': 'testAdapter.0.testChannel.testState',
    '/testAdapter/0/testChannel/testState': 'testAdapter.0.testChannel.testState',
};

function startClients(_done?: Mocha.Done | null): void {
    // Start a client to emit topics
    mqttClientEmitter = new MqttClient(
        connected => {
            // on connected
            if (connected) {
                console.log('Test MQTT Emitter is connected to MQTT broker');
                clientConnected1 = true;
                if (_done && brokerStarted && clientConnected1 && clientConnected2) {
                    _done();
                    _done = null;
                }
            }
        },
        (topic, message) => {
            console.log(`${Date.now()} emitter received ${topic}: ${message.toString()}`);
            // on receiving
            lastReceivedTopic1 = topic;
            lastReceivedMessage1 = message ? message.toString() : null;
        },
        { name: 'Emitter', user: 'user', pass: 'pass!?#1' },
    );

    // Start a client to receive topics
    mqttClientDetector = new MqttClient(
        connected => {
            // on connected
            if (connected) {
                console.log('Test MQTT Detector is connected to MQTT broker');
                clientConnected2 = true;
                if (_done && brokerStarted && clientConnected1 && clientConnected2) {
                    _done();
                    _done = null;
                }
            }
        },
        (topic, message) => {
            console.log(`${Date.now()} detector received ${topic}: ${message.toString()}`);
            // on receiving
            lastReceivedTopic2 = topic;
            lastReceivedMessage2 = message ? message.toString() : null;
            console.log(JSON.stringify(lastReceivedMessage2));
        },
        { name: 'Detector', user: 'user', pass: 'pass!?#1' },
    );
}

function checkMqtt2Adapter(id: string, _expectedId: string, _it: Mocha.Context, _done: Mocha.Done): void {
    _it.timeout(1000);
    const value = `Roger${Math.round(Math.random() * 100)}`;
    const mqttid = id;
    if (!_expectedId) {
        id = id.replace(/\//g, '.').replace(/\s/g, '_');
        if (id[0] === '.') {
            id = id.substring(1);
        }
    } else {
        id = _expectedId;
    }

    if (!id.includes('.')) {
        id = `mqtt.0.${id}`;
    }

    lastReceivedMessage1 = null;
    lastReceivedTopic1 = null;
    lastReceivedTopic2 = null;
    lastReceivedMessage2 = null;

    mqttClientEmitter.publish(mqttid, value, (err?: Error) => {
        assert.strictEqual(err, undefined);

        setTimeout(() => {
            /*assert.strictEqual(lastReceivedTopic2, mqttid);
             assert.strictEqual(lastReceivedMessage2, value);*/

            objects.getObject(id, (err: Error | null, obj: ioBroker.Object | null) => {
                assert.ok(obj != null);
                assert.strictEqual(obj._id, id);
                assert.strictEqual(obj.type, 'state');

                if (mqttid.includes('mqtt')) {
                    assert.strictEqual(obj.native.topic, mqttid);
                }

                states.getState(id, (err: Error | null, state: ioBroker.State | null) => {
                    assert.ok(state != null);
                    assert.strictEqual(state.val, value);
                    assert.strictEqual(state.ack, true);
                    _done();
                });
            });
        }, 100);
    });
}

function checkAdapter2Mqtt(id: string, mqttid: string, _it: Mocha.Context, _done: Mocha.Done): void {
    const value = `NewRoger${Math.round(Math.random() * 100)}`;
    _it.timeout(5000);

    console.log(`${new Date().getTime()} Send ${id} with value ${value}`);

    lastReceivedTopic1 = null;
    lastReceivedMessage1 = null;
    lastReceivedTopic2 = null;
    lastReceivedMessage2 = null;

    states.setState(
        id,
        {
            val: value,
            ack: false,
        },
        () => {
            setTimeout(() => {
                if (!lastReceivedTopic1) {
                    setTimeout(() => {
                        assert.strictEqual(lastReceivedTopic1, mqttid);
                        assert.strictEqual(lastReceivedMessage1, value);
                        _done();
                    }, 200);
                } else {
                    assert.strictEqual(lastReceivedTopic1, mqttid);
                    assert.strictEqual(lastReceivedMessage1, value);
                    _done();
                }
            }, 200);
        },
    );
}

function checkConnection(value: boolean, done: (error?: string) => void, counter?: number): void {
    counter ||= 0;
    if (counter > 60) {
        done(`Cannot check ${value}`);
        return;
    }

    states.getState('mqtt.0.info.connection', (err: Error | null, state: ioBroker.State | null) => {
        if (err) {
            console.error(err);
        }
        const val = state?.val;
        if (typeof val === 'string' && ((value && val.includes(',')) || (!value && !val.includes(',')))) {
            connected = value;
            done();
        } else {
            setTimeout(() => checkConnection(value, done, counter + 1), 1000);
        }
    });
}

function encrypt(key: string, value: string): string {
    let result = '';
    for (let i = 0; i < value.length; ++i) {
        result += String.fromCharCode(key[i % key.length].charCodeAt(0) ^ value.charCodeAt(i));
    }
    return result;
}

describe('MQTT server: Test mqtt server', () => {
    before('MQTT server: Start js-controller', function (done) {
        this.timeout(600000); // because of the first installation from npm
        let _done: Mocha.Done | null = done;
        setup.adapterStarted = false;

        setup.setupController(async (systemConfig: { native: { secret: string } }) => {
            const config = await setup.getAdapterConfig();
            // enable adapter
            config.common.enabled = true;
            config.common.loglevel = 'debug';
            config.native.publish = 'mqtt.0.*';
            config.native.type = 'server';
            config.native.user = 'user';
            config.native.pass = encrypt(systemConfig.native.secret, 'pass!?#1');
            await setup.setAdapterConfig(config.common, config.native);

            setup.startController((_objects: any, _states: any) => {
                objects = _objects;
                states = _states;
                brokerStarted = true;
                objects.setObject(
                    'testAdapter.0.testChannel.testState',
                    { type: 'state', common: { type: 'string' }, native: {} },
                    () => {
                        if (_done && brokerStarted && clientConnected1 && clientConnected2) {
                            _done();
                            _done = null;
                        }
                    },
                );
            });
        });

        startClients(_done);
    });

    it('MQTT server: Check if connected to MQTT broker', done => {
        if (!connected) {
            checkConnection(true, done);
        } else {
            done();
        }
    }).timeout(2000);

    for (const r in rules) {
        (function (id: string, topic: string) {
            it(`MQTT server: Check receive ${id}`, function (done) {
                // let FUNCTION here
                checkMqtt2Adapter(id, topic, this, done);
            });
        })(r, rules[r]);
    }

    // give time to a client to receive all messages
    it('wait', done => {
        setTimeout(() => done(), 2000);
    }).timeout(3000);

    for (const r in rules) {
        (function (id: string, topic: string) {
            if (topic.includes('mqtt')) {
                it(`MQTT server: Check send ${topic}`, function (done) {
                    // let FUNCTION here
                    checkAdapter2Mqtt(topic, id, this, done);
                });
            }
        })(r, rules[r]);
    }

    it('MQTT server: detector must receive /mqtt/0/test1', done => {
        const mqttid = '/mqtt/0/test1';
        const value = 'AABB';
        mqttClientEmitter.publish(mqttid, JSON.stringify({ val: value, ack: false }), (err?: Error) => {
            assert.strictEqual(err, undefined);

            setTimeout(() => {
                assert.strictEqual(lastReceivedTopic2, mqttid);
                assert.strictEqual(lastReceivedMessage2, value);
                done();
            }, 100);
        });
    });

    it('MQTT server: check reconnection', done => {
        mqttClientEmitter.stop();
        mqttClientDetector.stop();
        checkConnection(false, error => {
            assert.ok(!error);
            startClients();
            checkConnection(true, error => {
                assert.ok(!error);
                done();
            });
        });
    }).timeout(70000);

    after('MQTT server: Stop js-controller', function (done) {
        this.timeout(10000);
        mqttClientEmitter.stop();
        mqttClientDetector.stop();
        setup.stopController(() => setTimeout(done, 4000));
    });
});
