var mqtt    = require('mqtt');
var client  = mqtt.connect('mqtt://localhost');

client.on('connect', function () {
    client.publish('testMessage3', 'Roger');

    client.subscribe('testMessage3');
});

client.on('message', function (topic, message) {
    // message is Buffer
    console.log(topic + ': ' + message.toString());
});
