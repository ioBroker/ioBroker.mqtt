"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertID2topic = convertID2topic;
exports.pattern2RegEx = pattern2RegEx;
exports.isIgnoredTopic = isIgnoredTopic;
exports.state2string = state2string;
exports.convertTopic2id = convertTopic2id;
exports.ensureObjectStructure = ensureObjectStructure;
exports.convertMessage = convertMessage;
const IOBROKER_STATE_PROPERTIES = ['val', 'ack', 'ts', 'q', 'lc', 'from', 'expire', 'user', 'c'];
function convertID2topic(id, pattern, prefix, namespace, removePrefix) {
    let topic;
    id = (id || '').toString();
    if (id.startsWith(removePrefix)) {
        id = id.substring(removePrefix.length);
    }
    if (pattern?.startsWith(prefix + namespace)) {
        topic = prefix + id;
    }
    else if (pattern?.startsWith(namespace)) {
        topic = id;
    }
    else if (prefix && pattern?.startsWith(prefix)) {
        topic = prefix + id; // .substring(namespace.length + 1);
    }
    else if (id.startsWith(namespace)) {
        topic = (prefix || '') + id.substring(namespace.length + 1);
    }
    else {
        topic = (prefix || '') + id;
    }
    topic = topic.replace(/\./g, '/');
    topic = topic.replace(/[+#]/g, '_');
    return topic;
}
/*4.7.1.3 Single level wildcard

 The plus sign (‘+’ U+002B) is a wildcard character that matches only one topic level.

 The single-level wildcard can be used at any level in the Topic Filter, including first and last levels. Where it is used it MUST occupy an entire level of the filter [MQTT-4.7.1-3]. It can be used at more than one level in the Topic Filter and can be used in conjunction with the multilevel wildcard.

 Non-normative comment.
 For example, “sport/tennis/+” matches “sport/tennis/player1” and “sport/tennis/player2”, but not “sport/tennis/player1/ranking”. Also, because the single-level wildcard matches only a single level, “sport/+” does not match “sport” but it does match “sport/”.

 Non-normative comment
 ·         “+” is valid
 ·         “+/tennis/#” is valid
 ·         “sport+” is not valid
 ·         “sport/+/player1” is valid
 ·         “/finance” matches “+/+” and “/+”, but not “+”
 */
function pattern2RegEx(pattern, adapter, prefix) {
    pattern = convertTopic2id(pattern, true, prefix, adapter.namespace);
    pattern = pattern.replace(/#/g, '*');
    pattern = pattern.replace(/\$/g, '\\$');
    pattern = pattern.replace(/\^/g, '\\^');
    if (pattern !== '*') {
        if (pattern[0] === '*' && pattern[pattern.length - 1] !== '*') {
            pattern += '$';
        }
        if (pattern[0] !== '*' && pattern[pattern.length - 1] === '*') {
            pattern = `^${pattern}`;
        }
        if (pattern[0] === '+') {
            pattern = `^[^.]*${pattern.substring(1)}`;
        }
        if (pattern[pattern.length - 1] === '+') {
            pattern = `${pattern.substring(0, pattern.length - 1)}[^.]*$`;
        }
    }
    else {
        return '.*';
    }
    pattern = pattern.replace(/\./g, '\\.');
    pattern = pattern.replace(/\\\.\*/g, '(\\..*)?$');
    pattern = pattern.replace(/\+/g, '[^.]*');
    return pattern;
}
/**
 * Checks whether a received topic should be ignored
 *
 * @param topic The topic to check
 * @param ignoredTopicsRegexes The ignored topics filter
 * @returns Whether it should be ignored
 */
function isIgnoredTopic(topic, ignoredTopicsRegexes) {
    if (ignoredTopicsRegexes.length === 0) {
        return false;
    }
    for (const regex of ignoredTopicsRegexes) {
        if (regex.test(topic)) {
            return true;
        }
    }
    return false;
}
function state2string(val, sendStateObject) {
    if (sendStateObject === undefined || sendStateObject === null) {
        sendStateObject = false;
    }
    if (val && typeof val === 'object') {
        if (val.val === null) {
            return 'null';
        }
        return val.val === null
            ? 'null'
            : val.val === undefined
                ? 'undefined'
                : sendStateObject === true
                    ? JSON.stringify(val)
                    : val.val.toString();
    }
    return val === null
        ? 'null'
        : val === undefined
            ? 'undefined'
            : sendStateObject === true
                ? JSON.stringify(val)
                : val.toString();
}
function convertTopic2id(topic, dontCutNamespace, prefix, namespace) {
    if (!topic) {
        return topic;
    }
    // Remove own prefix if
    if (prefix && topic.substring(0, prefix.length) === prefix) {
        topic = topic.substring(prefix.length);
    }
    topic = topic.replace(/\//g, '.').replace(/\s/g, '_');
    if (topic[0] === '.') {
        topic = topic.substring(1);
    }
    if (topic[topic.length - 1] === '.') {
        topic = topic.substring(0, topic.length - 1);
    }
    if (!dontCutNamespace && topic.startsWith(namespace)) {
        topic = topic.substring(namespace.length + 1);
    }
    // If someone sent a training / we remove it
    if (topic.endsWith('.')) {
        topic = topic.substring(0, topic.length - 1);
    }
    return topic;
}
async function ensureObjectStructure(adapter, id, verifiedObjects) {
    if (!id.startsWith(`${adapter.namespace}.`)) {
        return;
    }
    if (verifiedObjects[id] === true) {
        return;
    }
    id = id.substring(adapter.namespace.length + 1);
    let idToCheck = adapter.namespace;
    const idArr = id.split('.');
    idArr.pop(); // the last is created as an object in any way
    verifiedObjects[id] = true;
    for (const part of idArr) {
        idToCheck += `.${part}`;
        if (verifiedObjects[idToCheck] === true) {
            continue;
        }
        verifiedObjects[idToCheck] = true;
        let obj;
        try {
            obj = await adapter.getForeignObjectAsync(idToCheck);
        }
        catch {
            // ignore
        }
        if (obj?.type === 'folder' &&
            obj.native &&
            !obj.native.autocreated &&
            !Object.keys(obj.native).length &&
            obj.common?.name === part) {
            // Object from the very first auto-create try
            // We re-create the object with our reason identifier
            obj = null;
        }
        if (!obj?.common) {
            adapter.log.debug(`Create folder object for ${idToCheck}`);
            try {
                await adapter.setForeignObjectAsync(idToCheck, {
                    type: 'folder',
                    common: {
                        name: part,
                    },
                    native: {
                        autocreated: 'by automatic ensure logic',
                    },
                });
            }
            catch (err) {
                adapter.log.info(`Can not create parent folder object: ${err.message}`);
            }
        }
        verifiedObjects[idToCheck] = true;
    }
}
function convertMessage(topic, message, adapter, parseCharCodes, clientID) {
    let type = typeof message;
    if (type !== 'string' && type !== 'number' && type !== 'boolean') {
        message = message ? message.toString('utf8') : 'null';
        type = 'string';
    }
    // Optionally convert "101,124,444,..." to a utf8 string. Off by default: devices like NUKI
    // locks send comma-separated numbers (e.g. "3,0,442236930,1,2") that are not character codes,
    // so interpreting them as such produced garbled values (see issue #550 / PR #551).
    if (type === 'string' && parseCharCodes && message.match(/^\d+,\s?\d+,\s?\d+/)) {
        const parts = message.split(',');
        let str = '';
        let allValidCharCodes = true;
        for (let p = 0; p < parts.length; p++) {
            const charCode = parseInt(parts[p].trim(), 10);
            // Only values that map reliably via String.fromCharCode (0-255, extended ASCII) are accepted.
            if (Number.isNaN(charCode) || charCode < 0 || charCode > 255) {
                allValidCharCodes = false;
                break;
            }
            str += String.fromCharCode(charCode);
        }
        // Only use the converted string if every part was a valid character code; otherwise keep the
        // original message so it can still be parsed as a number / JSON / raw string below.
        if (allValidCharCodes) {
            return { message: str, isStateObject: false };
        }
    }
    if (type === 'string') {
        // Try to convert value
        const _val = message.replace(',', '.');
        if (isFinite(_val)) {
            return { message: parseFloat(_val), isStateObject: false };
        }
        if (message === 'true') {
            return { message: true, isStateObject: false };
        }
        if (message === 'false') {
            return { message: false, isStateObject: false };
        }
    }
    if (type === 'string' && message[0] === '{') {
        try {
            const stateObj = JSON.parse(message);
            if (stateObj.val !== undefined) {
                // When object has a "val" attribute, then we check if only valid ioBroker
                // state attributes are included before we handle it as an iobroker state object
                let valid = true;
                for (const attr of Object.keys(stateObj)) {
                    // Just check the known attributes by name, ignore type for now
                    if (!IOBROKER_STATE_PROPERTIES.includes(attr)) {
                        valid = false;
                        break;
                    }
                }
                if (valid) {
                    return { message: stateObj, isStateObject: true };
                }
            }
        }
        catch {
            if (clientID) {
                adapter.log.debug(`Client [${clientID}] Invalid JSON for "${topic}": ${message}`);
            }
            else {
                adapter.log.debug(`Invalid JSON for "${topic}": ${message}`);
            }
        }
    }
    return { message, isStateObject: false };
}
//# sourceMappingURL=common.js.map