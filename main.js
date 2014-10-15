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

adapter.on('message', function (obj) {
    if (obj && obj.command == "send") processMessage(obj.message);
    processMessages();
});

adapter.on('ready', function () {
    adapter.config.transportOptions.auth.pass = decrypt("Zgfr56gFe87jJOM", adapter.config.transportOptions.auth.pass);
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

function createClient (url, port, user, pass, patterns) {
    var _url = 'mqtt://' + (user ? (user + ':' + pass + '@') : '') + url + (port ? (':' + port) : '') + '?clientId=ioBroker.' + adapter.namespace;
    client = mqtt.connect(_url);

    for (var i = 0; i < patterns.length; i++) {
        client.subscribe(patterns[i]);
    }
//    client.publish('messages', 'hello me!');
    client.on('message', function(topic, message) {
        console.log(topic + ':' + message);
    });

    client.on('connect', function () {
        adapter.log.info('Connected to ' + url);
    });
}

function main() {
    if (adapter.config.type == 'client') {
        createClient();
    } else {
        //createServer();
    }
}

