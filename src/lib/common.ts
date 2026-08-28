import type { MqttClientID, MqttPattern, MqttTopic } from './types';

const IOBROKER_STATE_PROPERTIES = ['val', 'ack', 'ts', 'q', 'lc', 'from', 'expire', 'user', 'c'];

export function convertID2topic(
    id: string,
    pattern: MqttPattern | null,
    prefix: string,
    namespace: `${string}.${number}`,
    removePrefix: string,
): string {
    let topic;
    id = (id || '').toString();
    if (id.startsWith(removePrefix)) {
        id = id.substring(removePrefix.length);
    }
    if (pattern?.startsWith(prefix + namespace)) {
        topic = prefix + id;
    } else if (pattern?.startsWith(namespace)) {
        topic = id;
    } else if (prefix && pattern?.startsWith(prefix)) {
        topic = prefix + id; // .substring(namespace.length + 1);
    } else if (id.startsWith(namespace)) {
        topic = (prefix || '') + id.substring(namespace.length + 1);
    } else {
        topic = (prefix || '') + id;
    }
    topic = topic.replace(/\./g, '/');
    topic = topic.replace(/[+#]/g, '_');
    return topic;
}

// Characters that do not survive ID → topic → ID: "+"/"#" are replaced with "_" by
// convertID2topic (MQTT wildcards), whitespace by convertTopic2id.
const LOSSY_ID_CHARS = /[+#\s]/;

/**
 * Finds the published state ID a topic was built from, e.g. the Shelly ID
 * "shelly.0.SHCB-1#3494546B9BEC#1" for the topic "shelly/0/SHCB-1_3494546B9BEC_1".
 *
 * `convertTopic2id` cannot restore such an ID, and the `topic2id` cache only holds the mapping
 * once the state has been published — on a miss the value would end up in a newly created state
 * in our own namespace. Only IDs that cannot round-trip are checked, so every other topic keeps
 * being resolved by the normal object lookup.
 *
 * @param topic The received topic (already stripped of a possible "/set" suffix)
 * @param states The states this adapter publishes
 * @param prefix The configured topic prefix
 * @param namespace The adapter namespace
 * @param removePrefix The configured ID prefix to remove
 * @returns The state ID, or undefined if no published state matches
 */
export function findIdForTopic(
    topic: MqttTopic,
    states: Record<string, ioBroker.State>,
    prefix: string,
    namespace: `${string}.${number}`,
    removePrefix: string,
): string | undefined {
    if (!topic) {
        return undefined;
    }
    for (const id of Object.keys(states)) {
        if (!LOSSY_ID_CHARS.test(id)) {
            continue;
        }
        if (convertID2topic(id, null, prefix, namespace, removePrefix) === topic) {
            return id;
        }
    }
    return undefined;
}

/**
 * Splits a MQTT 5 shared subscription filter into its share name and the real topic filter.
 *
 * A shared subscription looks like `$share/{ShareName}/{filter}`; every message matching `filter`
 * goes to exactly one member of the group `ShareName` (MQTT-5.0 4.8.2). The share name must not be
 * empty and must not contain a wildcard or a level separator, otherwise the filter is not a valid
 * shared subscription.
 *
 * @param topic The topic filter of a SUBSCRIBE or UNSUBSCRIBE packet
 * @returns The share name (undefined for a normal subscription) and the filter to match against
 */
export function parseSharedTopic(topic: MqttTopic): { shareName?: string; filter: MqttTopic } {
    if (!topic?.startsWith('$share/')) {
        return { filter: topic };
    }

    const rest = topic.substring('$share/'.length);
    const separator = rest.indexOf('/');

    // "$share/group" without a filter, or an empty share name, is not a shared subscription
    if (separator <= 0 || separator === rest.length - 1) {
        return { filter: topic };
    }

    const shareName = rest.substring(0, separator);
    if (shareName.includes('+') || shareName.includes('#')) {
        return { filter: topic };
    }

    return { shareName, filter: rest.substring(separator + 1) };
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
export function pattern2RegEx(
    pattern: MqttPattern,
    adapter: ioBroker.Adapter,
    prefix: string,
    dotToUnderscore?: boolean,
): string {
    pattern = convertTopic2id(pattern, true, prefix, adapter.namespace, dotToUnderscore);
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
    } else {
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
export function isIgnoredTopic(topic: MqttTopic, ignoredTopicsRegexes: RegExp[]): boolean {
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

/**
 * Checks whether a received topic must be stored as a file (raw binary payload).
 * Binary states were removed from the js-controller, so binary payloads (e.g. compressed
 * images or map data) are written into the adapter's file storage instead of a state.
 *
 * @param topic The topic (already converted to an ioBroker id) to check
 * @param binaryTopicsRegexes The compiled binary-topics filter
 * @returns Whether the payload should be stored as a file
 */
export function isBinaryTopic(topic: MqttTopic, binaryTopicsRegexes: RegExp[]): boolean {
    for (const regex of binaryTopicsRegexes) {
        if (regex.test(topic)) {
            return true;
        }
    }
    return false;
}

/**
 * Builds the file name (inside the adapter's own file storage) for a binary topic.
 * The slash-separated MQTT topic is used directly as a path, e.g. "valetudo/robot/map".
 * A leading slash and any "." / ".." segments are stripped to keep the path safe.
 *
 * @param topic The MQTT topic
 * @returns A safe relative file path
 */
export function topic2filename(topic: MqttTopic): string {
    return topic
        .replace(/^\/+/, '')
        .split('/')
        .filter(part => part && part !== '.' && part !== '..')
        .join('/');
}

/**
 * Loop protection for client mode (see issue #414).
 *
 * When the adapter stores a message received from the broker as an ioBroker state, that write
 * triggers a state change which — if the adapter also publishes its own namespace — would be sent
 * straight back to the broker. The broker echoes it, the adapter stores it again, and so on: an
 * endless loop. To break it we remember the last value written for a state because it was received
 * from the broker (together with a timestamp) and suppress publishing an outgoing value that is
 * still the very same, received-from-broker value within `intervalMs`.
 *
 * @param lastReceived The last value received from the broker for this id (serialized) and its timestamp, or undefined
 * @param outgoing The value that is about to be published (serialized the same way as `lastReceived.val`)
 * @param now The current timestamp in ms
 * @param intervalMs The suppression window in ms; `0` (or a falsy value) disables the protection entirely
 * @returns Whether the outgoing publish should be suppressed because it is an echo
 */
export function isEchoOfReceived(
    lastReceived: { val: string; ts: number } | undefined,
    outgoing: string,
    now: number,
    intervalMs: number,
): boolean {
    if (!intervalMs || !lastReceived) {
        return false;
    }
    return lastReceived.val === outgoing && now - lastReceived.ts <= intervalMs;
}

export function state2string(val: ioBroker.StateValue | ioBroker.State, sendStateObject?: boolean | null): string {
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

export function convertTopic2id(
    topic: MqttTopic,
    dontCutNamespace: boolean,
    prefix: string,
    namespace: `${string}.${number}`,
    dotToUnderscore?: boolean,
): string {
    if (!topic) {
        return topic;
    }

    // Remove own prefix if
    if (prefix && topic.substring(0, prefix.length) === prefix) {
        topic = topic.substring(prefix.length);
    }

    // In MQTT the only level separator is "/" — a "." is a normal character inside a topic level
    // name (e.g. Wolf heating via ism7mqtt sends "HK1.Vorlauftemperatur"). ioBroker however uses
    // "." as its object hierarchy separator, so such a "." would create extra object levels.
    // When enabled, replace every "." in the topic name with "_" so it stays a single level.
    // See issue #413.
    if (dotToUnderscore) {
        topic = topic.replace(/\./g, '_');
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

export async function ensureObjectStructure(
    adapter: ioBroker.Adapter,
    id: string,
    verifiedObjects: Record<string, boolean>,
): Promise<void> {
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
        } catch {
            // ignore
        }
        if (
            obj?.type === 'folder' &&
            obj.native &&
            !obj.native.autocreated &&
            !Object.keys(obj.native).length &&
            obj.common?.name === part
        ) {
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
            } catch (err) {
                adapter.log.info(`Can not create parent folder object: ${(err as Error).message}`);
            }
        }
        verifiedObjects[idToCheck] = true;
    }
}

export function convertMessage(
    topic: MqttTopic,
    message: any,
    adapter: ioBroker.Adapter,
    parseCharCodes: boolean,
    clientID?: MqttClientID,
):
    | { message: string | number | boolean | Record<string, any>; isStateObject: false }
    | { message: ioBroker.State; isStateObject: true } {
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
            const stateObj: ioBroker.State = JSON.parse(message);
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
        } catch {
            if (clientID) {
                adapter.log.debug(`Client [${clientID}] Invalid JSON for "${topic}": ${message}`);
            } else {
                adapter.log.debug(`Invalid JSON for "${topic}": ${message}`);
            }
        }
    }

    return { message, isStateObject: false };
}
