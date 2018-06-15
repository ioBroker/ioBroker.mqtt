'use strict';

module.exports = function (config) {
    this.namespace = 'mqtt.0';

    this.config = {
        prefix: '',
        sendInterval: 100,
        publishOnSubscribe: false,
        sendOnStartInterval: false,
        defaultQoS: 1,
        extraSet: false,
        debug: true,
        onchange: false,
        port: 1883,
        ssl: false,
        webSocket: false,
        certificates: null,
    };
    let objects = {};
    let states = {};

    this.config = Object.assign(this.config, config || {});

    this.log = {
        silly: text => console.log(`[${new Date().toISOString()} ${text}`),
        debug: text => console.log(`[${new Date().toISOString()} ${text}`),
        info: text => console.log(`[${new Date().toISOString()} ${text}`),
        warn: text => console.warn(`[${new Date().toISOString()} ${text}`),
        error: text => console.error(`[${new Date().toISOString()} ${text}`)
    };

    this.setState = (id, state, ack, cb) => {
        if (!id.startsWith(this.namespace + '.')) {
            id = this.namespace + '.' + id;
        }
        return this.setForeignState(id, state, ack, cb);
    };

    this.setForeignState = (id, state, ack, cb) => {
        if (typeof ack === 'function') {
            cb = ack;
            ack = undefined;
        }

        if (typeof state !== 'object') {
            state = {
                val: state,
                ack: ack || false
            }
        }
        state.ts = Date.now();
        state.ack = !!state.ack;

        states[id] = state;
        cb && cb(null);
    };

    this.getObject = (id, cb) => {
        if (!id.startsWith(this.namespace + '.')) {
            id = this.namespace + '.' + id;
        }
        return this.getForeignObject(id, cb);
    };

    this.setObject = (id, obj, cb) => {
        if (!id.startsWith(this.namespace + '.')) {
            id = this.namespace + '.' + id;
        }
        return this.setForeignObject(id, obj, cb);
    };

    this.getForeignObject = (id, cb) => {
        cb(null, objects[id]);
    };

    this.setForeignObject = (id, obj, cb) => {
        objects[id] = obj;
        cb && cb();
    };

    this.clearAll = () => {
        objects = {};
        states = {};
    };
    return this;
};