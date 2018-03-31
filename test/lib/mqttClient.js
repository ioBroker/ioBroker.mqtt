const mqtt    = require('mqtt');

function Client(cbConnected, cbChanged, config) {
    let that = this;
    if (typeof config === 'string') config = {name: config};
    config = config || {};
    config.url = config.url || 'localhost';
    this.client = mqtt.connect('mqtt://' + (config.user ? (config.user + ':' + config.pass + '@') : '') + config.url  + (config.name ? '?clientId=' + config.name : ''));

    this.client.on('connect', function () {
        console.log((new Date()) + ' test client connected to localhost');

        /*that.client.publish('mqtt/0/test', 'Roger1');
        client.publish('test/out/testMessage1', 'Roger1');
         client.publish('test/out/testMessage2', 'Roger2');
         client.publish('test/in/testMessage3',  'Roger3');
         client.publish('test/in/testMessage4',  'Roger4');*/

        /*client.publish('arduino/kitchen/out/temperature',  '10.1');
         client.publish('arduino/kitchen/out/humidity',  '56');
         // Current light state
         client.publish('arduino/kitchen/in/lightActor',  'false');

         client.subscribe('arduino/kitchen/in/#');*/
        //client.subscribe('arduino/kitchen/in/updateInterval');
        that.client.subscribe('#');
        if (cbConnected) cbConnected();
    });

    this.client.on('message', function (topic, message) {
        // message is Buffer
        if (cbChanged) {
            cbChanged(topic, message);
        } else {
            console.log('Test MQTT Client received "' + topic + '": ' + message.toString());
        }
    });

    this.publish = function (topic, message, cb) {
        that.client.publish(topic,  message, cb);
    };

    this.destroy = function () {
        if (that.client) {
            that.client.end();
            that.client = null;
        }
    };

    this.stop = this.destroy;

    return this;
}

if (typeof module !== 'undefined' && module.parent) {
    module.exports = Client;
} else {
    new Client();
}
