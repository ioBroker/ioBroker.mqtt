'use strict';
const path = require('node:path');
const rootDir = path.normalize(`${__dirname}/../../`);

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
    },
};
const USER_ADMIN = 'system.user.admin';

function ts2day(ts) {
    const date = new Date(ts);
    return `${date.getFullYear()}-${(date.getMonth() + 1).padStart(2, '0')}-${date.getDate().padStart(2, '0')}`;
}

function checkStates(id, options, command, cb) {
    cb?.();
}

function States(cb, stateChange) {
    const _States = require(`${rootDir}tmp/node_modules/iobroker.js-controller/lib/states`);
    let callbackId = 0;

    const options = {
        stateChange: (id, state) => stateChange?.(id, state),
    };

    this.namespace = 'test';

    this.states = new _States({
        connection: {
            type: 'file',
            host: '127.0.0.1',
            port: 19000,
            options: {
                auth_pass: null,
                retry_max_delay: 15000,
            },
        },
        logger,
        change: (id, state) => {
            if (!id || typeof id !== 'string') {
                console.log(`Something is wrong! ${JSON.stringify(id)}`);
                return;
            }

            // Clear cache if accidentally got the message about change (Will work for admin and javascript)
            if (id.match(/^system\.user\./) || id.match(/^system\.group\./)) {
                this.users = [];
            }

            // If someone wants to have log messages
            if (this.logList && id.match(/\.logging$/)) {
                this.logRedirect(state ? state.val : false, id.substring(0, id.length - '.logging'.length));
            } else if (id === `log.system.adapter.${this.namespace}`) {
                this.processLog(state);
            } else if (id === `messagebox.system.adapter.${this.namespace}` && state) {
                // Read it from fifo list
                this.states.delMessage(`system.adapter.${this.namespace}`, state._id);
                const obj = state;
                if (obj) {
                    // If callback stored for this request
                    if (obj.callback?.ack && obj.callback.id && this.callbacks?.[`_${obj.callback.id}`]) {
                        // Call callback function
                        if (this.callbacks[`_${obj.callback.id}`].cb) {
                            this.callbacks[`_${obj.callback.id}`].cb(obj.message);
                            delete this.callbacks[`_${obj.callback.id}`];
                        }
                        // delete too old callbacks IDs, like garbage collector
                        const now = Date.now();
                        for (const _id in this.callbacks) {
                            if (
                                Object.prototype.hasOwnProperty.call(this.callbacks, _id) &&
                                now - this.callbacks[_id].time > 3600000
                            ) {
                                delete this.callbacks[_id];
                            }
                        }
                    } else {
                        if (options.message) {
                            // Else inform about a new message the adapter
                            options.message(obj);
                        }
                        this.emit('message', obj);
                    }
                }
            } else {
                if (id.slice(this.namespace.length) === this.namespace) {
                    if (typeof options.stateChange === 'function') {
                        options.stateChange(id.slice(this.namespace.length + 1), state);
                    }
                    // emit 'stateChange' event instantly
                    setImmediate(() => this.emit('stateChange', id.slice(this.namespace.length + 1), state));
                } else {
                    if (typeof options.stateChange === 'function') {
                        options.stateChange(id, state);
                    }
                    if (id.substring(0, 4) === 'log.') {
                        console.log('LOG');
                    }
                    if (this.emit) {
                        // emit 'stateChange' event instantly
                        setImmediate(() => this.emit('stateChange', id, state));
                    }
                }
            }
        },
        connectTimeout: () => {
            logger?.error(`${this.namespace} no connection to states DB`);
            cb?.('Timeout');
        },
    });

    // Send a message to another adapter instance or all instances of adapter
    this.sendTo = function sendTo(objName, command, message, callback) {
        if (typeof message === 'undefined') {
            message = command;
            command = 'send';
        }
        const obj = { command, message, from: `system.adapter.${this.namespace}` };

        if (!objName.match(/^system\.adapter\./)) {
            objName = `system.adapter.${objName}`;
        }

        this.log.info(
            `sendTo "${command}" to ${objName} from system.adapter.${this.namespace}: ${JSON.stringify(message)}`,
        );

        // If not specific instance
        if (!objName.match(/\.[0-9]+$/)) {
            // Send it to all instances of adapter
            this.objects.getObjectView(
                'system',
                'instance',
                { startkey: `${objName}.`, endkey: `${objName}.\u9999` },
                (err, _obj) => {
                    if (_obj) {
                        for (let i = 0; i < _obj.rows.length; i++) {
                            this.states.pushMessage(_obj.rows[i].id, obj);
                        }
                    }
                },
            );
        } else {
            if (callback) {
                if (typeof callback === 'function') {
                    // force subscribe even no messagebox enabled
                    if (!this.common.messagebox && !this.mboxSubscribed) {
                        this.mboxSubscribed = true;
                        this.states.subscribeMessage(`system.adapter.${this.namespace}`);
                    }

                    obj.callback = {
                        message,
                        id: callbackId++,
                        ack: false,
                        time: Date.now(),
                    };
                    if (callbackId >= 0xffffffff) {
                        callbackId = 1;
                    }
                    if (!this.callbacks) {
                        this.callbacks = {};
                    }
                    this.callbacks[`_${obj.callback.id}`] = { cb: callback };

                    // delete too old callbacks IDs
                    const now = Date.now();
                    for (const _id in this.callbacks) {
                        if (
                            Object.prototype.hasOwnProperty.call(this.callbacks, _id) &&
                            now - this.callbacks[_id].time > 3600000
                        ) {
                            delete this.callbacks[_id];
                        }
                    }
                } else {
                    obj.callback = callback;
                    obj.callback.ack = true;
                }
            }

            this.states.pushMessage(objName, obj);
        }
    };

    // Send message to specific host or to all hosts
    this.sendToHost = function sendToHost(objName, command, message, callback) {
        if (typeof message === 'undefined') {
            message = command;
            command = 'send';
        }
        const obj = { command, message, from: `system.adapter.${this.namespace}` };

        if (objName && objName.substring(0, 'system.host.'.length) !== 'system.host.') {
            objName = `system.host.${objName}`;
        }

        if (!objName) {
            // Send it to all hosts
            this.objects.getObjectList({ startkey: 'system.host.', endkey: `system.host.\u9999` }, null, (err, res) => {
                if (!err && res.rows.length) {
                    for (let i = 0; i < res.rows.length; i++) {
                        const parts = res.rows[i].id.split('.');
                        // ignore system.host.name.alive and so on
                        if (parts.length === 3) {
                            this.states.pushMessage(res.rows[i].id, obj);
                        }
                    }
                }
            });
        } else {
            if (callback) {
                if (typeof callback === 'function') {
                    // force subscribe even no messagebox enabled
                    if (!this.common.messagebox && !this.mboxSubscribed) {
                        this.mboxSubscribed = true;
                        this.states.subscribeMessage(`system.adapter.${this.namespace}`);
                    }

                    obj.callback = {
                        message: message,
                        id: callbackId++,
                        ack: false,
                        time: Date.now(),
                    };
                    if (callbackId >= 0xffffffff) {
                        callbackId = 1;
                    }
                    if (!this.callbacks) {
                        this.callbacks = {};
                    }
                    this.callbacks[`_${obj.callback.id}`] = { cb: callback };
                } else {
                    obj.callback = callback;
                    obj.callback.ack = true;
                }
            }

            this.states.pushMessage(objName, obj);
        }
    };

    this.setState = function setState(id, state, ack, options, callback) {
        if (typeof state === 'object' && typeof ack !== 'boolean') {
            callback = options;
            options = ack;
            ack = undefined;
        }
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }
        id = this._fixId(id, 'state');

        if (typeof ack === 'function') {
            callback = ack;
            ack = undefined;
        }

        if (typeof state !== 'object' || state === null || state === undefined) {
            state = { val: state };
        }

        if (ack !== undefined) {
            state.ack = ack;
        }

        state.from = `system.adapter.${this.namespace}`;
        if (options?.user && options.user !== USER_ADMIN) {
            checkStates(id, options, 'setState', err => {
                if (err) {
                    if (typeof callback === 'function') {
                        callback(err);
                    }
                } else {
                    this.states.setState(id, state, callback);
                }
            });
        } else {
            this.states.setState(id, state, callback);
        }
    };

    this.setForeignState = function setForeignState(id, state, ack, options, callback) {
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

        if (typeof state !== 'object' || state === null || state === undefined) {
            state = { val: state };
        }

        if (ack !== undefined) {
            state.ack = ack;
        }

        state.from = `system.adapter.${this.namespace}`;

        if (options?.user && options.user !== USER_ADMIN) {
            checkStates(id, options, 'setState', err => {
                if (err) {
                    if (typeof callback === 'function') {
                        callback(err);
                    }
                } else {
                    this.states.setState(id, state, callback);
                }
            });
        } else {
            this.states.setState(id, state, callback);
        }
    };

    this.getState = function getState(id, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }
        id = this._fixId(id, 'state');
        if (options?.user && options.user !== USER_ADMIN) {
            checkStates(id, options, 'getState', err => {
                if (err) {
                    if (typeof callback === 'function') {
                        callback(err);
                    }
                } else {
                    this.states.getState(id, callback);
                }
            });
        } else {
            this.states.getState(id, callback);
        }
    };

    this.getStateHistory = function getStateHistory(id, start, end, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }
        id = this._fixId(id, 'state');
        this.getForeignStateHistory(id, start, end, options, callback);
    };

    this.getForeignStateHistory = function getForeignStateHistory(id, start, end, options, callback) {
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

        start ||= Math.round(new Date().getTime() / 1000) - 31536000; // - 1 year
        end ||= Math.round(new Date().getTime() / 1000) + 5000;

        const history = [];
        const docs = [];

        // get data from states
        this.log.debug(`get states history ${id} ${start} ${end}`);
        this.getFifo(id, (err, res) => {
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
                if (iProblemCount) {
                    this.log.warn(`got null states ${iProblemCount} times for ${id}`);
                }

                this.log.debug(`got ${res.length} datapoints for ${id}`);
            } else {
                if (err !== 'Not exists') {
                    this.log.error(err);
                } else {
                    this.log.debug(`datapoints for ${id} do not yet exist`);
                }
            }

            // fetch a history document from objectDB
            function getObjectsLog(cid, callback) {
                this.log.info(`getObjectLog ${cid}`);
                this.getForeignObject(cid, options, (err, res) => {
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
                        this.log.warn(`${cid} not found`);
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
                const cid = `history.${id}.${ts2day(ts)}`;
                if (docs.includes(cid)) {
                    getObjectsLog(cid, () => queue(ts - 86400)); // - 1 day
                } else {
                    queue(ts - 86400); // - 1 day
                }
            }

            // get a list of available history documents
            this.objects.getObjectList(
                { startkey: `history.${id}`, endkey: `history.${id}\u9999` },
                options,
                (err, res) => {
                    if (!err && res.rows.length) {
                        for (let i = 0; i < res.rows.length; i++) {
                            docs.push(res.rows[i].id);
                        }
                        queue(end);
                    } else {
                        callback(null, history);
                    }
                },
            );
        });
    };

    // normally only foreign history has interest, so there is no getHistory and getForeignHistory
    this.getHistory = function getHistory(id, options, callback) {
        options ||= {};
        options.end ||= Math.round(new Date().getTime() / 1000) + 5000;
        if (!options.count && !options.start) {
            options.start ||= Math.round(new Date().getTime() / 1000) - 604800; // - 1 week
        }

        if (!options.instance) {
            if (!this.defaultHistory) {
                // read default history instance from system.config
                throw new Error('No default history');
            }
            options.instance = this.defaultHistory;
        }

        this.sendTo(options.instance || 'history.0', 'getHistory', { id, options }, res => {
            setImmediate(() => callback(res.error, res.result, res.step));
        });
    };

    // Convert ID adapter.instance.device.channel.state
    // Convert ID to {device: D, channel: C, state: S}
    this.idToDCS = function idToDCS(id) {
        if (!id) {
            return null;
        }
        const parts = id.split('.');
        if (`${parts[0]}.${parts[1]}` !== this.namespace) {
            this.log.warn('Try to decode id not from this adapter');
            return null;
        }
        return { device: parts[2], channel: parts[3], state: parts[4] };
    };

    this.getForeignState = function getForeignState(id, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }
        if (options?.user && options.user !== USER_ADMIN) {
            checkStates(id, options, 'getState', err => {
                if (err) {
                    if (typeof callback === 'function') {
                        callback(err);
                    }
                } else {
                    this.states.getState(id, callback);
                }
            });
        } else {
            this.states.getState(id, callback);
        }
    };

    this.delForeignState = function delForeignState(id, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }

        if (options?.user && options.user !== USER_ADMIN) {
            checkStates(id, options, 'delState', err => {
                if (err) {
                    if (typeof callback === 'function') {
                        callback(err);
                    }
                } else {
                    this.states.delState(id, callback);
                }
            });
        } else {
            this.states.delState(id, callback);
        }
    };

    this.delState = function delState(id, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }
        id = this._fixId(id);
        if (options?.user && options.user !== USER_ADMIN) {
            checkStates(id, options, 'delState', err => {
                if (err) {
                    if (typeof callback === 'function') {
                        callback(err);
                    }
                } else {
                    this.states.delState(id, callback);
                }
            });
        } else {
            this.states.delState(id, callback);
        }
    };

    this.getStates = function getStates(pattern, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }
        pattern = this._fixId(pattern, 'state');
        this.getForeignStates(pattern, options, callback);
    };

    this.getForeignStates = function getForeignStates(pattern, options, callback) {
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
            logger.error(`getForeignStates invalid callback for ${pattern}`);
            return;
        }

        if (typeof pattern === 'object') {
            this.states.getStates(pattern, (err, arr) => {
                if (err) {
                    callback(err);
                    return;
                }
                for (let i = 0; i < pattern.length; i++) {
                    if (typeof arr[i] === 'string') {
                        arr[i] = JSON.parse(arr[i]);
                    }
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
                endkey: pattern.replace('*', '\u9999'),
            };
        }
        this.objects.getObjectView('system', 'state', params, options, (err, res) => {
            if (err) {
                if (typeof callback === 'function') {
                    callback(err);
                }
                return;
            }

            for (let i = 0; i < res.rows.length; i++) {
                keys.push(res.rows[i].id);
            }

            if (options?.user && options.user !== USER_ADMIN) {
                checkStates(keys, options, 'getState', (err, keys) => {
                    if (err) {
                        if (typeof callback === 'function') {
                            callback(err);
                        }
                        return;
                    }
                    this.states.getStates(keys, (err, arr) => {
                        if (err) {
                            callback(err);
                            return;
                        }
                        for (let i = 0; i < res.rows.length; i++) {
                            if (typeof arr[i] === 'string') {
                                arr[i] = JSON.parse(arr[i]);
                            }
                            list[keys[i]] = arr[i] || {};
                        }
                        if (typeof callback === 'function') {
                            callback(null, list);
                        }
                    });
                });
            } else {
                this.states.getStates(keys, (err, arr) => {
                    if (err) {
                        callback(err);
                        return;
                    }
                    for (let i = 0; i < res.rows.length; i++) {
                        if (typeof arr[i] === 'string') {
                            arr[i] = JSON.parse(arr[i]);
                        }
                        list[keys[i]] = arr[i] || {};
                    }
                    if (typeof callback === 'function') {
                        callback(null, list);
                    }
                });
            }
        });
    };

    this.subscribeForeignStates = function subscribeForeignStates(pattern, options) {
        pattern ||= '*';
        this.states.subscribe(pattern, options);
    };

    this.unsubscribeForeignStates = function unsubscribeForeignStates(pattern, options) {
        pattern ||= '*';
        this.states.unsubscribe(pattern, options);
    };

    this.subscribeStates = function subscribeStates(pattern, options) {
        // Exception. Threat the '*' case automatically
        if (!pattern || pattern === '*') {
            this.states.subscribe(`${this.namespace}.*`, options);
        } else {
            pattern = this._fixId(pattern, 'state');
            this.states.subscribe(pattern, options);
        }
    };

    this.unsubscribeStates = function unsubscribeStates(pattern, options) {
        if (!pattern || pattern === '*') {
            this.states.unsubscribe(`${this.namespace}.*`, options);
        } else {
            pattern = this._fixId(pattern, 'state');
            this.states.unsubscribe(pattern, options);
        }
    };

    this.pushFifo = function pushFifo(id, state, callback) {
        this.states.pushFifo(id, state, callback);
    };

    this.trimFifo = function trimFifo(id, start, end, callback) {
        this.states.trimFifo(id, start, end, callback);
    };

    this.getFifoRange = function getFifoRange(id, start, end, callback) {
        this.states.getFifoRange(id, start, end, callback);
    };

    this.getFifo = function getFifo(id, callback) {
        this.states.getFifo(id, callback);
    };

    this.lenFifo = function lenFifo(id, callback) {
        this.states.lenFifo(id, callback);
    };

    this.subscribeFifo = function subscribeFifo(pattern) {
        this.states.subscribeFifo(pattern);
    };

    this.getSession = function getSession(id, callback) {
        this.states.getSession(id, callback);
    };
    this.setSession = function setSession(id, ttl, data, callback) {
        this.states.setSession(id, ttl, data, callback);
    };
    this.destroySession = function destroySession(id, callback) {
        this.states.destroySession(id, callback);
    };

    this.getMessage = function getMessage(callback) {
        this.states.getMessage(`system.adapter.${this.namespace}`, callback);
    };

    this.lenMessage = function lenMessage(callback) {
        this.states.lenMessage(`system.adapter.${this.namespace}`, callback);
    };

    logger.debug(`${this.namespace} statesDB connected`);

    if (typeof cb === 'function') {
        setImmediate(() => cb(), 0);
    }

    return this;
}

module.exports = States;
