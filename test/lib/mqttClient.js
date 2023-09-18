'use strict';
const mqtt    = require('mqtt');

function Client(cbConnected, cbChanged, config) {
    if (typeof config === 'string') config = {name: config};
    config = config || {};
    config.url = config.url || '127.0.0.1';
    if (config.user) {
        config.username = config.user;
        config.password = config.pass;
    }
    if (config.name) {
        config.clientId = config.name;
    }
    this.client = mqtt.connect(`mqtt://${config.url}`, config);

    this.client.on('connect', () => {
        if (!this.client) {
            return;
        }
        console.log(`${new Date()} Test MQTT Client ${config.clientId} connected to ${config.url}`);

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

        if (config.subscribe !== false) {
            this.client.subscribe(config.subscribe || '#');
        }

        cbConnected && cbConnected(true);
    });

    this.client.on('message', (topic, message, packet) => {
        // message is Buffer
        if (cbChanged) {
            cbChanged(topic, message, packet);
        } else {
            console.log(`Test MQTT Client ${config.clientId} received "${topic}": ${message.toString()}`);
        }
    });
    this.client.on('close', () => {
        // message is Buffer
        if (cbConnected) {
            cbConnected(false);
        } else {
            console.log(`Test MQTT Client ${config.clientId} closed`);
        }
    });

    this.client.on('error', error => {
        console.error(`Test MQTT Client ${config.clientId} error: ${error}`);
    });

    this.publish = (topic, message, qos, retain, cb) => {
        if (typeof qos === 'function') {
            cb = qos;
            qos = undefined;
        }
        if (typeof retain === 'function') {
            cb = retain;
            retain = undefined;
        }
        const opts = {
            retain: retain || false,
            qos: qos || 0
        };
        console.log(`Test MQTT Client ${config.clientId} publish "${topic}" -> "${message}" : ${JSON.stringify(opts)}`);
        this.client.publish(topic, message, opts, cb);
    };

    this.subscribe = (topic, opts, cb) => {
        if (typeof opts === 'function') {
            cb = opts;
            opts = null;
        }
        this.client.subscribe(topic, opts, cb);
    };

    this.unsubscribe = (topic, cb) => {
        this.client.unsubscribe(topic, cb);
    };

    this.destroy = () => {
        if (this.client) {
            this.client.end();
            this.client = null;
        }
    };

    this.stop = this.destroy;

    return this;
}

if (typeof module !== 'undefined' && module.parent) {
    module.exports = Client;
} else {
    new Client();
}
