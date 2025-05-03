'use strict';
const mqtt = require('mqtt-connection');

function Server(config) {
    const clients = {};
    let server;
    let net;
    let http;
    let ws;
    let wsStream;
    let serverForWs;
    let serverWs;

    config = config || {};

    function startServer(socket, server, port, bind, ssl, ws) {
        socket.on('connection', stream => {
            let client;
            if (ws) {
                client = mqtt(wsStream(stream));
            } else {
                client = mqtt(stream);
            }

            client.on('connect', packet => {
                client.id = packet.clientId;
                clients[client.id] = client;
                if (config.user) {
                    if (config.user !== packet.username || config.pass !== packet.password.toString()) {
                        console.error(
                            `Client [${packet.clientId}] has invalid password(${(packet.password || '').length} chars) or username(${packet.username})`,
                        );
                        client.connack({ returnCode: 4 });
                        if (clients[client.id]) {
                            delete clients[client.id];
                        }
                        client.stream.end();
                        return;
                    }
                }
                console.log(
                    `Client [${packet.clientId}] connected: user - ${packet.username}, pass - ${(packet.password || '').length} chars`,
                );
                client.connack({ returnCode: 0 });

                if (!config.dontSend) {
                    client.publish({ topic: 'testServer/connected', payload: 'true' });
                    client.publish({ topic: 'testServer/long/test/path/into/ioBroker/connected', payload: 'true' });
                }
            });

            client.on('publish', packet => {
                console.log(`Client [${client.id}] publishes "${packet.topic}": ${packet.payload}`);
                for (const k in clients) {
                    clients[k].publish({ topic: packet.topic, payload: packet.payload });
                }
            });

            client.on('subscribe', packet => {
                const granted = [];
                console.log(`Client [${client.id}] subscribes on "${JSON.stringify(packet.subscriptions)}"`);
                for (let i = 0; i < packet.subscriptions.length; i++) {
                    granted.push(packet.subscriptions[i].qos);
                }
                client.suback({ granted, messageId: packet.messageId });
            });

            client.on('pingreq', packet => {
                console.log(`Client [${client.id}] pingreq`);
                client.pingresp();
            });

            client.on('disconnect', packet => {
                if (clients[client.id]) delete clients[client.id];
                console.log(`Client [${client.id}] disconnected`);
                client.stream.end();
            });

            client.on('close', err => {
                if (clients[client.id]) {
                    delete clients[client.id];
                }
                console.log(`Client [${client.id}] closed`);
            });

            client.on('error', err => {
                if (clients[client.id]) {
                    delete clients[client.id];
                }
                console.log(`[${client.id}] ${err}`);
                client.stream.end();
            });
        });

        (server || socket).listen(port, bind, () =>
            console.log(`Starting MQTT${!ws ? '' : '-WebSocket'}${ssl ? ' (Secure)' : ''} server on port ${port}`),
        );
    }

    const port = config.port || 1883;
    const sslOptions = {
        key: '-----BEGIN RSA PRIVATE KEY-----\r\nMIICXQIBAAKBgQDQ6dVCuqpl0hdECy35tQP7n/FKAK6Yz8z04F3g8NtkLrJ3IR1+\r\nNo0ijLE2Ka5ONZV2WlRzybWomAvOGnfbSH7NG/wkQ9saBb15bAU03RLeyFmDc5Rz\r\newgjoQzJwXNWIIbqdiUWUqhy3IOzfoRrNprpDm5mv2pwEUxOuF8mB62vgQIDAQAB\r\nAoGBAKmS5DQB6IY1fgURPgROVilMrkJvQ0luguLRq+IGH062SM5B5vqntO+yW7Wn\r\nJ4D8JZGnyJ0jwXxTzmFBQsCPm7vQ3VkH1ir4JhlIWJ11Z3p3XMNWNJ5mrDAyEupn\r\nShCFQxW9EDL7efVFztqgyiWw5/uxV4AJQyBgtsF4PijmgT8xAkEA+SlmVXcuzIPy\r\nZTfNXRCWHvzZM9EaRVQXNSYqMHXLRx412gw42ihk/+GIYaw7y5ObjlMosfzzCyot\r\naMMA/KT1TwJBANalpnrDE0BhYuv/ccnxJv/pZ6aJZ4P/gyRV02UUc0WTAGnxU4el\r\nJPtREWCyCjaVq26S7fh4DGotcDhDEkpzei8CQA5aGyHrJo/zPcAk0bh9nxgT2nMI\r\npWm+6UNPenimIFptXA6+S3wNfZvbot51bFBSpVAybBKsjldjS5BQQztKSTMCQQCe\r\nMhYBkjZlE6Fhh7GogOgaYj53GfvF6BISPIMBk1HlrBL5AdhrN4aLBtOE7ZLjaemg\r\nI//pSSj1NCnp/VzErFkXAkA/6q2Th8M4Z2LzL46GeRavLXFd1IQmFULWZAkx5afk\r\n8/anbz31nnA9CFu+oR/jTp7urYsIUQ3y6ksJwGGKHVlQ\r\n-----END RSA PRIVATE KEY-----\r\n',
        cert: '-----BEGIN CERTIFICATE-----\r\nMIICfzCCAegCCQC1y0d8DNip4TANBgkqhkiG9w0BAQUFADCBgzELMAkGA1UEBhMC\r\nREUxGTAXBgNVBAgMEEJhZGVuV3VlcnRlbWJlcmcxEjAQBgNVBAcMCUthcmxzcnVo\r\nZTERMA8GA1UECgwIaW9Ccm9rZXIxEDAOBgNVBAMMB0JsdWVmb3gxIDAeBgkqhkiG\r\n9w0BCQEWEWRvZ2Fmb3hAZ21haWwuY29tMB4XDTE1MDQyMjIwMjgwM1oXDTE2MDQy\r\nMTIwMjgwM1owgYMxCzAJBgNVBAYTAkRFMRkwFwYDVQQIDBBCYWRlbld1ZXJ0ZW1i\r\nZXJnMRIwEAYDVQQHDAlLYXJsc3J1aGUxETAPBgNVBAoMCGlvQnJva2VyMRAwDgYD\r\nVQQDDAdCbHVlZm94MSAwHgYJKoZIhvcNAQkBFhFkb2dhZm94QGdtYWlsLmNvbTCB\r\nnzANBgkqhkiG9w0BAQEFAAOBjQAwgYkCgYEA0OnVQrqqZdIXRAst+bUD+5/xSgCu\r\nmM/M9OBd4PDbZC6ydyEdfjaNIoyxNimuTjWVdlpUc8m1qJgLzhp320h+zRv8JEPb\r\nGgW9eWwFNN0S3shZg3OUc3sII6EMycFzViCG6nYlFlKoctyDs36Eazaa6Q5uZr9q\r\ncBFMTrhfJgetr4ECAwEAATANBgkqhkiG9w0BAQUFAAOBgQBgp4dhA9HulN7/rh4H\r\n+e+hAYqjWvFpdNqwcWAyopBig9B9WL3OIkzpgTuBmH76JxzJCuZJkjO4HLGzQ3KF\r\nsFU0lvqqoz9osgYmXe1K0fBjIcm/RFazGTHVxv+UgVqQ3KldrlkvR3T2VIRlT5hI\r\n0Y1m6J3YZDMF7D6uc1jrsYHkMQ==\r\n-----END CERTIFICATE-----\r\n',
    };

    this.start = function () {
        if (process.argv[2] === 'ssl') {
            net = net || require('tls');
            if (config.webSocket) {
                http = http || require('https');
            }
        } else {
            net = net || require('net');
            if (config.webSocket) {
                http = http || require('http');
            }
        }
        server = new net.Server(sslOptions);
        startServer(server, null, port, '127.0.0.1', process.argv[2] === 'ssl', false);
        http = http || require('https');
        ws = ws || require('ws');
        wsStream = wsStream || require('websocket-stream');
        serverForWs = http.createServer(sslOptions);
        serverWs = new ws.Server({ server: serverForWs });

        startServer(serverWs, serverForWs, port + 1, '127.0.0.1', process.argv[2] === 'ssl', true);
    };

    this.stop = function (cb) {
        // destroy all clients (this will emit the 'close' event above)
        for (const i in clients) {
            clients[i].destroy();
        }

        if (server) {
            server.close(() => {
                console.log('Server closed.');
                server.unref();
                server = null;
                cb && cb();
            });
        }

        if (serverForWs) {
            serverForWs.close(() => {
                console.log('WS-Server closed.');
                serverForWs.unref();
                serverForWs = null;
            });
        }
    };

    this.start();

    return this;
}

if (typeof module !== 'undefined' && module.parent) {
    module.exports = Server;
} else {
    new Server();
}
