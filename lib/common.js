'use strict';

function convertID2topic(id, pattern, prefix, namespace, removePrefix) {
    let topic;
    id = (id || '').toString();
    if (id.startsWith(removePrefix)) {
        id = id.substring(removePrefix.length);
    }
    if (pattern && pattern.startsWith(prefix + namespace)) {
        topic = prefix + id;
    } else if (pattern && pattern.startsWith(namespace)) {
        topic = id;
    } else if (prefix && pattern && pattern.startsWith(prefix)) {
        topic = prefix + id;// .substring(namespace.length + 1);
    } else if (id.startsWith(namespace)) {
        topic = (prefix || '') + id.substring(namespace.length + 1);
    } else {
        topic = (prefix || '') + id;
    }
    topic = topic.replace(/\./g, '/');
    topic = topic.replace(/[+#]/g, '_');
    return topic;
}

function state2string(val, sendStateObject) {
    if (sendStateObject === undefined || sendStateObject === null) {
        sendStateObject = false;
    }

    if (val && typeof val === 'object') {
        if (val.val === null) {
            return 'null';
        } else {
            return  val.val === null ? 'null' : (val.val === undefined ? 'undefined' : (sendStateObject === true ? JSON.stringify(val) : val.val.toString()));
        }
    } else {
        return val === null ? 'null' : (val === undefined ? 'undefined' : (sendStateObject === true ? JSON.stringify(val) : val.toString()));
    }
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

    if (!dontCutNamespace && topic.substring(0, namespace.length) === namespace) {
        topic = topic.substring(namespace.length + 1);
    }

    return topic;
}

exports.convertTopic2id = convertTopic2id;
exports.convertID2topic = convertID2topic;
exports.state2string    = state2string;
