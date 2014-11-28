![Logo](admin/mqtt.png)
ioBroker MQTT Adapter
==============

# MQ Telemetry Transport for ioBroker (MQTT).

MQTT (formerly Message Queue Telemetry Transport) is a publish-subscribe based "light weight" messaging protocol for use on top of the TCP/IP protocol.
It is designed for connections with remote locations where a "small code footprint" is required and/or network bandwidth is limited.
The Publish-Subscribe messaging pattern requires a message broker. The broker is responsible for distributing messages to interested clients based on the topic of a message.
Historically, the 'MQ' in 'MQTT' came from IBM's MQ message queuing product line.

This adapter uses the MQTT.js library from https://github.com/adamvr/MQTT.js/

## Changelog
### 0.1.2 (2014-11-28)
* (bluefox) support of npm install

### 0.1.1 (2014-11-22)
* (bluefox) support of new naming concept

### 0.1.0 (2014-10-23)
* (bluefox) Update readme
* (bluefox) Support of authentication for server and client
* (bluefox) Support of prefix for own topics

### 0.0.2 (2014-10-19)
* (bluefox) support of server (actual no authentication)

## Install

```node iobroker.js add mqtt```

## Configuration

### Main settings
- **Type** - Select "Client" (If you want to receive and send messages to other broker) or "Server" if you want create own MQTT broker.

### Client
#### Connection settings
- **URL** - name or ip address of the broker/server. Like "localhost".
- **Port** - Port of the MQTT broker. By default 1883
- **Secure** - If secure (SSL) connection must be used.

#### Authentication settings
- **User** - if broker required authentication, define here the user name.
- **Password** - if user name is not empty the password must be set. It can be empty.
- **Password confirmation** - repeat here the password.

#### Adapter settings
- **Patterns** - Subscribe pattern. See chapter "Examples of using wildcards" to define the pattern. '#' to subscribe for all topics. '/var/device1/#,/var/device2/#' to subscribe for topics of device1 and device2
- **Store only on change** - Store incoming messages only if payload is differ from actual stored.
- **Test connection** - Press the button to check the connection to broker. Adapter must be enabled before.

#### Adapter settings 
- **Mask to publish own states** - Mask for states, that must be published to broker. '*' - to publish all states. 'io.yr.*,io.hm-rpc.0.*' to publish states of "yr" and "hm-rpc" adapter.  
- **Publish all states at start** - Publish all states (defined by state mask) every time by connection establishment to announce own available states and their values.
- **Prefix for topics** - The prefix can be defined for own states. Like "/var/ioBroker/". Name of topics will be for example published with the name "/var/ioBroker/ping/192-168-1-5".

### Server
#### Connection settings
- **Port** - Port of the MQTT broker. By default 1883
- **Secure** - If secure (SSL) connection must be used.
- **Public certificate** - If secure (SSL) connection used, select here public certificate. You must load it before in the settings of ioBroker(upper top) / Certificates.
- **Private certificate** -  If secure (SSL) connection used, select here private certificate.

#### Authentication settings
- **User** - if you want to use authentication, define the user name. Client must connect with the same username.
- **Password** - if user name is not empty the password must be set. It can be empty too.
- **Password confirmation** - repeat here the password.

#### Adapter settings
- **Store only on change** - Store incoming messages only if payload is differ from actual stored.
- **Mask to publish own states** - Mask for states, that must be published to client. '*' - to publish all states. 'io.yr.*,io.hm-rpc.0.*' to publish states of "yr" and "hm-rpc" adapter.  
- **Publish all states at start** - Publish all states (defined by state mask) every time by connection establishment to announce own available states and their values.
- **Prefix for topics** - The prefix can be defined for own states. Like "/var/ioBroker/". Name of topics will be for example published with the name "/var/ioBroker/ping/192-168-1-5".
- **Trace output for every message** - Debug outputs. 

## Usage

### How to test mqtt client:
- Set type to "Client".
- Leave port on 1883.
- Set URL as "broker.mqttdashboard.com"
- To get absolutely all topics(messages) set pattern to "#".
- To receive all topics for "/4MS" set pattern to "/4MS/#"
- To receive all topics for "/MS and "/floorish" set pattern to "/4MS/#, /floorish/#"

### Examples of using wildcards
The following examples on the use of wildcards, builds on the example provided in topic strings.

- "Sport"
- "Sport/Tennis"
- "Sport/Basketball"
- "Sport/Swimming"
- "Sport/Tennis/Finals"
- "Sport/Basketball/Finals"
- "Sport/Swimming/Finals"

If you want to subscribe to all Tennis topics, you can use the number sign '#', or the plus sign '+'.

- "Sport/Tennis/#" (this will receive "Sport/Tennis" and "Sport/Tennis/Finals")
- "Sport/Tennis/+" (this will receive "Sport/Tennis/Finals" but not "Sport/Tennis")

For JMS topics, if you want to subscribe to all Finals topics, you can use the number sign '#', or the plus sign '+'.

- "Sport/#/Finals"
- "Sport/+/Finals"

For MQTT topics, if you want to subscribe to all Finals topics, you can use the plus sign '+' .

"Sport/+/Finals"

## License

The MIT License (MIT)

Copyright (c) 2014, bluefox

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
