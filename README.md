<img src="admin/mqtt.svg" width="100" height="100">

# ioBroker MQTT

![Number of Installations](https://iobroker.live/badges/mqtt-installed.svg)
![Number of Installations](https://iobroker.live/badges/mqtt-stable.svg)
[![NPM version](https://img.shields.io/npm/v/iobroker.mqtt.svg)](https://www.npmjs.com/package/iobroker.mqtt)

![Test and Release](https://github.com/ioBroker/ioBroker.mqtt/workflows/Test%20and%20Release/badge.svg)
[![Translation status](https://weblate.iobroker.net/widgets/adapters/-/mqtt/svg-badge.svg)](https://weblate.iobroker.net/engage/adapters/?utm_source=widget)
[![Downloads](https://img.shields.io/npm/dm/iobroker.mqtt.svg)](https://www.npmjs.com/package/iobroker.mqtt)

**This adapter uses Sentry libraries to automatically report exceptions and code errors to the developers.** For more details and for information on how to disable the error reporting, see [Sentry-Plugin Documentation](https://github.com/ioBroker/plugin-sentry#plugin-sentry)! Sentry reporting is used starting with js-controller 3.0.

## MQ Telemetry Transport for ioBroker (MQTT).

MQTT (formerly Message Queue Telemetry Transport) is a publish-subscribe based "light weight" messaging protocol for use on top of the TCP/IP protocol.
It is designed for connections with remote locations where a "small code footprint" is required and/or network bandwidth is limited.
The Publish-Subscribe messaging pattern requires a message broker. The broker is responsible for distributing messages to interested clients based on the topic of a message.
Historically, the 'MQ' in 'MQTT' came from IBM's MQ message queuing product line.

This adapter uses the MQTT.js library from [https://github.com/adamvr/MQTT.js/](https://github.com/adamvr/MQTT.js/)

## Configuration
- **Type** - Select "Client" (If you want to receive and send messages to another broker) or "Server" if you want to create your own MQTT broker.

### Server settings
- **WebSockets** - if parallel to TCP Server, the WebSocket MQTT Server should run.
- **Port** - Port where the server will run (Default 1883). **WebSockets** will always run on port+1 (Default 1884)
- **SSL** - If TCP and WebSockets should run as secure server.
- **Authentication/Username** - If authentication is required, you can specify the username. It is suggested to always use SSL with authentication to not send passwords over unsecure connection.  
- **Authentication/Password** - Password for user.
- **Mask to publish own states** - Pattern to filter ioBroker states, which will be sent to clients. You can use wildcards to specify a group of messages, e.g., `*.memRss, mqtt.0.*` to get all memory states of all adapters and all states of adapter `mqtt.0`
- **Publish only on change** - New messages will be sent to a client only if the state value changes. Every message sent by the client will be accepted, even if the value does not change.
- **Publish own states on connect** - by every client connection the all known states will be sent to a client (defined by the state mask), to tell him which states the ioBroker has.
- **Prefix for all topics** - if set, every sent topic will be prepended with this prefix, e.g., if prefix `iobroker/` all states will have names like `**iobroker**/mqtt/0/connected`
- **Trace output for every message** - Debug outputs.
- **Send states (ack=true) too** - Normally only the states/commands with `ack=false` will be sent to partner. If this flag is set, every state independent of ack will be sent to partner. 
- **Use different topic names for set and get** - if active, so every state will have two topics: `adapter/instance/stateName` and `adapter/instance/stateName/set`. In this case, a topic with `/set` will be used to send non acknowledged commands (ack: false) and topic without `/set` to receive state updates (with ack: true). The client will receive sent messages back in this mode.
- **Interval before sending topics by connection** - Pause between connection and when all topics will be sent to a client (if activated).
- **Send interval** - Interval between packets by sending all topics (if activated). Used only by once after the connection establishment.
- **Force clean session** - Overwrite the client settings and clear or keep the session.
- **Publish messages without "retain" flag** - Send messages to other clients without a retain flag (read more in the next paragraph)
- **Ignored Topics** - You can provide certain topics that will be ignored by the broker. This is useful if you want to reduce some chatty clients. You can use wildcards to specify multiple topics, e.g. `test.*`.

The ioBroker MQTT-Broker in server mode only simulates the behavior of real MQTT-Broker (like Mosquitto), but it is not the same.
Real MQTT-Broker normally does not save the values of the topics and just forwards the message to other subscribed clients.

To force real MQTT-Broker to behave like ioBroker MQTT-Broker, all messages must be sent with the "retain" flag. 
In this case, the values will be stored too.

ioBroker MQTT-Broker always saves the values into the States-DB, so it can be processed by other adapters. 
Because of that, the messages are always published with a retain flag.

If your client has problems with retained messages, you can force ioBroker MQTT-Broker to send messages without a retain flag with `Publish messages without "retain" flag` option.
In this case, the messages will be stored in States-DB anyway. 

If the option `Send states (ack=true) too` is not activated, so you can clear the value of the topic (state) with `ack=true` and the update will not be sent to subscribed clients.
And when the client connects next time, it will not get the last command again.

The JS-Code should look like this: 
```
await setStateAsync('mqtt.0.valetudo.vale.BasicControlCapability.operation.set', 'cleanStart'); // ack=false
await setStateAsync('mqtt.0.valetudo.vale.BasicControlCapability.operation.set', '', true); // ack=true to clear the command
```

### MQTT 5 in server mode

The broker answers every client with the protocol level that client announced, so MQTT 5.0 and
MQTT 3.1.1 clients can use the same instance at the same time. Nothing has to be configured for it.

Supported MQTT 5 features:
- Reason codes on CONNACK, PUBACK, PUBREC, PUBREL, PUBCOMP, SUBACK and UNSUBACK
- **Topic aliases** - up to 32 per connection, announced in the CONNACK
- **Subscription option "No Local"** - a client does not get back what it published itself, even when "Use different topic names for set and get" is active
- **Subscription option "Retain Handling"** - `2` tells the broker not to send the value it already has on subscribe, which otherwise happens when "Publish own states on connect" is enabled
- **Subscription option "Retain As Published"** - the RETAIN flag of a message forwarded to a MQTT 5 subscriber follows the standard: a value the broker delivers because the subscription was just established is retained, everything forwarded afterwards has RETAIN `0` unless the subscription asked to keep the flag it was published with
- **Session Expiry Interval** - replaces the "clean session" flag: `0` (or no value) ends the session with the connection, a larger value keeps it. The "Force clean session" setting still overrules it.
- **Subscription identifiers** - a client learns on every message which of its subscriptions matched
- **Message Expiry Interval** - a value whose lifetime has passed is no longer handed out on subscribe and is dropped from the queue of an offline client instead of being delivered late. Messages that are still alive carry their remaining lifetime. The ioBroker state itself is never deleted, only the delivery stops
- **Will Delay Interval** - the last will is only published once the delay has passed and the client did not come back, so a short network hiccup does not announce a device as offline. The delay never outlives the session expiry interval
- **Maximum Packet Size** - a message larger than what the client announced it accepts is dropped instead of being sent
- **Receive Maximum** - the broker keeps at most as many QoS 1/2 messages unacknowledged as the client allows and sends the rest once a slot becomes free
- **Shared subscriptions** - several clients subscribe to `$share/<group>/<filter>` and the broker hands every matching message to exactly one of them, round robin. Useful to spread the load over several instances of the same consumer. Groups are independent of each other and of normal subscriptions, so a message can reach one member of every group plus every normal subscriber. A shared subscription never receives the stored value on subscribe, and combining it with "No Local" is a protocol error, both as the standard requires
- **Enhanced authentication with SCRAM-SHA-256** - see below

### Enhanced authentication (SCRAM-SHA-256)

A MQTT 5 client can authenticate with `SCRAM-SHA-256` (RFC 7677) instead of sending its password.
Nothing has to be configured for it: the method uses the same user name and password as the normal
login, and is offered as soon as those are set. Clients that send user name and password the usual
way keep working unchanged, MQTT 3.1.1 clients included.

Why it is worth using: the password never travels over the connection. The client proves that it
knows the password by signing the whole exchange, and the broker answers with a signature of its
own — so a client also notices when it is talking to a broker that does not know the password, and
a recorded exchange cannot be replayed against the broker later. This is useful whenever the
connection is not TLS protected.

The client only has to set the authentication method to `SCRAM-SHA-256` and put its
`client-first-message` into the authentication data of the CONNECT packet; the adapter answers with
an AUTH packet and completes the exchange. Re-authentication of a connected client is supported too.

Channel binding (`p=...`) is not offered, and a wrong user name is answered exactly like a wrong
password, so the exchange does not reveal which of the two was wrong.

Note the different RETAIN handling per protocol level. MQTT 3.1.1 clients are unchanged: the broker
stores every value in the States DB and publishes with the flag the `Publish messages without
"retain" flag` setting defines, so a reconnecting client finds the last value. MQTT 5 clients get
what the standard prescribes instead, which they can control themselves through "Retain Handling"
and "Retain As Published".

### Client settings
- **URL** - name or ip address of the broker/server. Like `localhost`.
- **Port** - Port of the MQTT broker. By default, 1883
- **Secure** - If secure (SSL) connection must be used.
- **User** - if broker required authentication, define here the username.
- **Password** - if the username is not empty, the password must be set. It can be empty.
- **Password confirmation** - repeat here the password.
- **MQTT version** - Protocol level used to connect to the broker: MQTT 3.1.1 (default), MQTT 5.0 or the legacy MQTT 3.1. If the broker refuses the selected version, the adapter logs a warning and falls back to MQTT 3.1.1.
- **Subscribe Patterns** - Subscribe by the pattern. See the chapter "Examples of using wildcards" to define the pattern. '#' to subscribe for all topics. `mqtt/0/#,javascript/#` to subscribe for states of `mqtt.0` and `javascript`
- **Publish only on change** - Store incoming messages only if the payload differs from the actual stored.
- **Mask to publish own states** - Mask for states, that must be published to broker. '*' - to publish all states. 'io.yr.*,io.hm-rpc.0.*' to publish states of `yr` and `hm-rpc` adapter.  
- **Publish all states at start** - Publish all states (defined by the state mask) every time by connection establishment to announce own available states and their values.
- **Prefix for topics** - The prefix can be defined for own states. Like `/var/ioBroker/`. Name of topics will be, for example, published with the name `/var/ioBroker/ping/192-168-1-5`.
- **Test connection** - Press the button to check the connection to broker. Adapter must be enabled before.
- **Send states (ack=true) too** - Normally only the states/commands with `ack=false` will be sent to partner. If this flag is set, every state independent of ack will be sent to a partner. 
- **Use different topic names for set and get** - if active, so every state will have two topics: `adapter/instance/stateName` and `adapter/instance/stateName/set`. In this case, a topic with `/set` will be used to send non acknowledged commands (ack: false) and topic without `/set` to receive state updates (with ack: true).
- **Send state object as mqtt message** - The client sends the states as parsed string JSON objects to the broker (example parsed string JSON object: `{"val":true,"ack":true,"ts":1584690242021,"q":0,"from":"system.adapter.deconz.0","user":"system.user.admin","lc":1584624242021,"expire":true}`); if not the values `states.val` is sent as a single value (example state.val as single value: `true`)
- **Persistent Session** - When checked, the broker saves the session information of the adapter. This means it tracks which messages have been sent/received by the adapter (only QoS Level 1 and 2) and to which topics the adapter has subscribed. This information survives a disconnect and reconnect of the adapter.

## Usage

### How to test mqtt client:
- Set type to `Client`.
- Leave port on 1883.
- Set URL as `broker.mqttdashboard.com`
- To get absolutely all topics(messages), set a pattern to `#`.
- To receive all topics for `/4MS` set pattern to `/4MS/#`
- To receive all topics for `/MS` and `/floorish` set pattern to `/4MS/#, /floorish/#`

### Sending messages
You may send / publish messages on topics using `sendTo` method from your adapter via MQTT adapter, e.g.:

```javascript
/*
 * @param {string}  MQTT instance     Specify MQTT instance to send message through (may be either server or client)
 * @param {string}  action            Action to use (always 'sendMessage2Client' for sending plain messages)
 * @param {object}  payload         
 * @param {string}  payload.topic     Topic to publish message on
 * @param {string}  payload.message   Message to be published on specified topic
 *
 */
adapter.sendTo('mqtt.0', 'sendMessage2Client', { topic: 'your/topic/here', message: 'your message', retain: true });
```

### Examples of using wildcards
The following examples on the use of wildcards, build on the example provided in topic strings.

- `Sport`
- `Sport/Tennis`
- `Sport/Basketball`
- `Sport/Swimming`
- `Sport/Tennis/Finals`
- `Sport/Basketball/Finals`
- `Sport/Swimming/Finals`

If you want to subscribe to all Tennis topics, you can use the number sign `#`, or the plus sign `+`.

- `Sport/Tennis/#` (this will receive `Sport/Tennis` and `Sport/Tennis/Finals`)
- `Sport/Tennis/+` (this will receive `Sport/Tennis/Finals` but not `Sport/Tennis`)

For JMS topics, if you want to subscribe to all Finals topics, you can use the number sign `#`, or the plus sign `+`.

- `Sport/#/Finals`
- `Sport/+/Finals`

For MQTT topics, if you want to subscribe to all Finals topics, you can use the plus sign `+`.

`Sport/+/Finals`

### Binary messages
Binary states were **removed in v7.0.1** (breaking change), because binary states are no longer supported by the ioBroker js-controller. The former *"All new topics will be processed as binary"* option and the `common.type = "file"` handling no longer have any effect.

Incoming MQTT payloads are otherwise always decoded as UTF-8 text and stored as a normal `string` / `number` / `boolean` / JSON state. Decoding a **raw binary payload** (e.g. a compressed image or map data such as the Valetudo map) as text would corrupt the non-text bytes, and changing `common.type` to `mixed` does not help because the value is already a string before it is written to the state.

#### Binary topics (stored as files)
To handle real binary payloads, list the affected topics under **"Binary topics (stored as files)"** in the instance settings (comma-separated, wildcards allowed, e.g. `valetudo/+/map,zigbee.*.image`). For every matching topic the adapter:

- writes the raw bytes into the adapter's file storage under `mqtt.<instance>/<topic>` (visible in Admin → Files and served at `/files/mqtt.<instance>/<topic>`), and
- sets the corresponding state (`common.type: "string"`, `role: "url"`, `native.binary: true`) to the file URL, e.g. `/files/mqtt.0/valetudo/robot/map`.

This works in both **client** and **server** mode. When such a state is published again (server mode: forwarded to subscribers; client mode: sent to the broker), the adapter reads the file back and sends the raw bytes, so binary data round-trips losslessly. In `vis` you can bind the state value directly to an `<img src>`.

### Tests
The broker was tested with the following clients:

- http://mitsuruog.github.io/what-mqtt/
- http://mqttfx.jfx4ee.org/
- http://www.eclipse.org/paho/clients/tool/

### Client objects
In server mode, the mqtt broker creates for every connected client the corresponding object in the ioBroker. The object will be created with the name `mqtt.0.info.clients.<clientId>`. The clientId is the unique identifier of the client.

You can disable the creation of the client objects in the instance settings. (**Do not create client objects**)

Note: If you have some client that connects and disconnects very often, the list of client objects will not be updated at all.

## Todo
* Implement resend of `QoS 2` messages after a while.
  Whenever a packet gets lost on the way, the sender is responsible for resending the last message after a reasonable amount of time. This is true when the sender is a MQTT client and also when a MQTT broker sends a message.

* queue packets with `QoS 1/2` for the offline clients with the persistent session.
  [Read here](https://www.hivemq.com/blog/mqtt-essentials-part-7-persistent-session-queuing-messages)

<!--
	Placeholder for the next version (at the beginning of the line):
	### **WORK IN PROGRESS**
-->

## Changelog
### **WORK IN PROGRESS**
* (@GermanBluefox) The Blockly block is now built from TypeScript sources in `src-blockly/` into `admin/blockly.js`, with the translations in `src-blockly/i18n/`
* (@GermanBluefox) Fixed: the Blockly block produced no code at all in newer Blockly editors. Since Blockly 10 a generator has to be registered in `Blockly.JavaScript.forBlock`, and the editor migrates its own generators there before it loads an adapter's block

### 8.0.0 (2026-08-28)
* (@GermanBluefox) Added MQTT 5.0 support. In server mode every client is answered with the protocol level it announced, so MQTT 5 and MQTT 3.1.1 clients can share one instance. Includes Reason codes, topic aliases, the subscription options "No Local", "Retain Handling" and "Retain As Published", subscription identifiers, message expiry, will delay, maximum packet size, receive maximum, shared subscriptions and the session expiry interval. MQTT 3.1.1 clients are not affected by the new rules
* (@GermanBluefox) Client mode: the MQTT version (3.1 / 3.1.1 / 5.0) can now be selected. If the broker refuses it, the adapter falls back to MQTT 3.1.1
* (@GermanBluefox) Added MQTT 5 enhanced authentication with SCRAM-SHA-256 (RFC 7677) in server mode. The password is no longer sent over the connection; both sides prove that they know it. It uses the configured user name and password, needs no configuration and does not change anything for clients that log in the usual way
* (@GermanBluefox) Fixed: a rejected login could lose its CONNACK, because the socket was torn down before the answer had left it. The client saw a closed connection instead of the reason
* (@GermanBluefox) Replaced the unmaintained `mqtt-connection` package with an own connection layer on `mqtt-packet`, which removes a second, outdated copy of `mqtt-packet` from the dependency tree

### 7.1.3 (2026-08-28)
* (@Tarvion) Fixed: a value received for a topic that was published from a state ID containing "#", "+" or a space (e.g. the Shelly IDs like `shelly.0.SHCB-1#3494546B9BEC#1`) is now written back to that state instead of creating a new state in the adapter's own namespace
* (@GermanBluefox) Fixed: the resolution above now also corrects an instance that already carries the wrongly created `mqtt.<n>.*` state from an earlier version. Such a state was published at the start and claimed the topic before any message arrived. It is logged once as a leftover and can be deleted

### 7.1.2 (2026-07-26)
* (@GermanBluefox) Added a "Replace dots in topic names with underscore" setting to keep MQTT topics that contain dots (e.g. Wolf heating via ism7mqtt) as a single object level (#413)
* (@GermanBluefox) Client mode: added loop protection so a value just received from the broker is not published straight back, plus a new "Do not subscribe to own states" option (#414)

### 7.1.1 (2026-07-08)
* (@Marc-Berg) Fixed: Publish only on change issue

### 7.1.0 (2026-07-03)
* (@GermanBluefox) Added a "Binary topics" setting to store raw binary payloads (e.g. Valetudo map, camera images) as files instead of corrupting them as UTF-8 strings (#573)

[Older changelogs can be found there](CHANGELOG_OLD.md)

## License

The MIT License (MIT)

Copyright (c) 2014-2026, bluefox <dogafox@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
