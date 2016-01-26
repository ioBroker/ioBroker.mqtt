var mqtt    = require('mqtt');

function Client(cbConnected, cbChanged) {
    var that = this;
    this.client = mqtt.connect('mqtt://localhost');

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
        console.log((new Date()) + ' ' + topic + ': ' + message.toString());
        if (cbChanged) cbChanged(topic, message);
    });

    this.publish = function (topic, message) {
        that.client.publish(topic,  message);
    };

    this.destroy = function () {
        if (that.client) {
            that.client.end();
            that.client = null;
        }
    };

    return this;
}

if (typeof module !== 'undefined' && module.parent) {
    module.exports = Client;
} else {
    new Client();
}
