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
- **Authentication/Credentials** - Credentials from the central credential storage, see [Credentials](#credentials). If selected, the two fields below are not used.
- **Authentication/Username** - If authentication is required, you can specify the username. It is suggested to always use SSL with authentication to not send passwords over unsecure connection.  
- **Authentication/Password** - Password for user.
- **Mask to publish own states** - Pattern to filter ioBroker states, which will be sent to clients. You can use wildcards to specify a group of messages, e.g., `*.memRss, mqtt.0.*` to get all memory states of all adapters and all states of adapter `mqtt.0`
- **Publish only on change** - New messages will be sent to a client only if the state value changes. Every message sent by the client will be accepted, even if the value does not change.
- **Publish own states on connect** - by every client connection the all known states will be sent to a client (defined by the state mask), to tell him which states the ioBroker has.
- **Prefix for all topics** - if set, every sent topic will be prepended with this prefix, e.g., if prefix `iobroker/` all states will have names like `**iobroker**/mqtt/0/connected`
- **Trace output for every message** - Debug outputs.
- **Send states (ack=true) too** - Normally only the states/commands with `ack=false` will be sent to partner. If this flag is set, every state independent of ack will be sent to partner. 
- **Use different topic names for set and get** - if active, so every state will have two topics: `adapter/instance/stateName` and `adapter/instance/stateName/set`. In this case, a topic with `/set` will be used to send non acknowledged commands (ack: false) and topic without `/set` to receive state updates (with ack: true). A client gets the commands it sent back in this mode, but not the values it reported itself (ack: true). A command reaches a client that subscribed to the `/set` topic, e.g. `zwave/+/+/set`.
- **Interval before sending topics by connection** - Pause between connection and when all topics will be sent to a client (if activated).
- **Send interval** - Interval between packets by sending all topics (if activated). Used only by once after the connection establishment.
- **Force clean session** - Overwrite the client settings and clear or keep the session.
- **Publish messages without "retain" flag** - Send messages to other clients without a retain flag (read more in the next paragraph)
- **Ignored Topics** - You can provide certain topics that will be ignored by the broker. This is useful if you want to reduce some chatty clients. Entries are separated by comma (spaces around the comma are allowed) and can be written as ioBroker ID (`evcc.loadpoints.*.planSoc`, with or without `mqtt.0.`) or as MQTT topic filter (`homeassistant/#`, `instar/+/alarm`). `*` and `#` match any number of characters at any position, `+` exactly one level, and a trailing `.*` or `/#` also matches the parent itself. An entry without wildcard matches this topic and everything below it, but not a part of a name: `evcc` matches `evcc.site`, but not `evccTitle`, and to match a level at any position write `*.alarm.*`. The same rules apply to **Binary topics**.

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
- **Credentials** - Credentials from the central credential storage, see [Credentials](#credentials). If selected, user and password below are not used.
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

### Credentials
Instead of typing user name and password into every instance, they can be stored once in the central
credential storage of ioBroker (admin: Settings → Credentials, admin 7.9.0 or newer) and selected in the
"Authentication settings" of the instance. The ➕ button next to the selector creates new credentials right there.
Choose the form "Login & password": the login is used as the MQTT user name, the password as the MQTT password.
The same credentials can be used by several instances, e.g. by a server instance and by the client instances
that connect to it.

When the selected credentials are changed in the admin, the instance restarts and uses the new values.
If they cannot be read (e.g. because they were deleted), the instance logs an error and does not start,
so a server never runs without authentication by accident.

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
 * The topic is published exactly as given: the "Prefix for all topics" is not added.
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
In server mode, the mqtt broker creates for every connected client the corresponding object in the ioBroker. The object will be created with the name `mqtt.0.info.clients.<clientId>`. The clientId is the unique identifier of the client. Dots, whitespace and characters that are not allowed in an ioBroker object ID (e.g. `*` or binary data) are replaced by `_`. A device that connects without client ID gets one from the broker (`auto-…`); as this ID changes with every connection, its object is named after the IP address of the device instead.

If a device connects again with the same client ID while its old connection is still open, the old connection is closed. Every client ID can only be used by one connection at a time. If the new connection comes from another IP address, a warning is logged: two devices that use the same client ID keep disconnecting each other.

You can disable the creation of the client objects in the instance settings. (**Do not create client objects**)

Objects of clients that have not been connected for some days are removed automatically (**Remove client objects after**, default 7 days, `0` = never). This matters for devices that use a new client ID for every connection: without it, they leave a new object behind each time. The cleanup runs when the instance starts and then once a day. Objects for which you have switched on logging (e.g. History or InfluxDB) are kept.

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
- (@Schimi1983) Server mode: a client that refuses the certificate (e.g. mosquitto without the CA certificate) is logged with a readable reason instead of the raw OpenSSL message. Timers use the adapter's own timer functions, which are cleared automatically when the instance stops (repository checker)

### 9.2.0 (2026-11-08)
- (@Schimi1983) Server mode: objects of clients that have not been connected for 7 days are removed (setting "Remove client objects after", 0 = never), so devices with a new client ID per connection no longer leave one object behind each time. A connect or disconnect only writes the client states that change instead of all of them (#518)
- (@Schimi1983) Server mode: client objects with logging switched on (e.g. History or InfluxDB) are no longer removed by the cleanup, and the cleanup reads all client objects in one query
- (@Schimi1983) Server mode: MQTT over secure WebSocket (SSL + WebSocket) accepts clients again (broken since 6.1.3), and a failed TLS connection is logged with the likely reason (e.g. the client does not trust the certificate or does not use TLS). Client mode: the same connection error is logged only once instead of on every reconnect, certificate errors get a hint which setting helps (#341)
- (@Schimi1983) Server mode: subscriptions are checked and matched as the MQTT specification says. A topic filter with a character like `(` or `[` no longer stops the adapter, `+` matches exactly one level (`temp/+` no longer delivers `sensors/0/temp/x`), invalid filters such as `a/#/b` or `sport+` are refused, and after unsubscribing from a filter with wildcards its topics are no longer delivered. A packet that cannot be processed closes only the connection of that client
- (@GermanBluefox) Client mode: the keep alive can be set in the admin, the default is 60 seconds instead of 1000 (existing instances with 1000 are changed to 60). A lost broker was noticed only after about 25 minutes (#339, #508)
- (@GermanBluefox) Client mode: an empty payload is no longer stored as `NaN`, and a deleted state or a value of null is sent as an empty payload instead of the string "null", like in server mode since 8.1.5 (#499)
- (@GermanBluefox) Client mode: the debug log of sent messages no longer shows the prefix, which is not added (and never was) to topics of `sendMessage2Client` (#448)
- (@GermanBluefox) Server mode with "different topic names for set and get": a command reaches clients that subscribed to its `/set` topic, e.g. Z-Wave JS UI (#494), and a client no longer gets back the value it reported itself (ack=true) (#349)
- (@GermanBluefox) Server mode: a topic that changes its type (e.g. number and text) becomes "mixed" and stays so, instead of changing the type of its object with every message (#340)

### 9.1.0 (2026-11-03)
- (copilot) Adapter requires node.js >= 22.19.0 now
- (@Schimi1983) Server mode: a client with many unacknowledged messages no longer slows the broker down. Since 8.1.5, every new message to such a client searched the whole queue again for each packet ID still in use, which took up to half a second per message and could drive the CPU load to 100 %
- (@Schimi1983) Server mode: connections are handled as the MQTT specifications require (#687). A new connection with the client ID of a connected client closes the old one (MQTT 5: "session taken over"); a rejected login no longer ends the session of the connected client. Clients without client ID get a unique ID (`auto-…`) instead of sharing one; this is refused for MQTT 3.1 and for MQTT 3.1.1 with "clean session" off. An unsupported protocol version is answered with "unacceptable protocol version". A second CONNECT or any packet before CONNECT closes the connection
- (@GermanBluefox) Server mode: a client without client ID keeps one object `info.clients.<IP address>` instead of leaving a new `info.clients.auto-…` object behind on every connection. A takeover of a client ID from another IP address is logged as a warning (two devices with the same client ID). If the instance forces clean sessions, an empty client ID with "clean session" off is accepted

### 9.0.2 (2026-10-30)
* (@Schimi1983) Server mode: a client ID with characters that are not allowed in an object ID (e.g. binary data or `*`) no longer fails with "Cannot update client objects: Error: Invalid ID"; such characters become `_` in `info.clients.<clientId>` (#493)
* (@Schimi1983) Log level of messages that come for every subscription or published state is debug instead of info: `subscribes on`, `unsubscribes on`, `publishOnSubscribe` (server) and `send2Server`, `Publishing state` (client) (#481)
* (@Schimi1983) State roles as defined by ioBroker: new states created from topics get `state` instead of the undefined role `variable`, binary topics `text.url` instead of `url`, `info.lastSession` `json`, and `info.connection` in io-package `indicator.connected`. Existing objects keep their role

### 9.0.1 (2026-10-30)
* (@Schimi1983) **Breaking change** - Ignored topics and binary topics: entries are trimmed, so a space after the comma no longer breaks an entry, and a `*` in the middle of an entry (e.g. `evcc.loadpoints.*.planSoc`) matches any levels. An entry has to match the whole ID: an entry without wildcard matches this ID and everything below it, but no longer every ID that contains it (`alarm` no longer matches `instar.all.alarm.motion`, write `*.alarm.*`). Please check both settings after the update (#429)
* (@GermanBluefox) Ignored topics and binary topics: a MQTT topic filter (e.g. `homeassistant/#`) also matches the ID with namespace when "Replace dots in topic names with underscore" is enabled. Dots at the start or the end of an ID entry are removed with a warning in the log. The help text in the settings describes the syntax
* (@GermanBluefox) User name and password can be taken from the central credential storage of ioBroker (Settings → Credentials), so the same credentials can be used by several instances. Requires admin 7.9.0 or newer (#673)
* (@GermanBluefox) Client mode: "Test connection" passes user name and password as options, so special characters in them no longer break the connection URL
* (@Schimi1983) Server mode: a client ID with characters that are not allowed in an object ID (e.g. binary data or `*`) no longer fails with "Cannot update client objects: Error: Invalid ID"; such characters become `_` in `info.clients.<clientId>` (#493)
* (@Schimi1983) Log level of messages that come for every subscription or published state is debug instead of info: `subscribes on`, `unsubscribes on`, `publishOnSubscribe` (server) and `send2Server`, `Publishing state` (client) (#481)

### 8.1.5 (2026-10-27)
* (@Schimi1983) Server mode: every QoS 1/2 message sent to a client now gets its own packet identifier. Before, all messages used the same ID, so acknowledgements could not be matched and messages were retransmitted endlessly
* (@GermanBluefox) Server mode: the packet identifiers of a client and of the broker are kept apart. A QoS 2 message of a client was dropped as duplicate when the broker had a message with the same identifier in flight to it. After the counter wrapped, an identifier still in flight is not handed out again, and an unacknowledged message keeps its identifier when it is sent again after a reconnect
* (@GermanBluefox) Server mode: a deleted value (empty payload) and a value of `null` are sent as empty payload instead of `"null"` or `"NaN"`, so a client that deletes its retained topics does not get values back. A received empty payload sets the state to `null` and keeps its type (#682)
* (@GermanBluefox) The default of "Maximum topic name length" is 255 characters for new instances (was 100). The warning about a too long topic names this setting and comes only once per topic (#560)
* (@GermanBluefox) Client mode: a reconnect attempt no longer reports the connection as established (#508)

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
