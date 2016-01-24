var mqtt    = require('mqtt');
var client  = mqtt.connect('mqtt://localhost');

function Client(cb) {
    this.client = client;

    client.on('connect', function () {
        console.log((new Date()) + ' test client connected to localhost');

        /*client.publish('test/out/testMessage1', 'Roger1');
         client.publish('test/out/testMessage2', 'Roger2');
         client.publish('test/in/testMessage3',  'Roger3');
         client.publish('test/in/testMessage4',  'Roger4');*/

        /*client.publish('arduino/kitchen/out/temperature',  '10.1');
         client.publish('arduino/kitchen/out/humidity',  '56');
         // Current light state
         client.publish('arduino/kitchen/in/lightActor',  'false');

         client.subscribe('arduino/kitchen/in/#');*/
        //client.subscribe('arduino/kitchen/in/updateInterval');
        client.subscribe('#');
    });

    client.on('message', function (topic, message) {
        // message is Buffer
        console.log((new Date()) + ' ' + topic + ': ' + message.toString());
        if (cb) cb(topic, message);
    });

    this.publish = function (topic, message) {
        client.publish(topic,  message);
    };

    this.destroy = function () {
        if (client) {
            client.end();
            client = null;
        }
    };

    return this;
}

module.exports = Client;