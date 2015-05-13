var mqtt    = require('mqtt');
var client  = mqtt.connect('mqtt://localhost');

client.on('connect', function () {
    console.log((new Date()) + ' connected to localhost');

    client.publish('test/out/testMessage1', 'Roger1');
    client.publish('test/out/testMessage2', 'Roger2');
    client.publish('test/in/testMessage3', 'Roger3');
    client.publish('test/in/testMessage4', 'Roger4');

    client.subscribe('test/in/+');

});

client.on('message', function (topic, message) {
    // message is Buffer
    console.log((new Date()) + ' ' + topic + ': ' + message.toString());
});
