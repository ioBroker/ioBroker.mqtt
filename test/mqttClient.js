var mqtt    = require('mqtt');
var client  = mqtt.connect('mqtt://localhost');

client.on('connect', function () {
    client.subscribe('test/in/+');

    client.publish('test/out/testMessage1', 'Roger1');
    client.publish('test/out/testMessage2', 'Roger2');
    client.publish('test/in/testMessage3', 'Roger3');
    client.publish('test/in/testMessage4', 'Roger4');

});

client.on('message', function (topic, message) {
    // message is Buffer
    console.log(topic + ': ' + message.toString());
});
