var expect = require('chai').expect;
var setup  = require(__dirname + '/lib/setup');

var objects = null;
var states  = null;
var mqttClient = null;

var connected = false;

function checkConnection(done) {
    states.getForeignState('system.adapter.mqtt.0.connected', function (err, state) {
        if (err) console.error(err);
        if (state.val) {
            done();
        } else {
            setTimeout(function () {
                checkConnection(done);
            }, 1000);
        }
    });
}

describe('Test mqtt client', function() {
    before('Start js-controller', function (_done) {
        this.timeout(600000);
        var clientConnected = false;
        var brokerStarted   = false;

        setup.setupController(function () {
            var config = setup.getAdapterConfig();
            // enable adapter
            config.common.enabled  = true;
            config.common.loglevel = 'debug';
            config.native.publish  = 'mqtt.0.*';
            setup.setAdapterConfig(config.common, config.native);

            setup.startController(function () {
                var Objects = require(__dirname + '/lib/objects');
                var States  = require(__dirname + '/lib/states');
                objects = new Objects(function (error) {
                    expect(error).to.be.undefined;

                    states = new States(function (error) {
                        expect(error).to.be.undefined;
                        states.subscribeForeignStates('*');
                    }, function (id, state) {
                        if (id == 'mqtt.0.testServer.connected' && state.val) {
                            connected = true;
                        }

                        console.log('New state "' + id + '":' + JSON.stringify(state));
                        brokerStarted = true;
                        if (_done && brokerStarted && clientConnected) {
                            console.log('Everything OK!');
                            _done();
                            _done = null;
                        }
                    });
                });
            });
        });

        // start mqtt server
        var mqttServer = require(__dirname + '/lib/mqttServer.js');
        var MqttClient = require(__dirname + '/lib/mqttClient.js');

        // Start client to emit topics
        mqttClient = new MqttClient(function () {

        }, function () {
            console.log('Connected!!!');
            clientConnected = true;
            if (_done && brokerStarted && clientConnected) {
                console.log('Everything OK!!');
                _done();
                _done = null;
            }
        });
    });

    it('Check if connected to MQTT broker', function (done) {
        this.timeout(5000);
        if (!connected) {
            checkConnection(done);
        } else {
            done();
        }
    });

    it('Must receive topics', function (done) {
        this.timeout(5000);
        console.log('SEND!!!');
        var id = '/mqtt/0/test' + Math.round(Math.random() * 100);
        mqttClient.publish(id, 'Roger');
        id = id.replace(/\//g, '.').substring(1);

        setTimeout(function () {
            objects.getForeignObject(id, function (err, obj) {
                expect(obj).to.be.not.null;
                expect(obj._id).to.be.equal(id);
                states.getForeignState(id, function (err, state) {
                    expect(state).to.be.not.null;
                    expect(state.val).to.be.equal('Roger');
                    expect(state.ack).to.be.true;
                    done();
                });
            });
        }, 1000);
    });

    after('Stop js-controller', function (done) {
        this.timeout(5000);
        setup.stopController(function () {
            done();
        });
    });
});