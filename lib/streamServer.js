// taken here https://github.com/mqttjs/create-stream-server/blob/master/index.js

var net           = null;//require('net');
var tls           = null;//require('tls');
var http          = null;//require('http');
var https         = null;//require('https');
var ws            = null;//require('ws');
var wsStream      = null;//require('websocket-stream');
var url           = require('url');
var async         = require('async');

function createServer(clientHandler) {
    net = net || require('net');
    return net.createServer(function (client) {
        clientHandler(client);
    });
}

function createSecureServer(sslOptions, clientHandler) {
    tls = tls || require('tls');
    return tls.createServer(sslOptions, function (client) {
        clientHandler(client);
    });
}

function attachServer(server, clientHandler) {
    ws       = ws       || require('ws');
    wsStream = wsStream || require('websocket-stream');
    var wss = new ws.Server({server: server});

    wss.on('connection', function (ws) {
        var stream = wsStream(ws);
        clientHandler(stream);
    });

    return server
}

function createWebSocketServer(clientHandler) {
    http = http || require('http');
    var server = http.createServer();
    attachServer(server, clientHandler);
    return server;
}

function createSecureWebSocketServer(sslOptions, clientHandler) {
    https = https || require('https');
    var server = https.createServer(sslOptions);
    attachServer(server, clientHandler);
    return server;
}

module.exports = function (serverConfig, sharedConfig, clientStreamHandler) {
    if (typeof sharedConfig === 'function') {
        clientStreamHandler = sharedConfig;
        sharedConfig = {};
    }

    if (typeof sharedConfig !== 'object') {
        sharedConfig = {};
    }

    var servers = {};

    Object.keys(serverConfig).forEach(function (id) {
        var config = serverConfig[id];

        if (typeof config === 'string') {
            var c = url.parse(config);
            config = {
                protocol: c.protocol.replace(/:$/, ''),
                port:     c.port,
                host:     c.hostname
            };
        }

        config.host = config.host || sharedConfig.host || 'localhost';
        config.ssl  = config.ssl || sharedConfig.ssl;

        var server;

        if (config.protocol === 'tcp') {
            server = createServer(clientStreamHandler);
        } else if (config.protocol === 'ssl') {
            server = createSecureServer(config.ssl, clientStreamHandler);
        } else if (config.protocol === 'ws') {
            server = createWebSocketServer(clientStreamHandler);
        } else if (config.protocol === 'wss') {
            server = createSecureWebSocketServer(config.ssl, clientStreamHandler);
        }

        server._css_host = config.host;
        server._css_port = config.port;

        servers[id] = server;
    });

    return {
        servers: servers,
        listen: function (callback) {
            async.mapSeries(Object.keys(servers), function (id, cb) {
                var server = servers[id];

                if (server._css_exclude) return cb();

                server.listen(server._css_port, server._css_host, function () {
                    //server.close();
                    return cb();
                });
            }, callback || function () {});
        },
        close: function (callback) {
            async.mapSeries(Object.keys(servers), function (id, cb) {
                var server = servers[id];

                if (server._css_exclude) return cb();

                server.close(cb);
            }, callback || function () {});
        },
        destroy: function (callback) {
            async.mapSeries(Object.keys(servers), function (id, cb) {
                var server = servers[id];

                if (server._css_exclude) return cb();

                server.close(cb);
            }, callback || function () {});
        }
    };
};
