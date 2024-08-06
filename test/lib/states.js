'use strict';
const path = require('node:path');
const rootDir = path.normalize(__dirname + '/../../');
let adapterName = path.normalize(rootDir).replace(/\\/g, '/').split('/');
adapterName = adapterName[adapterName.length - 2];

const logger = {
    info: function (msg) {
        console.log(msg);
    },
    debug: function (msg) {
        console.log(msg);
    },
    warn: function (msg) {
        console.warn(msg);
    },
    error: function (msg) {
        console.error(msg);
    }
};

function States(cb, stateChange) {
    const that = this;
    const _States = require(rootDir + 'tmp/node_modules/iobroker.js-controller/lib/states');
    let callbackId = 0;

    const options = {
        stateChange: (id, state) => stateChange && stateChange(id, state)
    };

    that.namespace = 'test';

    that.states = new _States({
        connection: {
            type: 'file',
            host: '127.0.0.1',
            port: 19000,
            options: {
                auth_pass: null,
                retry_max_delay: 15000
            }
        },
        logger: logger,
        change: (id, state) => {
            if (!id || typeof id !== 'string') {
                console.log('Something is wrong! ' + JSON.stringify(id));
                return;
            }

            // Clear cache if accidentally got the message about change (Will work for admin and javascript)
            if (id.match(/^system\.user\./) || id.match(/^system\.group\./)) {
                that.users = [];
            }

            // If someone want to have log messages
            if (that.logList && id.match(/\.logging$/)) {
                that.logRedirect(state ? state.val : false, id.substring(0, id.length - '.logging'.length));
            } else
                if (id === 'log.system.adapter.' + that.namespace) {
                    that.processLog(state);
                } else if (id === 'messagebox.system.adapter.' + that.namespace && state) {
                    // Read it from fifo list
                    that.states.delMessage('system.adapter.' + that.namespace, state._id);
                    const obj = state;
                    if (obj) {
                        // If callback stored for this request
                        if (obj.callback &&
                            obj.callback.ack &&
                            obj.callback.id &&
                            that.callbacks &&
                            that.callbacks['_' + obj.callback.id]) {
                            // Call callback function
                            if (that.callbacks['_' + obj.callback.id].cb) {
                                that.callbacks['_' + obj.callback.id].cb(obj.message);
                                delete that.callbacks['_' + obj.callback.id];
                            }
                            // delete too old callbacks IDs, like garbage collector
                            const now = Date.now();
                            for (const _id in that.callbacks) {
                                if (that.callbacks.hasOwnProperty(_id) && now - that.callbacks[_id].time > 3600000) delete that.callbacks[_id];
                            }

                        } else {
                            if (options.message) {
                                // Else inform about new message the adapter
                                options.message(obj);
                            }
                            that.emit('message', obj);
                        }
                    }
                } else {
                    if (id.slice(that.namespace.length) === that.namespace) {
                        if (typeof options.stateChange === 'function') options.stateChange(id.slice(that.namespace.length + 1), state);
                        // emit 'stateChange' event instantly
                        setImmediate(() => that.emit('stateChange', id.slice(that.namespace.length + 1), state));

                    } else {
                        if (typeof options.stateChange === 'function') options.stateChange(id, state);
                        if (id.substring(0, 4) === 'log.') {
                            console.log('LOG');
                        }
                        if (that.emit) {
                            // emit 'stateChange' event instantly
                            setImmediate(() => that.emit('stateChange', id, state));
                        }
                    }
                }
        },
        connectTimeout: (error) => {
            if (logger) logger.error(that.namespace + ' no connection to states DB');
            if (cb) cb('Timeout');
        }
    });

    // Send message to other adapter instance or all instances of adapter
    that.sendTo = function sendTo(objName, command, message, callback) {
        if (typeof message === 'undefined') {
            message = command;
            command = 'send';
        }
        const obj = { command: command, message: message, from: 'system.adapter.' + that.namespace };

        if (!objName.match(/^system\.adapter\./)) objName = 'system.adapter.' + objName;

        that.log.info('sendTo "' + command + '" to ' + objName + ' from system.adapter.' + that.namespace + ': ' + JSON.stringify(message));

        // If not specific instance
        if (!objName.match(/\.[0-9]+$/)) {
            // Send to all instances of adapter
            that.objects.getObjectView('system', 'instance', { startkey: objName + '.', endkey: objName + '.\u9999' }, (err, _obj) => {
                if (_obj) {
                    for (let i = 0; i < _obj.rows.length; i++) {
                        that.states.pushMessage(_obj.rows[i].id, obj);
                    }
                }
            });
        } else {
            if (callback) {
                if (typeof callback === 'function') {
                    // force subscribe even no messagebox enabled
                    if (!that.common.messagebox && !that.mboxSubscribed) {
                        that.mboxSubscribed = true;
                        that.states.subscribeMessage('system.adapter.' + that.namespace);
                    }

                    obj.callback = {
                        message: message,
                        id: callbackId++,
                        ack: false,
                        time: Date.now()
                    };
                    if (callbackId >= 0xFFFFFFFF) {
                        callbackId = 1;
                    }
                    if (!that.callbacks) that.callbacks = {};
                    that.callbacks['_' + obj.callback.id] = { cb: callback };

                    // delete too old callbacks IDs
                    const now = Date.now();
                    for (const _id in that.callbacks) {
                        if (that.callbacks.hasOwnProperty(_id) && now - that.callbacks[_id].time > 3600000) {
                            delete that.callbacks[_id];
                        }
                    }
                } else {
                    obj.callback = callback;
                    obj.callback.ack = true;
                }
            }

            that.states.pushMessage(objName, obj);
        }
    };

    // Send message to specific host or to all hosts
    that.sendToHost = function sendToHost(objName, command, message, callback) {
        if (typeof message === 'undefined') {
            message = command;
            command = 'send';
        }
        const obj = { command: command, message: message, from: 'system.adapter.' + that.namespace };

        if (objName && objName.substring(0, 'system.host.'.length) !== 'system.host.') objName = 'system.host.' + objName;

        if (!objName) {
            // Send to all hosts
            that.objects.getObjectList({ startkey: 'system.host.', endkey: 'system.host.' + '\u9999' }, null, (err, res) => {
                if (!err && res.rows.length) {
                    for (let i = 0; i < res.rows.length; i++) {
                        const parts = res.rows[i].id.split('.');
                        // ignore system.host.name.alive and so on
                        if (parts.length === 3) {
                            that.states.pushMessage(res.rows[i].id, obj);
                        }
                    }
                }
            });
        } else {
            if (callback) {
                if (typeof callback === 'function') {
                    // force subscribe even no messagebox enabled
                    if (!that.common.messagebox && !that.mboxSubscribed) {
                        that.mboxSubscribed = true;
                        that.states.subscribeMessage('system.adapter.' + that.namespace);
                    }

                    obj.callback = {
                        message: message,
                        id: callbackId++,
                        ack: false,
                        time: Date.now()
                    };
                    if (callbackId >= 0xFFFFFFFF) callbackId = 1;
                    if (!that.callbacks) that.callbacks = {};
                    that.callbacks['_' + obj.callback.id] = { cb: callback };
                } else {
                    obj.callback = callback;
                    obj.callback.ack = true;
                }
            }

            that.states.pushMessage(objName, obj);
        }
    };

    that.setState = function setState(id, state, ack, options, callback) {
        if (typeof state === 'object' && typeof ack !== 'boolean') {
            callback = options;
            options = ack;
            ack = undefined;
        }
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }
        id = that._fixId(id, 'state');

        if (typeof ack === 'function') {
            callback = ack;
            ack = undefined;
        }

        if (typeof state !== 'object' || state === null || state === undefined) state = { val: state };

        if (ack !== undefined) {
            state.ack = ack;
        }

        state.from = 'system.adapter.' + that.namespace;
        if (options && options.user && options.user !== 'system.user.admin') {
            checkStates(id, options, 'setState', err => {
                if (err) {
                    if (typeof callback === 'function') callback(err);
                } else {
                    that.states.setState(id, state, callback);
                }
            });
        } else {
            that.states.setState(id, state, callback);
        }
    };

    that.setForeignState = function setForeignState(id, state, ack, options, callback) {
        if (typeof state === 'object' && typeof ack !== 'boolean') {
            callback = options;
            options = ack;
            ack = undefined;
        }

        if (typeof options === 'function') {
            callback = options;
            options = {};
        }

        if (typeof ack === 'function') {
            callback = ack;
            ack = undefined;
        }

        if (typeof state !== 'object' || state === null || state === undefined) state = { val: state };

        if (ack !== undefined) {
            state.ack = ack;
        }

        state.from = 'system.adapter.' + that.namespace;

        if (options && options.user && options.user !== 'system.user.admin') {
            checkStates(id, options, 'setState', err => {
                if (err) {
                    if (typeof callback === 'function') callback(err);
                } else {
                    that.states.setState(id, state, callback);
                }
            });
        } else {
            that.states.setState(id, state, callback);
        }
    };

    that.getState = function getState(id, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }
        id = that._fixId(id, 'state');
        if (options && options.user && options.user !== 'system.user.admin') {
            checkStates(id, options, 'getState', err => {
                if (err) {
                    if (typeof callback === 'function') callback(err);
                } else {
                    that.states.getState(id, callback);
                }
            });
        } else {
            that.states.getState(id, callback);
        }
    };

    that.getStateHistory = function getStateHistory(id, start, end, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }
        id = that._fixId(id, 'state');
        that.getForeignStateHistory(id, start, end, options, callback);
    };

    that.getForeignStateHistory = function getForeignStateHistory(id, start, end, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }

        if (typeof start === 'function') {
            callback = start;
            start = undefined;
            end = undefined;
        } else if (typeof end === 'function') {
            callback = end;
            end = undefined;
        }

        start = start || Math.round((new Date()).getTime() / 1000) - 31536000; // - 1 year
        end = end || Math.round((new Date()).getTime() / 1000) + 5000;

        const history = [];
        const docs = [];

        // get data from states
        that.log.debug('get states history ' + id + ' ' + start + ' ' + end);
        that.getFifo(id, (err, res) => {
            if (!err && res) {
                let iProblemCount = 0;
                for (let i = 0; i < res.length; i++) {
                    if (!res[i]) {
                        iProblemCount++;
                        continue;
                    }
                    if (res[i].ts < start) {
                        continue;
                    } else if (res[i].ts > end) {
                        break;
                    }
                    history.push(res[i]);
                }
                if (iProblemCount) that.log.warn('got null states ' + iProblemCount + ' times for ' + id);

                that.log.debug('got ' + res.length + ' datapoints for ' + id);
            } else {
                if (err !== 'Not exists') {
                    that.log.error(err);
                } else {
                    that.log.debug('datapoints for ' + id + ' do not yet exist');
                }
            }

            // fetch a history document from objectDB
            function getObjectsLog(cid, callback) {
                that.log.info('getObjectLog ' + cid);
                that.getForeignObject(cid, options, (err, res) => {
                    if (!err && res.common.data) {
                        for (let i = 0; i < res.common.data.length; i++) {
                            if (res.common.data[i].ts < start) {
                                continue;
                            } else if (res.common.data[i].ts > end) {
                                break;
                            }
                            history.push(res.common.data[i]);
                        }
                    } else {
                        that.log.warn(cid + ' not found');
                    }
                    callback(err);
                });
            }

            // queue objects history documents fetching
            function queue(ts) {
                if (ts < start) {
                    callback(null, history);
                    return;
                }
                const cid = 'history.' + id + '.' + ts2day(ts);
                if (docs.indexOf(cid) !== -1) {
                    getObjectsLog(cid, err => queue(ts - 86400)); // - 1 day
                } else {
                    queue(ts - 86400); // - 1 day
                }
            }

            // get list of available history documents
            that.objects.getObjectList({ startkey: 'history.' + id, endkey: 'history.' + id + '\u9999' }, options, (err, res) => {
                if (!err && res.rows.length) {
                    for (let i = 0; i < res.rows.length; i++) {
                        docs.push(res.rows[i].id);
                    }
                    queue(end);
                } else {
                    callback(null, history);
                }
            });
        });
    };

    // normally only foreign history has interest, so there is no getHistory and getForeignHistory
    that.getHistory = function getHistory(id, options, callback) {
        options = options || {};
        options.end = options.end || Math.round((new Date()).getTime() / 1000) + 5000;
        if (!options.count && !options.start) {
            options.start = options.start || Math.round((new Date()).getTime() / 1000) - 604800; // - 1 week
        }

        if (!options.instance) {
            if (!that.defaultHistory) {
                // read default history instance from system.config
                return getDefaultHistory(() => that.getHistory(id, options, callback));
            } else {
                options.instance = that.defaultHistory;
            }
        }

        that.sendTo(options.instance || 'history.0', 'getHistory', { id: id, options: options }, res => {
            setImmediate(() => callback(res.error, res.result, res.step));
        });
    };

    // Convert ID adapter.instance.device.channel.state
    // Convert ID to {device: D, channel: C, state: S}
    that.idToDCS = function idToDCS(id) {
        if (!id) return null;
        const parts = id.split('.');
        if (parts[0] + '.' + parts[1] !== that.namespace) {
            that.log.warn('Try to decode id not from this adapter');
            return null;
        }
        return { device: parts[2], channel: parts[3], state: parts[4] };
    };

    that.getForeignState = function getForeignState(id, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }
        if (options && options.user && options.user !== 'system.user.admin') {
            checkStates(id, options, 'getState', err => {
                if (err) {
                    if (typeof callback === 'function') callback(err);
                } else {
                    that.states.getState(id, callback);
                }
            });
        } else {
            that.states.getState(id, callback);
        }
    };

    that.delForeignState = function delForeignState(id, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }

        if (options && options.user && options.user !== 'system.user.admin') {
            checkStates(id, options, 'delState', err => {
                if (err) {
                    if (typeof callback === 'function') callback(err);
                } else {
                    that.states.delState(id, callback);
                }
            });
        } else {
            that.states.delState(id, callback);
        }

    };

    that.delState = function delState(id, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }
        id = that._fixId(id);
        if (options && options.user && options.user !== 'system.user.admin') {
            checkStates(id, options, 'delState', err => {
                if (err) {
                    if (typeof callback === 'function') callback(err);
                } else {
                    that.states.delState(id, callback);
                }
            });
        } else {
            that.states.delState(id, callback);
        }
    };

    that.getStates = function getStates(pattern, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }
        pattern = that._fixId(pattern, 'state');
        that.getForeignStates(pattern, options, callback);
    };

    that.getForeignStates = function getForeignStates(pattern, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }
        const list = {};
        if (typeof pattern === 'function') {
            callback = pattern;
            pattern = '*';
        }

        if (typeof callback !== 'function') {
            logger.error('getForeignStates invalid callback for ' + pattern);
            return;
        }

        if (typeof pattern === 'object') {
            that.states.getStates(pattern, (err, arr) => {
                if (err) {
                    callback(err);
                    return;
                }
                for (let i = 0; i < pattern.length; i++) {
                    if (typeof arr[i] === 'string') arr[i] = JSON.parse(arr[i]);
                    list[pattern[i]] = arr[i] || {};
                }
                callback(null, list);
            });
            return;
        }
        const keys = [];
        let params = {};
        if (pattern && pattern !== '*') {
            params = {
                startkey: pattern.replace('*', ''),
                endkey: pattern.replace('*', '\u9999')
            };
        }
        that.objects.getObjectView('system', 'state', params, options, (err, res) => {
            if (err) {
                if (typeof callback === 'function') callback(err);
                return;
            }

            for (let i = 0; i < res.rows.length; i++) {
                keys.push(res.rows[i].id);
            }

            if (options && options.user && options.user !== 'system.user.admin') {
                checkStates(keys, options, 'getState', (err, keys) => {
                    if (err) {
                        if (typeof callback === 'function') callback(err);
                        return;
                    }
                    that.states.getStates(keys, function (err, arr) {
                        if (err) {
                            callback(err);
                            return;
                        }
                        for (let i = 0; i < res.rows.length; i++) {
                            if (typeof arr[i] === 'string') arr[i] = JSON.parse(arr[i]);
                            list[keys[i]] = arr[i] || {};
                        }
                        if (typeof callback === 'function') callback(null, list);
                    });
                });
            } else {
                that.states.getStates(keys, function (err, arr) {
                    if (err) {
                        callback(err);
                        return;
                    }
                    for (let i = 0; i < res.rows.length; i++) {
                        if (typeof arr[i] === 'string') arr[i] = JSON.parse(arr[i]);
                        list[keys[i]] = arr[i] || {};
                    }
                    if (typeof callback === 'function') callback(null, list);
                });
            }
        });
    };

    that.subscribeForeignStates = function subscribeForeignStates(pattern, options) {
        if (!pattern) pattern = '*';
        that.states.subscribe(pattern, options);
    };

    that.unsubscribeForeignStates = function unsubscribeForeignStates(pattern, options) {
        if (!pattern) pattern = '*';
        that.states.unsubscribe(pattern, options);
    };

    that.subscribeStates = function subscribeStates(pattern, options) {
        // Exception. Threat the '*' case automatically
        if (!pattern || pattern === '*') {
            that.states.subscribe(that.namespace + '.*', options);
        } else {
            pattern = that._fixId(pattern, 'state');
            that.states.subscribe(pattern, options);
        }
    };

    that.unsubscribeStates = function unsubscribeStates(pattern, options) {
        if (!pattern || pattern === '*') {
            that.states.unsubscribe(that.namespace + '.*', options);
        } else {
            pattern = that._fixId(pattern, 'state');
            that.states.unsubscribe(pattern, options);
        }
    };

    that.pushFifo = function pushFifo(id, state, callback) {
        that.states.pushFifo(id, state, callback);
    };

    that.trimFifo = function trimFifo(id, start, end, callback) {
        that.states.trimFifo(id, start, end, callback);
    };

    that.getFifoRange = function getFifoRange(id, start, end, callback) {
        that.states.getFifoRange(id, start, end, callback);
    };

    that.getFifo = function getFifo(id, callback) {
        that.states.getFifo(id, callback);
    };

    that.lenFifo = function lenFifo(id, callback) {
        that.states.lenFifo(id, callback);
    };

    that.subscribeFifo = function subscribeFifo(pattern) {
        that.states.subscribeFifo(pattern);
    };

    that.getSession = function getSession(id, callback) {
        that.states.getSession(id, callback);
    };
    that.setSession = function setSession(id, ttl, data, callback) {
        that.states.setSession(id, ttl, data, callback);
    };
    that.destroySession = function destroySession(id, callback) {
        that.states.destroySession(id, callback);
    };

    that.getMessage = function getMessage(callback) {
        that.states.getMessage('system.adapter.' + that.namespace, callback);
    };

    that.lenMessage = function lenMessage(callback) {
        that.states.lenMessage('system.adapter.' + that.namespace, callback);
    };

    logger.debug(that.namespace + ' statesDB connected');

    if (typeof cb === 'function') {
        setImmediate(() => cb(), 0);
    }

    return this;
}

module.exports = States;
