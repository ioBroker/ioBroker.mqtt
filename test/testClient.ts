import assert from 'node:assert';
import MqttServer from './lib/mqttServer';
import MqttClient from './lib/mqttClient';

// @iobroker/legacy-testing ships no type declarations, so it is loaded untyped.
const setup = require('@iobroker/legacy-testing');

let objects: any = null;
let states: any = null;
let mqttClient: MqttClient;
let mqttServer: MqttServer;
let connected: boolean | string = false;
let lastReceivedTopic: string | null = null;
let lastReceivedMessage: string | null = null;

const rules: Record<string, string> = {
    '/mqtt/0/test1': 'mqtt.0.test1',
    'mqtt/0/test2': 'mqtt.0.test2',
    test3: 'mqtt.0.test3',
    'te s t4': 'mqtt.0.te_s_t4',
    'testAdapter/0/testChannel/testState': 'testAdapter.0.testChannel.testState',
    '/testAdapter/0/testChannel/testState': 'testAdapter.0.testChannel.testState',
};

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

    mqttClient.publish(mqttid, value);

    setTimeout(() => {
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
    }, 500);
}

function checkAdapter2Mqtt(id: string, mqttid: string, _it: Mocha.Context, _done: Mocha.Done): void {
    const value = `NewRoger${Math.round(Math.random() * 100)}`;
    _it.timeout(5000);

    console.log(`Send ${id}`);

    states.setState(
        id,
        {
            val: value,
            ack: false,
        },
        () => {
            setTimeout(() => {
                assert.strictEqual(lastReceivedTopic, mqttid);
                assert.strictEqual(lastReceivedMessage, value);
                _done();
            }, 200);
        },
    );
}

function checkConnectionOfAdapter(cb?: (error?: string) => void, counter?: number): void {
    counter ||= 0;
    if (counter > 20) {
        cb?.('Cannot check connection');
        return;
    }

    states.getState('system.adapter.mqtt.0.connected', (err: Error | null, state: ioBroker.State | null) => {
        if (err) {
            console.error(err);
        }
        if (state?.val) {
            connected = state.val as boolean | string;
            cb?.();
        } else {
            setTimeout(() => checkConnectionOfAdapter(cb, counter + 1), 500);
        }
    });
}

function checkConnectionToServer(value: boolean, cb?: (error?: string) => void, counter?: number): void {
    counter ||= 0;
    if (counter > 60) {
        cb?.(`Cannot check connection to server for ${value}`);
        return;
    }

    states.getState('mqtt.0.info.connection', (err: Error | null, state: ioBroker.State | null) => {
        if (err) {
            console.error(err);
        }
        if (state?.val == value) {
            connected = state.val as boolean | string;
            cb?.();
        } else {
            setTimeout(() => checkConnectionToServer(value, cb, counter + 1), 1000);
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

describe('Test MQTT client', function () {
    before('MQTT client: Start js-controller', function (done) {
        // let FUNCTION and not => here
        this.timeout(600000); // because of the first installation from npm
        let _done: Mocha.Done | null = done;
        let clientConnected = false;
        let brokerStarted = false;
        setup.adapterStarted = false;

        setup.setupController(async (systemConfig: { native: { secret: string } }) => {
            const config = await setup.getAdapterConfig();
            // enable adapter
            config.common.enabled = true;
            config.common.loglevel = 'debug';
            config.native.publish = 'mqtt.0.*';
            config.native.user = 'user';
            config.native.pass = encrypt(systemConfig.native.secret, 'pass!?#1');
            config.native.debug = true;
            await setup.setAdapterConfig(config.common, config.native);

            setup.startController((_objects: any, _states: any) => {
                objects = _objects;
                states = _states;
                brokerStarted = true;
                objects.setObject(
                    'testAdapter.0.testChannel.testState',
                    { type: 'state', common: { type: 'string' }, native: {} },
                    () => {
                        if (_done && clientConnected) {
                            _done();
                            _done = null;
                        }
                    },
                );
            });
        });

        // start mqtt server
        mqttServer = new MqttServer({ user: 'user', pass: 'pass!?#1' });

        // Start a client to emit topics
        mqttClient = new MqttClient(
            () => {
                // on connected
                //console.log('Test MQTT Client is connected to MQTT broker');
                clientConnected = true;
                if (_done && brokerStarted && clientConnected) {
                    _done();
                    _done = null;
                }
            },
            (topic, message) => {
                console.log(`${new Date().getTime()} emitter received ${topic}: ${message.toString()}`);
                // console.log('Test MQTT Client received "' + topic + '": ' + message);
                // on receiving
                lastReceivedTopic = topic;
                lastReceivedMessage = message ? message.toString() : null;
            },
            { name: 'Emitter', user: 'user', pass: 'pass!?#1' },
        );
    });

    it('MQTT client: Check if connected to MQTT broker', done => {
        if (!connected) {
            checkConnectionOfAdapter(done);
        } else {
            done();
        }
    }).timeout(3000);

    it('MQTT client: wait', done => {
        setTimeout(() => done(), 1000);
    }).timeout(4000);

    it('MQTT client: check folder objects', done => {
        objects.getObject('mqtt.0.testServer', (err: Error | null, obj: ioBroker.Object | null) => {
            assert.ok(!err);
            assert.ok(obj);
            assert.strictEqual(obj.type, 'folder');
            objects.getObject(
                'mqtt.0.testServer.long.test.path.into.ioBroker',
                (err: Error | null, obj: ioBroker.Object | null) => {
                    assert.ok(!err);
                    assert.ok(obj);
                    assert.strictEqual(obj.type, 'folder');
                    objects.getObject(
                        'mqtt.0.testServer.long.test.path.into.ioBroker.connected',
                        (err: Error | null, obj: ioBroker.Object | null) => {
                            assert.ok(!err);
                            assert.ok(obj);
                            assert.strictEqual(obj.type, 'state');
                            states.getState(
                                'mqtt.0.testServer.long.test.path.into.ioBroker.connected',
                                (err: Error | null, state: ioBroker.State | null) => {
                                    assert.ok(!err);
                                    assert.ok(state);
                                    assert.strictEqual(state.val, true);
                                    done();
                                },
                            );
                        },
                    );
                },
            );
        });
    }).timeout(4000);

    for (const rr in rules) {
        (function (id: string, topic: string) {
            it(`MQTT client: Check receive ${id}`, function (done) {
                // let FUNCTION here
                checkMqtt2Adapter(id, topic, this, done);
            });
        })(rr, rules[rr]);
    }

    for (const r in rules) {
        (function (id: string, topic: string) {
            if (topic.indexOf('mqtt') !== -1) {
                it(`MQTT client: Check send ${topic}`, function (done) {
                    // let FUNCTION here
                    checkAdapter2Mqtt(topic, id, this, done);
                });
            }
        })(r, rules[r]);
    }

    it('MQTT client: check reconnect if server is down', done => {
        mqttServer.stop();
        connected = false;
        console.log(`MQTT server stop ${Date.now()}`);

        checkConnectionToServer(false, error => {
            assert.ok(!error);
            mqttServer = new MqttServer();
            checkConnectionToServer(true, error => {
                assert.ok(!error);
                done();
            });
        });
    }).timeout(70000);

    after('MQTT client: Stop js-controller', function (_done) {
        // let FUNCTION and not => here
        this.timeout(10000);
        mqttServer.stop();
        mqttClient.stop();

        setup.stopController((normalTerminated: boolean) => {
            console.log(`Adapter normal terminated: ${normalTerminated}`);
            setTimeout(_done, 4000);
        });
    });
});
