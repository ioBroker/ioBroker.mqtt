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
        debug: text => console.log(`[${new Date().toISOString()} ${text}`),
        info: text => console.log(`[${new Date().toISOString()} ${text}`),
        warn: text => console.warn(`[${new Date().toISOString()} ${text}`),
        error: text => console.error(`[${new Date().toISOString()} ${text}`),
    };

    this.setState = (id, state, ack, cb) => {
        if (!id.startsWith(`${this.namespace}.`)) {
            id = `${this.namespace}.${id}`;
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
                ack: ack || false,
            };
        }
        state.ts = Date.now();
        state.ack = !!state.ack;

        states[id] = state;
        cb && cb(null);
    };

    this.getState = (id, cb) => {
        if (!id.startsWith(`${this.namespace}.`)) {
            id = `${this.namespace}.${id}`;
        }

        return this.getForeignState(id, cb);
    };

    this.getForeignState = (id, cb) => {
        cb && cb(null, states[id]);
    };

    this.getStatesAsync = pattern => {
        if (!pattern.startsWith(`${this.namespace}.`)) {
            pattern = `${this.namespace}.${pattern}`;
        }

        if (pattern.endsWith('*')) {
            pattern = pattern.substring(0, pattern.length - 1);
        }

        return new Promise(resolve => {
            const result = {};
            for (const id in states) {
                if (id.startsWith(pattern)) {
                    result[id] = states[id];
                }
            }
            resolve(result);
        });
    };

    this.getStateAsync = id => {
        return new Promise((resolve, reject) =>
            this.getState(id, (err, state) => (err ? reject(err) : resolve(state))),
        );
    };
    this.setStateAsync = (id, val, ack) => {
        return new Promise((resolve, reject) =>
            this.setState(id, val, ack, (err, state) => (err ? reject(err) : resolve(state))),
        );
    };

    this.getForeignStateAsync = id => {
        return new Promise((resolve, reject) =>
            this.getForeignState(id, (err, state) => (err ? reject(err) : resolve(state))),
        );
    };

    this.setForeignStateAsync = (id, state, ack) => {
        return new Promise((resolve, reject) =>
            this.setForeignState(id, state, ack, err => (err ? reject(err) : resolve())),
        );
    };

    this.getObject = (id, cb) => {
        if (!id.startsWith(`${this.namespace}.`)) {
            id = `${this.namespace}.${id}`;
        }

        return this.getForeignObject(id, cb);
    };

    this.delForeignObjectAsync = id => {
        return new Promise(resolve => this.getForeignObject(id, () => resolve()));
    };

    this.setObject = (id, obj, cb) => {
        if (!id.startsWith(`${this.namespace}.`)) {
            id = `${this.namespace}.${id}`;
        }

        return this.setForeignObject(id, obj, cb);
    };

    this.setObjectAsync = (id, obj) => {
        return new Promise(resolve => this.setObject(id, obj, (err, obj) => resolve(obj)));
    };

    this.getForeignObject = (id, cb) => {
        cb(null, objects[id]);
    };

    this.getForeignObjectAsync = id => {
        return new Promise(resolve => this.getForeignObject(id, (err, obj) => resolve(obj)));
    };

    this.getObjectAsync = id => {
        return new Promise(resolve => this.getObject(id, (err, obj) => resolve(obj)));
    };

    this.setForeignObject = (id, obj, cb) => {
        obj = JSON.parse(JSON.stringify(obj));
        obj._id = id;
        objects[id] = obj;
        cb && cb();
    };

    this.setForeignObjectAsync = (id, obj) => {
        return new Promise(resolve => this.setForeignObject(id, obj, () => resolve()));
    };

    this.setForeignBinaryStateAsync = (id, state) => {
        states[id] = state;
        return Promise.resolve();
    };

    this.getForeignBinaryStateAsync = id => {
        return Promise.resolve(states[id]);
    };

    this.clearAll = () => {
        objects = {};
        states = {};
    };

    this.setTimeout = (func, time) => {
        return setTimeout(func, time);
    };

    this.clearTimeout = timer => {
        clearTimeout(timer);
    };

    return this;
};
