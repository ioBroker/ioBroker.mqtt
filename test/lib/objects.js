'use strict';
const path = require('node:path');
const extend = require('node.extend');
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

const defaultObjs = {};

function Objects(cb, objectChange) {
    const _Objects = require(`${rootDir}tmp/node_modules/iobroker.js-controller/lib/objects`);
    this.connected = false;

    this.namespace = 'test';

    this.objects = new _Objects({
        connection: {
            type: 'file',
            host: '127.0.0.1',
            port: 19001,
            user: '',
            pass: '',
            noFileCache: false,
            connectTimeout: 2000,
        },
        logger,
        connected: () => {
            this.connected = true;
            if (typeof cb === 'function') {
                cb();
            }
        },
        disconnected: () => {
            this.connected = false;
        },
        change: (id, obj) => {
            if (!id) {
                logger.error(`${this.namespace} change ID is empty:  ${JSON.stringify(obj)}`);
                return;
            }

            if (id.slice(this.namespace.length) === this.namespace) {
                if (typeof objectChange === 'function') {
                    objectChange(id.slice(this.namespace.length + 1), obj);
                }

                // emit 'objectChange' event instantly
                setImmediate(() => this.emit('objectChange', id.slice(this.namespace.length + 1), obj));
            } else {
                if (typeof objectChange === 'function') {
                    objectChange(id, obj);
                }

                // emit 'objectChange' event instantly
                setImmediate(() => this.emit('objectChange', id, obj));
            }
        },
        connectTimeout: () => {
            logger?.error(`${this.namespace} no connection to objects DB`);
            if (typeof cb === 'function') {
                cb('Connect timeout');
            }
        },
    });

    this._namespaceRegExp = new RegExp(`^${this.namespace}`); // cache the regex object 'adapter.0'

    this._fixId = function _fixId(id) {
        let result = '';
        // If id is an object
        if (typeof id === 'object') {
            // Add namespace + device + channel
            result = `${this.namespace}.${id.device ? `${id.device}.` : ''}${id.channel ? `${id.channel}.` : ''}${id.state}`;
        } else {
            result = id;
            if (!this._namespaceRegExp.test(id)) {
                result = `${this.namespace}.${id}`;
            }
        }
        return result;
    };

    this.setObject = function setObject(id, obj, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = null;
        }

        if (!id) {
            logger.error(`${this.namespace} setObject id missing!!`);
            return;
        }

        if (!obj) {
            logger.error(`${this.namespace} setObject ${id} object missing!`);
            return;
        }

        if (Object.prototype.hasOwnProperty.call(obj, 'type')) {
            if (!Object.prototype.hasOwnProperty.call(obj, 'native')) {
                logger.warn(`${this.namespace} setObject ${id} (type=${obj.type}) property native missing!`);
                obj.native = {};
            }
            // Check property 'common'
            if (!Object.prototype.hasOwnProperty.call(obj, 'common')) {
                logger.warn(`${this.namespace} setObject ${id} (type=${obj.type}) property common missing!`);
                obj.common = {};
            } else if (obj.type === 'state') {
                // Try to extend the model for type='state'
                // Check property 'role' by 'state'
                if (Object.prototype.hasOwnProperty.call(obj.common, 'role') && defaultObjs[obj.common.role]) {
                    obj.common = extend(true, defaultObjs[obj.common.role], obj.common);
                } else if (!Object.prototype.hasOwnProperty.call(obj.common, 'role')) {
                    logger.warn(`${this.namespace} setObject ${id} (type=${obj.type}) property common.role missing!`);
                }
                if (!Object.prototype.hasOwnProperty.call(obj.common, 'type')) {
                    logger.warn(`${this.namespace} setObject ${id} (type=${obj.type}) property common.type missing!`);
                }
            }

            if (!Object.prototype.hasOwnProperty.call(obj.common, 'name')) {
                obj.common.name = id;
                logger.debug(
                    `${this.namespace} setObject ${id} (type=${obj.type}) property common.name missing, using id as name`,
                );
            }

            id = this._fixId(id, obj.type);

            if (obj.children || obj.parent) {
                logger.warn(`Do not use parent or children for ${id}`);
            }
            this.objects.setObject(id, obj, options, callback);
        } else {
            logger.error(`${this.namespace} setObject ${id} mandatory property type missing!`);
        }
    };

    this.extendObject = function extendObject(id, obj, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = null;
        }
        id = this._fixId(id, obj.type);

        if (obj.children || obj.parent) {
            logger.warn(`Do not use parent or children for ${id}`);
        }
        // delete arrays if they should be changed
        if (
            obj &&
            (obj.common?.members || obj.native?.repositories || obj.native?.certificates || obj.native?.devices)
        ) {
            // Read a whole object
            this.objects.getObject(id, options, (err, oldObj) => {
                if (err) {
                    if (typeof callback === 'function') {
                        callback(err);
                    }
                    return;
                }
                if (!oldObj) {
                    logger.error(`Object ${id} not exist!`);
                    oldObj = {};
                }
                if (obj.native && obj.native.repositories && oldObj.native && oldObj.native.repositories) {
                    oldObj.native.repositories = [];
                }
                if (obj.common && obj.common.members && oldObj.common && oldObj.common.members) {
                    oldObj.common.members = [];
                }
                if (obj.native && obj.native.certificates && oldObj.native && oldObj.native.certificates) {
                    oldObj.native.certificates = [];
                }
                if (obj.native && obj.native.devices && oldObj.native && oldObj.native.devices) {
                    oldObj.native.devices = [];
                }
                obj = extend(true, oldObj, obj);

                this.objects.setObject(id, obj, options, callback);
            });
        } else {
            this.objects.extendObject(id, obj, options, callback);
        }
    };

    this.setForeignObject = function setForeignObject(id, obj, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = null;
        }
        this.objects.setObject(id, obj, options, callback);
    };

    this.extendForeignObject = function extendForeignObject(id, obj, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = null;
        }
        // delete arrays if they should be changed
        if (
            obj &&
            ((obj.native && (obj.native.repositories || obj.native.certificates || obj.native.devices)) ||
                (obj.common && obj.common.members))
        ) {
            // Read a whole object
            this.objects.getObject(id, options, (err, oldObj) => {
                if (err) {
                    if (typeof callback === 'function') {
                        callback(err);
                    }
                    return;
                }
                if (!oldObj) {
                    logger.error(`Object ${id} not exist!`);
                    oldObj = {};
                }
                if (obj.native && obj.native.repositories && oldObj.native && oldObj.native.repositories) {
                    oldObj.native.repositories = [];
                }
                if (obj.common && obj.common.members && oldObj.common && oldObj.common.members) {
                    oldObj.common.members = [];
                }
                if (obj.native && obj.native.certificates && oldObj.native && oldObj.native.certificates) {
                    oldObj.native.certificates = [];
                }
                if (obj.native && obj.native.devices && oldObj.native && oldObj.native.devices) {
                    oldObj.native.devices = [];
                }
                obj = extend(true, oldObj, obj);

                this.objects.setObject(id, obj, callback);
            });
        } else {
            this.objects.extendObject(id, obj, options, callback);
        }
    };

    this.getObject = function getObject(id, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = null;
        }
        this.objects.getObject(this._fixId(id), options, callback);
    };

    // Get the enum tree
    this.getEnum = function getEnum(_enum, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = null;
        }
        if (!_enum.match('^enum.')) {
            _enum = `enum.${_enum}`;
        }
        const result = {};

        this.objects.getObjectView(
            'system',
            'enum',
            { startkey: `${_enum}.`, endkey: `${_enum}.\u9999` },
            options,
            (err, res) => {
                if (err) {
                    if (typeof callback === 'function') {
                        callback(err);
                    }
                    return;
                }
                // Read all
                let count = 0;

                for (let t = 0; t < res.rows.length; t++) {
                    count++;
                    this.objects.getObject(res.rows[t].id, options, (err, _obj) => {
                        if (err) {
                            if (typeof callback === 'function') {
                                callback(err);
                            }
                            callback = null;
                            return;
                        }

                        if (!err && _obj) {
                            result[_obj._id] = _obj;
                        }
                        if (!--count && callback) {
                            callback(err, result, _enum);
                        }
                    });
                }
                if (!count && callback) {
                    callback(err, result);
                }
            },
        );
    };

    // read for given enums the members of them
    this.getEnums = function getEnums(_enumList, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = null;
        }
        const _enums = {};
        if (_enumList) {
            if (typeof _enumList === 'string') {
                _enumList = [_enumList];
            }
            let count = 0;
            for (let t = 0; t < _enumList.length; t++) {
                count++;
                this.getEnum(_enumList[t], options, (list, _enum) => {
                    _enums[_enum] = list;
                    if (!--count && callback) {
                        callback(_enums);
                    }
                });
            }
        } else {
            // Read all enums
            this.objects.getObjectView(
                'system',
                'enum',
                { startkey: 'enum.', endkey: 'enum.\u9999' },
                options,
                (err, res) => {
                    if (err) {
                        callback(err);
                        return;
                    }
                    const result = {};
                    for (let i = 0; i < res.rows.length; i++) {
                        const parts = res.rows[i].id.split('.', 3);
                        if (!parts[2]) {
                            continue;
                        }
                        if (!result[`${parts[0]}.${parts[1]}`]) {
                            result[`${parts[0]}.${parts[1]}`] = {};
                        }
                        result[`${parts[0]}.${parts[1]}`][res.rows[i].id] = res.rows[i].value;
                    }

                    if (callback) {
                        callback(err, result);
                    }
                },
            );
        }
    };

    this.getForeignObjects = function getForeignObjects(pattern, type, enums, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = null;
        }
        let params = {};
        if (pattern && pattern !== '*') {
            params = {
                startkey: pattern.replace('*', ''),
                endkey: pattern.replace('*', '\u9999'),
            };
        }
        if (typeof enums === 'function') {
            callback = enums;
            enums = null;
        }
        if (typeof type === 'function') {
            callback = type;
            type = null;
        }
        this.objects.getObjectView('system', type || 'state', params, options, (err, res) => {
            if (err) {
                callback(err);
                return;
            }

            this.getEnums(enums, _enums => {
                const list = {};
                for (let i = 0; i < res.rows.length; i++) {
                    list[res.rows[i].id] = res.rows[i].value;

                    if (_enums) {
                        // get device or channel of this state and check it too
                        const parts = res.rows[i].id.split('.');
                        parts.splice(parts.length - 1, 1);
                        const channel = parts.join('.');
                        parts.splice(parts.length - 1, 1);
                        const device = parts.join('.');

                        list[res.rows[i].id].enums = {};
                        for (const es in _enums) {
                            if (!Object.prototype.hasOwnProperty.call(_enums, es)) {
                                continue;
                            }
                            for (const e in _enums[es]) {
                                if (!Object.prototype.hasOwnProperty.call(_enums[es], e)) {
                                    continue;
                                }
                                if (!_enums[es][e]?.common?.members) {
                                    continue;
                                }
                                if (
                                    _enums[es][e].common.members.includes(res.rows[i].id) ||
                                    _enums[es][e].common.members.includes(channel) ||
                                    _enums[es][e].common.members.includes(device)
                                ) {
                                    list[res.rows[i].id].enums[e] = _enums[es][e].common.name;
                                }
                            }
                        }
                    }
                }
                callback(null, list);
            });
        });
    };

    this.findForeignObject = function findForeignObject(id, type, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = null;
        }
        this.objects.findObject(id, type, options, callback);
    };

    this.getForeignObject = function getForeignObject(id, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = null;
        }
        this.objects.getObject(id, options, callback);
    };

    this.delObject = function delObject(id, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = null;
        }
        id = this._fixId(id);
        this.objects.delObject(id, options, callback);
    };

    this.delForeignObject = function delForeignObject(id, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = null;
        }
        this.objects.delObject(id, options, callback);
    };

    this.subscribeObjects = function subscribeObjects(pattern, options) {
        if (pattern === '*') {
            this.objects.subscribe(`${this.namespace}.*`);
        } else {
            pattern = this._fixId(pattern);
            this.objects.subscribe(pattern, options);
        }
    };

    this.subscribeForeignObjects = function subscribeObjects(pattern, options) {
        this.objects.subscribe(pattern, options);
    };

    this.unsubscribeForeignObjects = function unsubscribeForeignObjects(pattern, options) {
        if (!pattern) {
            pattern = '*';
        }
        this.objects.unsubscribe(pattern, options);
    };

    this.unsubscribeObjects = function unsubscribeObjects(pattern, options) {
        if (pattern === '*') {
            this.objects.unsubscribe(`${this.namespace}.*`, options);
        } else {
            pattern = this._fixId(pattern);
            this.objects.unsubscribe(pattern);
        }
    };

    this.setObjectNotExists = function setObjectNotExists(id, object, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = null;
        }
        id = this._fixId(id);

        if (object.children || object.parent) {
            logger.warn(`Do not use parent or children for ${id}`);
        }

        this.objects.getObject(id, options, (err, obj) => {
            if (!obj) {
                this.objects.setObject(id, object, callback);
            }
        });
    };

    this.setForeignObjectNotExists = function setForeignObjectNotExists(id, obj, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = null;
        }
        this.objects.getObject(id, options, (err, obj) => {
            if (!obj) {
                this.objects.setObject(id, obj, callback);
            }
        });
    };

    this._DCS2ID = function (device, channel, stateOrPoint) {
        let id = '';
        if (device) {
            id += device;
        }
        if (channel) {
            id += (id ? '.' : '') + channel;
        }

        if (stateOrPoint !== true && stateOrPoint !== false) {
            if (stateOrPoint) {
                id += (id ? '.' : '') + stateOrPoint;
            }
        } else if (stateOrPoint === true) {
            if (id) {
                id += '.';
            }
        }
        return id;
    };

    this.createDevice = function createDevice(deviceName, common, _native, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = null;
        }
        if (!deviceName) {
            this.log.error('Try to create device with empty name!');
            return;
        }
        if (typeof _native === 'function') {
            callback = _native;
            _native = {};
        }
        if (typeof common === 'function') {
            callback = common;
            common = {};
        }
        common = common || {};
        common.name = common.name || deviceName;

        deviceName = deviceName.replace(/[.\s]+/g, '_');
        _native = _native || {};

        this.setObjectNotExists(
            deviceName,
            {
                type: 'device',
                common: common,
                native: _native,
            },
            options,
            callback,
        );
    };

    // name of channel must be in format 'channel'
    this.createChannel = function createChannel(parentDevice, channelName, roleOrCommon, _native, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = null;
        }
        if (!channelName) {
            throw 'Try to create channel without name!';
        }

        if (typeof _native === 'function') {
            callback = _native;
            _native = {};
        }

        if (typeof roleOrCommon === 'function') {
            callback = roleOrCommon;
            roleOrCommon = undefined;
        }

        let common = {};
        if (typeof roleOrCommon === 'string') {
            common = {
                role: roleOrCommon,
            };
        } else if (typeof roleOrCommon === 'object') {
            common = roleOrCommon;
        }
        common.name = common.name || channelName;

        if (parentDevice) {
            parentDevice = parentDevice.replace(/[.\s]+/g, '_');
        }
        channelName = channelName.replace(/[.\s]+/g, '_');
        channelName = this._DCS2ID(parentDevice, channelName);

        _native = _native || {};

        const obj = {
            type: 'channel',
            common: common,
            native: _native,
        };

        this.setObject(channelName, obj, options, callback);
    };

    this.createState = function createState(
        parentDevice,
        parentChannel,
        stateName,
        roleOrCommon,
        _native,
        options,
        callback,
    ) {
        if (typeof options === 'function') {
            callback = options;
            options = null;
        }
        if (!stateName) {
            throw 'Empty name is not allowed!';
        }

        if (typeof _native === 'function') {
            callback = _native;
            _native = {};
        }

        if (typeof roleOrCommon === 'function') {
            callback = roleOrCommon;
            roleOrCommon = undefined;
        }

        let common = {};
        if (typeof roleOrCommon === 'string') {
            common = {
                role: roleOrCommon,
            };
        } else if (typeof roleOrCommon === 'object') {
            common = roleOrCommon;
        }

        common.name = common.name || stateName;
        _native = _native || {};

        common.read = common.read === undefined ? true : common.read;
        common.write = common.write === undefined ? false : common.write;

        if (!common.role) {
            logger.error(
                `Try to create state ${parentDevice ? `${parentDevice}.` : ''}${parentChannel}.${
                    stateName
                } without role`,
            );
            return;
        }

        if (parentDevice) {
            parentDevice = parentDevice.replace(/[.\s]+/g, '_');
        }
        if (parentChannel) {
            parentChannel = parentChannel.replace(/[.\s]+/g, '_');
        }
        stateName = stateName.replace(/[.\s]+/g, '_');
        const id = this._fixId({ device: parentDevice, channel: parentChannel, state: stateName });

        this.setObjectNotExists(
            id,
            {
                type: 'state',
                common: common,
                native: _native,
            },
            options,
            callback,
        );

        if (common.def !== undefined) {
            this.setState(id, common.def, options);
        } else {
            this.setState(id, null, false, options);
        }
    };

    this.deleteDevice = function deleteDevice(deviceName, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = null;
        }
        deviceName = deviceName.replace(/[.\s]+/g, '_');
        if (!this._namespaceRegExp.test(deviceName)) {
            deviceName = `${this.namespace}.${deviceName}`;
        }

        this.objects.getObjectView(
            'system',
            'device',
            { startkey: deviceName, endkey: deviceName },
            options,
            (err, res) => {
                if (err || !res || !res.rows) {
                    if (typeof callback === 'function') {
                        callback(err);
                    }
                    callback = null;
                    return;
                }
                let cnt = 0;
                if (res.rows.length > 1) {
                    this.log.warn(`Found more than one device ${deviceName}`);
                }

                for (let t = 0; t < res.rows.length; t++) {
                    cnt++;
                    this.delObject(res.rows[t].id, options, err => {
                        if (err) {
                            if (typeof callback === 'function') {
                                callback(err);
                            }
                            callback = null;
                            return;
                        }

                        if (!--cnt) {
                            cnt = 0; // just to better understand
                            this.objects.getObjectView(
                                'system',
                                'channel',
                                { startkey: `${deviceName}.`, endkey: `${deviceName}.\u9999` },
                                options,
                                (err, res) => {
                                    if (err) {
                                        if (typeof callback === 'function') {
                                            callback(err);
                                        }
                                        return;
                                    }
                                    for (let k = 0; k < res.rows.length; k++) {
                                        cnt++;
                                        this.deleteChannel(deviceName, res.rows[k].id, options, err => {
                                            if (!--cnt && callback) {
                                                callback(err);
                                            } else {
                                                if (err) {
                                                    if (typeof callback === 'function') {
                                                        callback(err);
                                                    }
                                                    callback = null;
                                                }
                                            }
                                        });
                                    }
                                    if (!cnt && callback) {
                                        callback();
                                    }
                                },
                            );
                        }
                    });
                }
                if (!cnt && callback) {
                    callback();
                }
            },
        );
    };

    this.addChannelToEnum = function addChannelToEnum(enumName, addTo, parentDevice, channelName, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = null;
        }
        if (parentDevice) {
            if (this._namespaceRegExp.test(parentDevice)) {
                parentDevice = parentDevice.substring(this.namespace.length + 1);
            }
            parentDevice = parentDevice.replace(/[.\s]+/g, '_');
        }

        if (this._namespaceRegExp.test(channelName)) {
            channelName = channelName.substring(this.namespace.length + 1);
        }
        if (parentDevice && channelName.substring(0, parentDevice.length) === parentDevice) {
            channelName = channelName.substring(parentDevice.length + 1);
        }
        channelName = channelName.replace(/[.\s]+/g, '_');

        const objId = `${this.namespace}.${this._DCS2ID(parentDevice, channelName)}`;

        if (addTo.match(/^enum\./)) {
            this.objects.getObject(addTo, options, (err, obj) => {
                if (err) {
                    if (typeof callback === 'function') {
                        callback(err);
                    }
                    return;
                }
                if (!err && obj) {
                    const pos = obj.common.members.indexOf(objId);
                    if (pos === -1) {
                        obj.common.members.push(objId);
                        this.objects.setObject(obj._id, obj, options, err => {
                            if (callback) {
                                callback(err);
                            }
                        });
                    }
                }
            });
        } else {
            if (enumName.match(/^enum\./)) {
                enumName = enumName.substring(5);
            }

            this.objects.getObject(`enum.${enumName}.${addTo}`, options, (err, obj) => {
                if (err) {
                    if (typeof callback === 'function') {
                        callback(err);
                    }
                    return;
                }

                if (obj) {
                    const pos = obj.common.members.indexOf(objId);
                    if (pos === -1) {
                        obj.common.members.push(objId);
                        this.objects.setObject(obj._id, obj, options, callback);
                    } else {
                        if (callback) {
                            callback();
                        }
                    }
                } else {
                    // Create enum
                    this.objects.setObject(
                        `enum.${enumName}.${addTo}`,
                        {
                            common: {
                                name: addTo,
                                members: [objId],
                            },
                            type: 'enum',
                        },
                        options,
                        callback,
                    );
                }
            });
        }
    };

    this.deleteChannelFromEnum = function deleteChannelFromEnum(
        enumName,
        parentDevice,
        channelName,
        options,
        callback,
    ) {
        if (typeof options === 'function') {
            callback = options;
            options = null;
        }
        if (parentDevice) {
            if (parentDevice.substring(0, this.namespace.length) === this.namespace) {
                parentDevice = parentDevice.substring(this.namespace.length + 1);
            }
            parentDevice = parentDevice.replace(/[.\s]+/g, '_');
        }

        if (channelName && channelName.substring(0, this.namespace.length) === this.namespace) {
            channelName = channelName.substring(this.namespace.length + 1);
        }
        if (parentDevice && channelName && channelName.substring(0, parentDevice.length) === parentDevice) {
            channelName = channelName.substring(parentDevice.length + 1);
        }
        channelName = channelName || '';
        channelName = channelName.replace(/[.\s]+/g, '_');

        const objId = `${this.namespace}.${this._DCS2ID(parentDevice, channelName)}`;

        if (enumName) {
            enumName = `enum.${enumName}.`;
        } else {
            enumName = 'enum.';
        }

        this.objects.getObjectView(
            'system',
            'enum',
            { startkey: enumName, endkey: `${enumName}\u9999` },
            options,
            (err, res) => {
                if (err) {
                    if (typeof callback === 'function') {
                        callback(err);
                    }
                    return;
                }
                if (res) {
                    let count = 0;
                    for (let i = 0; i < res.rows.length; i++) {
                        count++;
                        this.objects.getObject(res.rows[i].id, options, (err, obj) => {
                            if (err) {
                                if (typeof callback === 'function') {
                                    callback(err);
                                }
                                callback = null;
                                return;
                            }
                            if (!err && obj && obj.common && obj.common.members) {
                                const pos = obj.common.members.indexOf(objId);
                                if (pos !== -1) {
                                    obj.common.members.splice(pos, 1);
                                    count++;
                                    this.objects.setObject(obj._id, obj, options, err => {
                                        if (!--count && callback) {
                                            callback(err);
                                        } else {
                                            if (err) {
                                                if (typeof callback === 'function') {
                                                    callback(err);
                                                }
                                                callback = null;
                                            }
                                        }
                                    });
                                }
                            }
                            count--;
                            if (!count && callback) {
                                callback(err);
                            }
                        });
                    }
                } else if (callback) {
                    callback(err);
                }
            },
        );
    };

    this.deleteChannel = function deleteChannel(parentDevice, channelName, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = null;
        }
        if (typeof channelName === 'function') {
            callback = channelName;
            channelName = parentDevice;
            parentDevice = '';
        }
        if (parentDevice && !channelName) {
            channelName = parentDevice;
            parentDevice = '';
        } else if (parentDevice && typeof channelName === 'function') {
            callback = channelName;
            channelName = parentDevice;
            parentDevice = '';
        }
        if (!parentDevice) {
            parentDevice = '';
        }
        this.deleteChannelFromEnum('', parentDevice, channelName);
        const _parentDevice = parentDevice;
        const _channelName = channelName;

        if (parentDevice) {
            if (this._namespaceRegExp.test(parentDevice)) {
                parentDevice = parentDevice.substring(this.namespace.length + 1);
            }
            parentDevice = parentDevice.replace(/[.\s]+/g, '_');
        }

        if (channelName && this._namespaceRegExp.test(channelName)) {
            channelName = channelName.substring(this.namespace.length + 1);
        }
        if (parentDevice && channelName && channelName.substring(0, parentDevice.length) === parentDevice) {
            channelName = channelName.substring(parentDevice.length + 1);
        }
        channelName = channelName || '';
        channelName = channelName.replace(/[.\s]+/g, '_');

        channelName = `${this.namespace}.${this._DCS2ID(parentDevice, channelName)}`;

        logger.info(`Delete channel ${channelName}`);

        this.objects.getObjectView(
            'system',
            'channel',
            { startkey: channelName, endkey: channelName },
            options,
            (err, res) => {
                if (err || !res || !res.rows) {
                    if (typeof callback === 'function') {
                        callback(err);
                    }
                    callback = null;
                    return;
                }
                let cnt = 0;
                if (res.rows.length > 1) {
                    this.log.warn(`Found more than one channel ${channelName}`);
                }

                for (let t = 0; t < res.rows.length; t++) {
                    cnt++;
                    this.delObject(res.rows[t].id, options, err => {
                        if (err) {
                            if (typeof callback === 'function') {
                                callback(err);
                            }
                            callback = null;
                            return;
                        }
                        cnt--;
                        if (!cnt) {
                            this.objects.getObjectView(
                                'system',
                                'state',
                                { startkey: `${channelName}.`, endkey: `${channelName}.\u9999` },
                                options,
                                (err, res) => {
                                    if (err || !res || !res.rows) {
                                        if (typeof callback === 'function') {
                                            callback(err);
                                        }
                                        callback = null;
                                        return;
                                    }
                                    for (let k = 0; k < res.rows.length; k++) {
                                        this.deleteState(_parentDevice, _channelName, res.rows[k].id, options, err => {
                                            if (!--cnt && callback) {
                                                callback(err);
                                            } else {
                                                if (err) {
                                                    if (typeof callback === 'function') {
                                                        callback(err);
                                                    }
                                                    callback = null;
                                                }
                                            }
                                        });
                                    }
                                    if (!cnt && callback) {
                                        callback();
                                    }
                                },
                            );
                        }
                    });
                }
                if (!cnt && callback) {
                    callback();
                }
            },
        );
    };

    this.deleteState = function deleteState(parentDevice, parentChannel, stateName, options, callback) {
        if (typeof parentChannel === 'function' && stateName === undefined) {
            stateName = parentDevice;
            callback = parentChannel;
            parentChannel = '';
            parentDevice = '';
        } else if (parentChannel === undefined && stateName === undefined) {
            stateName = parentDevice;
            parentDevice = '';
            parentChannel = '';
        } else {
            if (typeof options === 'function') {
                callback = options;
                options = null;
            }
            if (typeof stateName === 'function') {
                callback = stateName;
                stateName = parentChannel;
                parentChannel = parentDevice;
                parentDevice = '';
            }
            if (typeof parentChannel === 'function') {
                callback = parentChannel;
                stateName = parentDevice;
                parentChannel = '';
                parentDevice = '';
            }
            if (typeof parentChannel === 'function') {
                callback = parentChannel;
                stateName = parentDevice;
                parentChannel = '';
                parentDevice = '';
            }
        }

        this.deleteStateFromEnum('', parentDevice, parentChannel, stateName, options);

        if (parentDevice) {
            if (this._namespaceRegExp.test(parentDevice)) {
                parentDevice = parentDevice.substring(this.namespace.length + 1);
            }

            parentDevice = parentDevice.replace(/[.\s]+/g, '_');
        }

        if (parentChannel) {
            if (this._namespaceRegExp.test(parentChannel)) {
                parentChannel = parentChannel.substring(this.namespace.length + 1);
            }
            if (parentDevice && parentChannel.substring(0, parentDevice.length) === parentDevice) {
                parentChannel = parentChannel.substring(parentDevice.length + 1);
            }

            parentChannel = parentChannel.replace(/[.\s]+/g, '_');
        }

        if (this._namespaceRegExp.test(stateName)) {
            stateName = stateName.substring(this.namespace.length + 1);
        }
        if (parentDevice && stateName.substring(0, parentDevice.length) === parentDevice) {
            stateName = stateName.substring(parentDevice.length + 1);
        }
        if (parentChannel && stateName.substring(0, parentChannel.length) === parentChannel) {
            stateName = stateName.substring(parentChannel.length + 1);
        }
        stateName = stateName || '';
        stateName = stateName.replace(/[.\s]+/g, '_');

        const _name = this._DCS2ID(parentDevice, parentChannel, stateName);
        this.delState(_name, options, function () {
            this.delObject(_name, options, callback);
        });
    };

    this.getDevices = function getDevices(callback, options) {
        if (typeof options === 'function') {
            callback = options;
            options = null;
        }
        this.objects.getObjectView(
            'system',
            'device',
            { startkey: `${this.namespace}.`, endkey: `${this.namespace}.\u9999` },
            options,
            (err, obj) => {
                if (callback) {
                    if (obj.rows.length) {
                        const res = [];
                        for (let i = 0; i < obj.rows.length; i++) {
                            res.push(obj.rows[i].value);
                        }
                        callback(null, res);
                    } else {
                        callback(err, []);
                    }
                }
            },
        );
    };

    this.getChannelsOf = function getChannelsOf(parentDevice, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = null;
        }
        if (typeof parentDevice === 'function') {
            callback = parentDevice;
            parentDevice = null;
        }
        if (!parentDevice) {
            parentDevice = '';
        }

        if (parentDevice && this._namespaceRegExp.test(parentDevice)) {
            parentDevice = parentDevice.substring(this.namespace.length + 1);
        }

        parentDevice = parentDevice.replace(/[.\s]+/g, '_');
        parentDevice = this.namespace + (parentDevice ? `.${parentDevice}` : '');
        this.objects.getObjectView(
            'system',
            'channel',
            { startkey: `${parentDevice}.`, endkey: `${parentDevice}.\u9999` },
            options,
            (err, obj) => {
                if (callback) {
                    if (obj.rows.length) {
                        const res = [];
                        for (let i = 0; i < obj.rows.length; i++) {
                            res.push(obj.rows[i].value);
                        }
                        callback(null, res);
                    } else {
                        callback(err, []);
                    }
                }
            },
        );
    };

    this.getChannels = this.getChannelsOf;

    this.getStatesOf = function getStatesOf(parentDevice, parentChannel, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = null;
        }
        if (typeof parentDevice === 'function') {
            callback = parentDevice;
            parentDevice = null;
            parentChannel = null;
        }
        if (typeof parentChannel === 'function') {
            callback = parentChannel;
            parentChannel = null;
        }

        if (!parentDevice) {
            parentDevice = '';
        } else {
            if (this._namespaceRegExp.test(parentDevice)) {
                parentDevice = parentDevice.substring(this.namespace.length + 1);
            }

            parentDevice = parentDevice.replace(/[.\s]+/g, '_');
        }

        if (!parentChannel) {
            parentChannel = '';
        } else if (this._namespaceRegExp.test(parentChannel)) {
            parentChannel = parentChannel.substring(this.namespace.length + 1);
        }

        if (parentDevice && parentChannel && parentChannel.substring(0, parentDevice.length) === parentDevice) {
            parentChannel = parentChannel.substring(parentDevice.length + 1);
        }

        parentChannel = parentChannel.replace(/[.\s]+/g, '_');

        const id = `${this.namespace}.${this._DCS2ID(parentDevice, parentChannel, true)}`;

        this.objects.getObjectView('system', 'state', { startkey: id, endkey: `${id}\u9999` }, options, (err, obj) => {
            if (callback) {
                const res = [];
                if (obj.rows.length) {
                    let read = 0;
                    for (let i = 0; i < obj.rows.length; i++) {
                        read++;
                        this.objects.getObject(obj.rows[i].id, (err, subObj) => {
                            if (subObj) {
                                res.push(subObj);
                            }

                            if (!--read) {
                                callback(null, res);
                            }
                        });
                    }
                } else {
                    callback(null, res);
                }
            }
        });
    };

    this.addStateToEnum = function addStateToEnum(
        enumName,
        addTo,
        parentDevice,
        parentChannel,
        stateName,
        options,
        callback,
    ) {
        if (typeof options === 'function') {
            callback = options;
            options = null;
        }
        if (parentDevice) {
            if (this._namespaceRegExp.test(parentDevice)) {
                parentDevice = parentDevice.substring(this.namespace.length + 1);
            }

            parentDevice = parentDevice.replace(/[.\s]+/g, '_');
        }

        if (parentChannel) {
            if (this._namespaceRegExp.test(parentChannel)) {
                parentChannel = parentChannel.substring(this.namespace.length + 1);
            }
            if (parentDevice && parentChannel.substring(0, parentDevice.length) === parentDevice) {
                parentChannel = parentChannel.substring(parentDevice.length + 1);
            }

            parentChannel = parentChannel.replace(/[.\s]+/g, '_');
        }

        if (this._namespaceRegExp.test(stateName)) {
            stateName = stateName.substring(this.namespace.length + 1);
        }
        if (parentDevice && stateName.substring(0, parentDevice.length) === parentDevice) {
            stateName = stateName.substring(parentDevice.length + 1);
        }
        if (parentChannel && stateName.substring(0, parentChannel.length) === parentChannel) {
            stateName = stateName.substring(parentChannel.length + 1);
        }
        stateName = stateName.replace(/[.\s]+/g, '_');

        const objId = this._fixId({ device: parentDevice, channel: parentChannel, state: stateName });

        if (addTo.match(/^enum\./)) {
            this.objects.getObject(addTo, options, (err, obj) => {
                if (!err && obj) {
                    const pos = obj.common.members.indexOf(objId);
                    if (pos === -1) {
                        obj.common.members.push(objId);
                        this.objects.setObject(obj._id, obj, options, err => {
                            if (callback) {
                                callback(err);
                            }
                        });
                    }
                }
            });
        } else {
            if (enumName.match(/^enum\./)) {
                enumName = enumName.substring(5);
            }

            this.objects.getObject(`enum.${enumName}.${addTo}`, options, (err, obj) => {
                if (!err && obj) {
                    const pos = obj.common.members.indexOf(objId);
                    if (pos === -1) {
                        obj.common.members.push(objId);
                        this.objects.setObject(obj._id, obj, callback);
                    } else {
                        if (callback) {
                            callback();
                        }
                    }
                } else {
                    if (err) {
                        if (typeof callback === 'function') {
                            callback(err);
                        }
                        return;
                    }

                    // Create enum
                    this.objects.setObject(
                        `enum.${enumName}.${addTo}`,
                        {
                            common: {
                                name: addTo,
                                members: [objId],
                            },
                            type: 'enum',
                        },
                        options,
                        callback,
                    );
                }
            });
        }
    };

    this.deleteStateFromEnum = function deleteStateFromEnum(
        enumName,
        parentDevice,
        parentChannel,
        stateName,
        options,
        callback,
    ) {
        if (typeof options === 'function') {
            callback = options;
            options = null;
        }
        if (parentDevice) {
            if (this._namespaceRegExp.test(parentDevice)) {
                parentDevice = parentDevice.substring(this.namespace.length + 1);
            }

            parentDevice = parentDevice.replace(/[.\s]+/g, '_');
        }

        if (parentChannel) {
            if (this._namespaceRegExp.test(parentChannel)) {
                parentChannel = parentChannel.substring(this.namespace.length + 1);
            }
            if (parentDevice && parentChannel.substring(0, parentDevice.length) === parentDevice) {
                parentChannel = parentChannel.substring(parentDevice.length + 1);
            }

            parentChannel = parentChannel.replace(/[.\s]+/g, '_');
        }

        if (this._namespaceRegExp.test(stateName)) {
            stateName = stateName.substring(this.namespace.length + 1);
        }
        if (parentDevice && stateName.substring(0, parentDevice.length) === parentDevice) {
            stateName = stateName.substring(parentDevice.length + 1);
        }
        if (parentChannel && stateName.substring(0, parentChannel.length) === parentChannel) {
            stateName = stateName.substring(parentChannel.length + 1);
        }
        stateName = stateName.replace(/[.\s]+/g, '_');

        const objId = this._fixId({ device: parentDevice, channel: parentChannel, state: stateName }, 'state');

        if (enumName) {
            enumName = `enum.${enumName}.`;
        } else {
            enumName = 'enum.';
        }

        this.objects.getObjectView(
            'system',
            'enum',
            { startkey: enumName, endkey: `${enumName}\u9999` },
            options,
            (err, res) => {
                if (!err && res) {
                    let count = 0;
                    for (let i = 0; i < res.rows.length; i++) {
                        count++;
                        this.objects.getObject(res.rows[i].id, options, (err, obj) => {
                            if (err) {
                                if (callback) {
                                    callback(err);
                                }
                                callback = null;
                                return;
                            }

                            if (!err && obj && obj.common && obj.common.members) {
                                const pos = obj.common.members.indexOf(objId);
                                if (pos !== -1) {
                                    obj.common.members.splice(pos, 1);
                                    count++;
                                    this.objects.setObject(obj._id, obj, err => {
                                        if (!--count && callback) {
                                            callback(err);
                                        }
                                    });
                                }
                            }
                            if (!--count && callback) {
                                callback(err);
                            }
                        });
                    }
                } else if (callback) {
                    callback(err);
                }
            },
        );
    };

    this.chmodFile = function readDir(adapter, path, options, callback) {
        if (adapter === null) {
            adapter = this.name;
        }

        if (typeof options === 'function') {
            callback = options;
            options = null;
        }

        this.objects.chmodFile(adapter, path, options, callback);
    };

    this.readDir = function readDir(adapter, path, options, callback) {
        if (adapter === null) {
            adapter = this.name;
        }

        if (typeof options === 'function') {
            callback = options;
            options = null;
        }

        this.objects.readDir(adapter, path, options, callback);
    };

    this.unlink = function unlink(adapter, name, options, callback) {
        if (adapter === null) {
            adapter = this.name;
        }

        if (typeof options === 'function') {
            callback = options;
            options = null;
        }

        this.objects.unlink(adapter, name, options, callback);
    };

    this.rename = function rename(adapter, oldName, newName, options, callback) {
        if (adapter === null) {
            adapter = this.name;
        }
        if (typeof options === 'function') {
            callback = options;
            options = null;
        }
        this.objects.rename(adapter, oldName, newName, options, callback);
    };

    this.mkdir = function mkdir(adapter, dirname, options, callback) {
        if (adapter === null) {
            adapter = this.name;
        }
        if (typeof options === 'function') {
            callback = options;
            options = null;
        }

        this.objects.mkdir(adapter, dirname, options, callback);
    };

    this.readFile = function readFile(adapter, filename, options, callback) {
        if (adapter === null) {
            adapter = this.name;
        }

        if (typeof options === 'function') {
            callback = options;
            options = null;
        }

        this.objects.readFile(adapter, filename, options, callback);
    };

    this.writeFile = function writeFile(adapter, filename, data, options, callback) {
        if (adapter === null) {
            adapter = this.name;
        }

        if (typeof options === 'function') {
            callback = options;
            options = null;
        }

        this.objects.writeFile(adapter, filename, data, options, callback);
    };

    this.formatDate = function formatDate(dateObj, isSeconds, _format) {
        if (typeof isSeconds !== 'boolean') {
            _format = isSeconds;
            isSeconds = false;
        }

        let format = _format || this.dateFormat || 'DD.MM.YYYY';

        if (!dateObj) {
            return '';
        }
        const text = typeof dateObj;
        if (text === 'string') {
            const pos = dateObj.indexOf('.');
            if (pos !== -1) {
                dateObj = dateObj.substring(0, pos);
            }
            return dateObj;
        }
        if (text !== 'object') {
            dateObj = isSeconds ? new Date(dateObj * 1000) : new Date(dateObj);
        }

        let v;

        // Year
        if (format.indexOf('YYYY') !== -1 || format.indexOf('JJJJ') !== -1 || format.indexOf('ГГГГ') !== -1) {
            v = dateObj.getFullYear();
            format = format.replace('YYYY', v);
            format = format.replace('JJJJ', v);
            format = format.replace('ГГГГ', v);
        } else if (format.indexOf('YY') !== -1 || format.indexOf('JJ') !== -1 || format.indexOf('ГГ') !== -1) {
            v = dateObj.getFullYear() % 100;
            format = format.replace('YY', v);
            format = format.replace('JJ', v);
            format = format.replace('ГГ', v);
        }
        // Month
        if (format.indexOf('MM') !== -1 || format.indexOf('ММ') !== -1) {
            v = dateObj.getMonth() + 1;
            if (v < 10) {
                v = `0${v}`;
            }
            format = format.replace('MM', v);
            format = format.replace('ММ', v);
        } else if (format.indexOf('M') !== -1 || format.indexOf('М') !== -1) {
            v = dateObj.getMonth() + 1;
            format = format.replace('M', v);
            format = format.replace('М', v);
        }

        // Day
        if (format.indexOf('DD') !== -1 || format.indexOf('TT') !== -1 || format.indexOf('ДД') !== -1) {
            v = dateObj.getDate();
            if (v < 10) {
                v = `0${v}`;
            }
            format = format.replace('DD', v);
            format = format.replace('TT', v);
            format = format.replace('ДД', v);
        } else if (format.indexOf('D') !== -1 || format.indexOf('TT') !== -1 || format.indexOf('Д') !== -1) {
            v = dateObj.getDate();
            format = format.replace('D', v);
            format = format.replace('T', v);
            format = format.replace('Д', v);
        }

        // hours
        if (format.indexOf('hh') !== -1 || format.indexOf('SS') !== -1 || format.indexOf('чч') !== -1) {
            v = dateObj.getHours();
            if (v < 10) {
                v = `0${v}`;
            }
            format = format.replace('hh', v);
            format = format.replace('SS', v);
            format = format.replace('чч', v);
        } else if (format.indexOf('h') !== -1 || format.indexOf('S') !== -1 || format.indexOf('ч') !== -1) {
            v = dateObj.getHours();
            format = format.replace('h', v);
            format = format.replace('S', v);
            format = format.replace('ч', v);
        }

        // minutes
        if (format.indexOf('mm') !== -1 || format.indexOf('мм') !== -1) {
            v = dateObj.getMinutes();
            if (v < 10) {
                v = `0${v}`;
            }
            format = format.replace('mm', v);
            format = format.replace('мм', v);
        } else if (format.indexOf('m') !== -1 || format.indexOf('м') !== -1) {
            v = dateObj.getMinutes();
            format = format.replace('m', v);
            format = format.replace('v', v);
        }

        // seconds
        if (format.indexOf('ss') !== -1 || format.indexOf('сс') !== -1) {
            v = dateObj.getSeconds();
            if (v < 10) {
                v = `0${v}`;
            }
            v = v.toString();
            format = format.replace('ss', v);
            format = format.replace('cc', v);
        } else if (format.indexOf('s') !== -1 || format.indexOf('с') !== -1) {
            v = dateObj.getHours().toString();
            format = format.replace('s', v);
            format = format.replace('с', v);
        }
        return format;
    };

    return this;
}

module.exports = Objects;
