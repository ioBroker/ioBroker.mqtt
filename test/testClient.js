var expect = require('chai').expect;
var setup  = require(__dirname + '/lib/setup');

var objects = null;
var states  = null;
var mqttClient = null;

var connected = false;

function checkConnection(done) {
    states.getForeignState('system.adapter.mqtt.0.connected', function (err, state) {
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
    before('Start js-controller', function (done) {
        var config = setup.getAdapterConfig();
        // enable adapter
        config.common.enabled  = true;
        config.common.loglevel = 'debug';
        setup.setAdapterConfig(config.common);

        // start mqtt server
        var mqttServer = require(__dirname + '/lib/mqttServer.js');
        var MqttClient = require(__dirname + '/lib/mqttClient.js');

        setup.startController();

        var Objects = require(__dirname + '/lib/objects');
        var States  = require(__dirname + '/lib/states');
        objects = new Objects(function (error) {
            expect(error).to.be.undefined;

            states = new States(function (error) {
                states.subscribeStates('*');

                expect(error).to.be.undefined;
            }, function (id, state) {
                if (id == 'system.adapter.mqtt.0.connected' && state.val) {
                    connected = true;
                }

                console.log('New state "' + id + '":' + JSON.stringify(state));
            });
            done();
        });

        mqttClient = new MqttClient(function () {

        });
    });

    it('Check if connected to MQTT broker', function (done) {
        if (!connected) {
            checkConnection(done);
        } else {
            done();
        }
    });

    it('Must receive topics', function (done) {
        mqttClient.publish('/mqtt/0/test');
    });


    after('Stop js-controller', function (done) {
        setup.stopController();
        done();
    });
});