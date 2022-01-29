'use strict';
const expect  = require('chai').expect;
const setup   = require(__dirname + '/lib/setup');

let objects = null;
let states  = null;
let MqttServer;
let mqttClient = null;
let mqttServer = null;
let connected  = false;
let lastReceivedTopic;
let lastReceivedMessage;

const rules = {
    '/mqtt/0/test1': 'mqtt.0.test1',
    'mqtt/0/test2':  'mqtt.0.test2',
    'test3':         'mqtt.0.test3',
    'te s t4':       'mqtt.0.te_s_t4',
    'testAdapter/0/testChannel/testState':  'testAdapter.0.testChannel.testState',
    '/testAdapter/0/testChannel/testState': 'testAdapter.0.testChannel.testState'
};

function checkMqtt2Adapter(id, _expectedId, _it, _done) {
    _it.timeout(1000);
    const value = 'Roger' + Math.round(Math.random() * 100);
    const mqttid = id;
    if (!_expectedId) {
        id = id.replace(/\//g, '.').replace(/\s/g, '_');
        if (id[0] === '.') id = id.substring(1);
    } else {
        id = _expectedId;
    }
    if (id.indexOf('.') === -1) id = 'mqtt.0.' + id;

    mqttClient.publish(mqttid, value);

    setTimeout(() => {
        objects.getObject(id, (err, obj) => {
            expect(obj).to.be.not.null.and.not.undefined;
            expect(obj._id).to.be.equal(id);
            expect(obj.type).to.be.equal('state');

            if (mqttid.indexOf('mqtt') !== -1) {
                expect(obj.native.topic).to.be.equal(mqttid);
            }

            states.getState(id, (err, state) => {
                expect(state).to.be.not.null.and.not.undefined;
                expect(state.val).to.be.equal(value);
                expect(state.ack).to.be.true;
                _done();
            });
        });
    }, 500);
}

function checkAdapter2Mqtt(id, mqttid, _it, _done) {
    const value = 'NewRoger' + Math.round(Math.random() * 100);
    _it.timeout(5000);

    console.log('Send ' + id);

    states.setState(id, {
        val: value,
        ack: false
    }, function (err, id) {
        setTimeout(function () {
            expect(lastReceivedTopic).to.be.equal(mqttid);
            expect(lastReceivedMessage).to.be.equal(value);
            _done();
        }, 200);
    });
}

function checkConnectionOfAdapter(cb, counter) {
    counter = counter || 0;
    if (counter > 20) {
        cb && cb('Cannot check connection');
        return;
    }

    states.getState('system.adapter.mqtt.0.connected', (err, state) => {
        if (err) console.error(err);
        if (state && state.val) {
            connected = state.val;
            cb && cb();
        } else {
            setTimeout(function () {
                checkConnectionOfAdapter(cb, counter + 1);
            }, 500);
        }
    });
}

function checkConnectionToServer(value, cb, counter) {
    counter = counter || 0;
    if (counter > 60) {
        cb && cb('Cannot check connection to server for ' + value);
        return;
    }

    states.getState('mqtt.0.info.connection', (err, state) => {
        if (err) console.error(err);
        if (state && state.val == value) {
            connected = state.val;
            cb && cb();
        } else {
            setTimeout(function () {
                checkConnectionToServer(value, cb, counter + 1);
            }, 1000);
        }
    });
}

describe('Test MQTT client', function() {
    before('MQTT client: Start js-controller', function (_done) { // let FUNCTION and not => here
        this.timeout(600000); // because of first install from npm
        let clientConnected  = false;
        let brokerStarted    = false;
        setup.adapterStarted = false;

        setup.setupController(() => {
            const config = await setup.getAdapterConfig();
            // enable adapter
            config.common.enabled  = true;
            config.common.loglevel = 'debug';
            config.native.publish  = 'mqtt.0.*';
            config.native.user     = 'user';
            config.native.pass     = '*\u0006\u0015\u0001\u0004';
            await setup.setAdapterConfig(config.common, config.native);

            setup.startController((_objects, _states) => {
                objects = _objects;
                states  = _states;
                brokerStarted = true;
                objects.setObject('testAdapter.0.testChannel.testState', {type: 'state', common: {type: 'string'}, native: {}}, () => {
                    if (_done && clientConnected) {
                        _done();
                        _done = null;
                    }
                });
            });
        });

        // start mqtt server
        MqttServer = require(__dirname + '/lib/mqttServer.js');
        const MqttClient = require(__dirname + '/lib/mqttClient.js');

        mqttServer = new MqttServer({user: 'user', pass: 'pass1'});

        // Start client to emit topics
        mqttClient = new MqttClient(() => {
            // on connected
            //console.log('Test MQTT Client is connected to MQTT broker');
            clientConnected = true;
            if (_done && brokerStarted && clientConnected) {
                _done();
                _done = null;
            }
        }, (topic, message) => {
            console.log((new Date()).getTime() + ' emitter received ' + topic + ': ' + message.toString());
            //console.log('Test MQTT Client received "' + topic + '": ' + message);
            // on receive
            lastReceivedTopic   = topic;
            lastReceivedMessage = message ? message.toString() : null;
        }, {name: 'Emitter', user: 'user', pass: 'pass1'});
    });

    it('MQTT client: Check if connected to MQTT broker', done => {
        if (!connected) {
            checkConnectionOfAdapter(done);
        } else {
            done();
        }
    }).timeout(3000);

    it('MQTT client: wait', done => {
        setTimeout(function () {
            done();
        }, 1000);
    }).timeout(4000);

    for (const rr in rules) {
        (function(id, topic) {
            it('MQTT client: Check receive ' + id, function (done) { // let FUNCTION here
                checkMqtt2Adapter(id, topic, this, done);
            });
        })(rr, rules[rr]);
    }

    for (const r in rules) {
        (function(id, topic) {
            if (topic.indexOf('mqtt') !== -1) {
                it('MQTT client: Check send ' + topic, function (done) { // let FUNCTION here
                    checkAdapter2Mqtt(topic, id, this, done);
                });
            }
        })(r, rules[r]);
    }

    it('MQTT client: check reconnect if server is down', done => {
        mqttServer.stop();
        connected = false;
        console.log('MQTT server stop ' + Date.now());

        checkConnectionToServer(false, error => {
            expect(error).to.be.not.ok;
            mqttServer = new MqttServer();
            checkConnectionToServer(true, error => {
                expect(error).to.be.not.ok;
                done();
            });
        });
    }).timeout(70000);

    after('MQTT client: Stop js-controller', function (_done) { // let FUNCTION and not => here
        this.timeout(10000);
        mqttServer.stop();
        mqttClient.stop();

        setup.stopController(function (normalTerminated) {
            console.log('Adapter normal terminated: ' + normalTerminated);
            setTimeout(_done, 4000);
        });
    });
});
