'use strict';

var createStreamServer  = require('create-stream-server');
var mqtt                = require('mqtt-connection');

function Server(config) {
    var that = this;
    var clients = {};
    var server;
    config = config || {};

    var cltFunction = function (client) {

        client.on('connect', function (packet) {
            client.id = packet.clientId;
            clients[client.id] = client;
            if (config.user) {
                if (config.user !== packet.username ||
                    config.pass !== packet.password.toString()) {
                    console.error('Client [' + packet.clientId + '] has invalid password(' + packet.password + ') or username(' + packet.username + ')');
                    client.connack({returnCode: 4});
                    if (clients[client.id]) delete clients[client.id];
                    client.stream.end();
                    return;
                }
            }
            console.log('Client [' + packet.clientId + '] connected: user - ' + packet.username + ', pass - ' + packet.password);
            client.connack({returnCode: 0});

            client.publish({topic: 'testServer/connected', payload: 'true'});
        });

        client.on('publish', function (packet) {
            console.log('Client [' + client.id + '] publishes "' + packet.topic + '": ' + packet.payload);
            for (var k in clients) {
                clients[k].publish({topic: packet.topic, payload: packet.payload});
            }
        });

        client.on('subscribe', function (packet) {
            var granted = [];
            console.log('Client [' + client.id + '] subscribes on "' + JSON.stringify(packet.subscriptions) + '"');
            for (var i = 0; i < packet.subscriptions.length; i++) {
                granted.push(packet.subscriptions[i].qos);
            }
            client.suback({granted: granted, messageId: packet.messageId});
        });

        client.on('pingreq', function (packet) {
            console.log('Client [' + client.id + '] pingreq');
            client.pingresp();
        });

        client.on('disconnect', function (packet) {
            if (clients[client.id]) delete clients[client.id];
            console.log('Client [' + client.id + '] disconnected');
            client.stream.end();
        });

        client.on('close', function (err) {
            if (clients[client.id]) delete clients[client.id];
            console.log('Client [' + client.id + '] closed');
        });

        client.on('error', function (err) {
            if (clients[client.id]) delete clients[client.id];
            console.log('[' + client.id + '] ' + err);
            client.stream.end();
        });
    };

    var serverConfig = {};
    var port = 1883;

    if (process.argv[2] == 'ssl') {
        serverConfig.mqtts  = 'ssl://0.0.0.0:' + (port || 1883);
        serverConfig.mqtwss = 'wss://0.0.0.0:' + ((port || 1883) + 1);
    } else {
        serverConfig.mqtts  = 'tcp://0.0.0.0:' + (port || 1883);
        serverConfig.mqtwss = 'ws://0.0.0.0:'  + ((port || 1883) + 1);
    }

    var options = {
        ssl: {
            key:  "-----BEGIN RSA PRIVATE KEY-----\r\nMIICXQIBAAKBgQDQ6dVCuqpl0hdECy35tQP7n/FKAK6Yz8z04F3g8NtkLrJ3IR1+\r\nNo0ijLE2Ka5ONZV2WlRzybWomAvOGnfbSH7NG/wkQ9saBb15bAU03RLeyFmDc5Rz\r\newgjoQzJwXNWIIbqdiUWUqhy3IOzfoRrNprpDm5mv2pwEUxOuF8mB62vgQIDAQAB\r\nAoGBAKmS5DQB6IY1fgURPgROVilMrkJvQ0luguLRq+IGH062SM5B5vqntO+yW7Wn\r\nJ4D8JZGnyJ0jwXxTzmFBQsCPm7vQ3VkH1ir4JhlIWJ11Z3p3XMNWNJ5mrDAyEupn\r\nShCFQxW9EDL7efVFztqgyiWw5/uxV4AJQyBgtsF4PijmgT8xAkEA+SlmVXcuzIPy\r\nZTfNXRCWHvzZM9EaRVQXNSYqMHXLRx412gw42ihk/+GIYaw7y5ObjlMosfzzCyot\r\naMMA/KT1TwJBANalpnrDE0BhYuv/ccnxJv/pZ6aJZ4P/gyRV02UUc0WTAGnxU4el\r\nJPtREWCyCjaVq26S7fh4DGotcDhDEkpzei8CQA5aGyHrJo/zPcAk0bh9nxgT2nMI\r\npWm+6UNPenimIFptXA6+S3wNfZvbot51bFBSpVAybBKsjldjS5BQQztKSTMCQQCe\r\nMhYBkjZlE6Fhh7GogOgaYj53GfvF6BISPIMBk1HlrBL5AdhrN4aLBtOE7ZLjaemg\r\nI//pSSj1NCnp/VzErFkXAkA/6q2Th8M4Z2LzL46GeRavLXFd1IQmFULWZAkx5afk\r\n8/anbz31nnA9CFu+oR/jTp7urYsIUQ3y6ksJwGGKHVlQ\r\n-----END RSA PRIVATE KEY-----\r\n",
            cert: "-----BEGIN CERTIFICATE-----\r\nMIICfzCCAegCCQC1y0d8DNip4TANBgkqhkiG9w0BAQUFADCBgzELMAkGA1UEBhMC\r\nREUxGTAXBgNVBAgMEEJhZGVuV3VlcnRlbWJlcmcxEjAQBgNVBAcMCUthcmxzcnVo\r\nZTERMA8GA1UECgwIaW9Ccm9rZXIxEDAOBgNVBAMMB0JsdWVmb3gxIDAeBgkqhkiG\r\n9w0BCQEWEWRvZ2Fmb3hAZ21haWwuY29tMB4XDTE1MDQyMjIwMjgwM1oXDTE2MDQy\r\nMTIwMjgwM1owgYMxCzAJBgNVBAYTAkRFMRkwFwYDVQQIDBBCYWRlbld1ZXJ0ZW1i\r\nZXJnMRIwEAYDVQQHDAlLYXJsc3J1aGUxETAPBgNVBAoMCGlvQnJva2VyMRAwDgYD\r\nVQQDDAdCbHVlZm94MSAwHgYJKoZIhvcNAQkBFhFkb2dhZm94QGdtYWlsLmNvbTCB\r\nnzANBgkqhkiG9w0BAQEFAAOBjQAwgYkCgYEA0OnVQrqqZdIXRAst+bUD+5/xSgCu\r\nmM/M9OBd4PDbZC6ydyEdfjaNIoyxNimuTjWVdlpUc8m1qJgLzhp320h+zRv8JEPb\r\nGgW9eWwFNN0S3shZg3OUc3sII6EMycFzViCG6nYlFlKoctyDs36Eazaa6Q5uZr9q\r\ncBFMTrhfJgetr4ECAwEAATANBgkqhkiG9w0BAQUFAAOBgQBgp4dhA9HulN7/rh4H\r\n+e+hAYqjWvFpdNqwcWAyopBig9B9WL3OIkzpgTuBmH76JxzJCuZJkjO4HLGzQ3KF\r\nsFU0lvqqoz9osgYmXe1K0fBjIcm/RFazGTHVxv+UgVqQ3KldrlkvR3T2VIRlT5hI\r\n0Y1m6J3YZDMF7D6uc1jrsYHkMQ==\r\n-----END CERTIFICATE-----\r\n"
        },
        emitEvents: true // default
    };

    this.start = function () {
        server = createStreamServer(serverConfig, options, function (clientStream) {
            cltFunction(mqtt(clientStream, {
                notData: !options.emitEvents
            }));
        });

        // to start
        server.listen(function () {
            if (process.argv[2] == 'ssl') {
                console.log('Starting MQTT (Secure) ' + ' server on port ' + (port || 1883));
                console.log('Starting MQTT-WebSocket (Secure) ' + ' server on port ' + ((port || 1883) + 1));
            } else {
                console.log('Starting MQTT ' + ' server on port ' + (port || 1883));
                console.log('Starting MQTT-WebSocket ' + ' server on port ' + ((port || 1883) + 1));
            }
        });
    };

    this.stop = function () {
        server.destroy();
        server = null;
    };

    this.start();

    return this;
}

if (typeof module !== 'undefined' && module.parent) {
    module.exports = Server;
} else {
    new Server();
}
