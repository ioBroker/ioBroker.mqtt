/**
 *
 *      ioBroker mqtt Adapter
 *
 *      (c) 2014 bluefox
 *
 *      MIT License
 *
 */

var mqtt =    require('mqtt');
var adapter = require(__dirname + '/../../lib/adapter.js')('mqtt');

var client = null;
var server = null;
var values = {};

function decrypt(key, value) {
    var result = "";
    for(var i = 0; i < value.length; ++i) {
        result += String.fromCharCode(key[i % key.length].charCodeAt(0) ^ value.charCodeAt(i));
    }
    return result;
}

adapter.on('message', function (obj) {
    if (obj) processMessage(obj);
    processMessages();
});

adapter.on('ready', function () {
    adapter.config.pass = decrypt("Zgfr56gFe87jJOM", adapter.config.pass);
    main();
});

adapter.on('unload', function () {
    if (client) {
        client.end();
        client = null;
    }

    if (server) {
        server.end();
        server = null;
    }
});


function processMessage(obj) {
    if (!obj || !obj.command) return;
    switch(obj.command) {
        case 'test': {
            // Try to connect to mqtt broker
            if (obj.callback && obj.message) {
                var _url = 'mqtt://' + (obj.message.user ? (obj.message.user + ':' + obj.message.pass + '@') : '') + obj.message.url + (obj.message.port ? (':' + obj.message.port) : '') + '?clientId=ioBroker.' + adapter.namespace;
                var _client = mqtt.connect(_url);
                // Set timeout for connection
                var timeout = setTimeout(function () {
                    _client.end();
                    adapter.sendTo(obj.from, obj.command, 'timeout', obj.callback);
                }, 2000);

                // If connected, return success
                _client.on('connect', function () {
                    _client.end();
                    clearTimeout(timeout);
                    adapter.sendTo(obj.from, obj.command, 'connected', obj.callback);
                });
            }
        }
    }
}

function processMessages() {
    adapter.getMessage(function (err, obj) {
        if (obj) {
            processMessage(obj.command, obj.message);
            processMessages();
        }
    });
}
function createClient (url, port, user, pass, patterns) {
    var _url = 'mqtt://' + (user ? (user + ':' + pass + '@') : '') + url + (port ? (':' + port) : '') + '?clientId=ioBroker.' + adapter.namespace;
    adapter.log.info('Try to connect to ' + _url);
    client = mqtt.connect(_url);
    if (!patterns) patterns = '#';
    if (typeof patterns == 'string') {
        patterns = patterns.split(',');
    }

    for (var i = 0; i < patterns.length; i++) {
        patterns[i] = patterns[i].trim();
        client.subscribe(patterns[i]);
    }
//    client.publish('messages', 'hello me!');
    client.on('message', function(topic, message) {
        if (!topic) return;
        if (adapter.config.debug)
            adapter.log.debug(topic + ' : ' + message);

        // Ignore message if value does not changed
        if (adapter.config.onchange) {
            var oldValue = values[topic];
            if (oldValue !== undefined && oldValue == message) {
                return;
            } else {
                values[topic] = message;
            }
        }

        topic = topic.replace(/\//g, '.');
        if (topic[0] == '.') topic = topic.substring(1);
        adapter.setState(topic.replace(/\//g, '.'), {val: message, ack: true});
    });

    client.on('connect', function () {
        adapter.log.info('Connected to ' + url);
    });
}

function main() {
    if (adapter.config.type == 'client') {
        createClient(adapter.config.url, adapter.config.port, adapter.config.user, adapter.config.pass, adapter.config.patterns);
    } else {
        //createServer();
    }
}

