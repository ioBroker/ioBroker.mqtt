# Older changes
## 6.0.1 (2024-08-06)
* (foxriver76) remove binary state handling as these are no longer existing
* (klein0r) handle the messages as a state object if properties are valid

## 6.0.0 (2024-07-13)
* Breaking Changes: NodeJS >= 18.x and js-controller >= 5 are required
* (klein0r) Fixed blockly definitions

## 5.2.0 (2024-01-08)
* (ticaki) fixed: confirm onMessage()
* (orpheus55) Added the authentication validation to request processing
* (theimo1221) Added an option to filter certain topics

## 5.1.0 (2023-10-11)
* (bluefox) Added security check if the server is available from the internet without protection

## 5.0.0 (2023-09-18)
* (klein0r) Added blockly block for custom messages (sendMessage2Client)
* (klein0r) Added retain flag for sendMessage2Client
* (klein0r) Removed support for Admin 4 UI (materialize)
* (bluefox) Minimal supported node.js version is 16

## 4.1.1 (2023-03-22)
* (Apollon77) Fixed the regex on subscribing of server clients to only match wanted states
* (Apollon77) Prepare for future js-controller versions

## 4.0.7 (2022-06-28)
* (Apollon77/kleinOr) Removed unneeded dependency

## 4.0.6 (2022-06-19)
* (bluefox) Corrected sentry issue

## 4.0.4 (2022-05-30)
* (Apollon77) lower log-level for log messages about messages with unknown message IDs to info

## 4.0.3 (2022-05-17)
* (bluefox) Corrected publish states on start by client

## 4.0.2 (2022-05-17)
* (bluefox) Added possibility to publish own states as a client, additionally to `mqtt.x`

## 4.0.1 (2022-05-13)
* (Apollon77) Fixed Number detection for values

## 4.0.0 (2022-05-12)
* (bluefox) BREAKING CHANGE: in client mode only "mqtt.X.*" states will be subscribed
* (bluefox) BREAKING CHANGE: in server mode by empty "publish" setting no states will be subscribed. Early all states were subscribed
* (bluefox) Added a new option: All new topics will be processed as binary

## 3.0.6 (2022-04-25)
* (Apollon77) Allows using some special characters like # in client passwords
* (Apollon77) Corrected handing of `QoS 2` messages
* (Apollon77) Implement resend support of `pubrec`
* (Apollon77) When resending a package set the dup flag as required by specs
* (Apollon77) Added more debug for special debug mode

## 3.0.5 (2022-04-07)
* (bluefox) BREAKING CHANGE: password is now stored encrypted, and so must be set anew after update!

## 2.7.4 (2022-03-18)
* (Apollon77) Updated MQTT library dependency

## 2.7.3 (2022-03-11)
* (Apollon77) Further optimization of automatic folder creation

## 2.7.2 (2022-03-11)
* (Apollon77) Optimized the automatic folder creation and allow to automatically overwrite these objects when needed

## 2.7.0 (2022-03-09)
* (Apollon77) Prevented Client or server to overwrite the own `info.connection` state
* (Apollon77) replaced # and + characters by _ when publishing a value because these characters are forbidden when publishing for most brokers

## 2.6.2 (2022-03-03)
* (Apollon77) If data types of objects change during an adapter run, adjust datatype of `mqtt.X.*` objects to "mixed" to prevent issues

## 2.6.1 (2022-02-25)
* (Apollon77) Fixed object structure sync for server usage

## 2.6.0 (2022-02-25)
* (Apollon77) Updated objects if data type changes also for "client" usage
* (Apollon77) Updated mqtt library
* (Apollon77) Created a folder object structure if objects do not exist in the adapter namespace

## 2.5.0 (2022-02-24)
* (uwesimon/Apollon77) fixed test connection with MQTTs
* (uwesimon/Apollon77) ReconnectTimeout is now handled in seconds, so default is 10s instead of 10ms
* (Apollon77) Corrected `info.connection` object default values

## 2.4.1 (2021-11-08)
* (MichaelDvP) Added wildcard regex for "/#"

## 2.4.0 (2021-05-09)
* (Apollon77) only remember the last message per topic for offline clients that subscribed the topics when using persistent sessions
* (Apollon77) only remember last wills for clients that subscribed the topics
* (Apollon77) on "disconnect" message do not send last will as defined by specs
* (Apollon77) set a new messageId when sending remembered messages
* (Apollon77) Added small delay after subscribe before sending out topic values
* (Apollon77) optimized for js-controller 3.3
* (foxriver76) prevented errors in js-controller 3.3 and detect datatype changes for objects

## 2.3.5 (2021-02-27)
* (Apollon77) js-controller 2.0 is now required at least
* (arteck) changed default subscribe to `mqtt.0.*`

## 2.3.4 (2021-01-25)
* (Apollon77) Caught errors when setting states (Sentry IOBROKER-MQTT-1F)

## 2.3.3 (2021-01-21)
* (Apollon77) Caught errors when setting states (Sentry IOBROKER-MQTT-1D)

## 2.3.2 (2021-01-13)
* (Apollon77) Checked configured server port and reset to 1883 if invalid (Sentry IOBROKER-MQTT-1B)
* (Apollon77) Caught error when server cannot be started (Sentry IOBROKER-MQTT-1C)

## 2.3.1 (2020-12-30)
* (FunCyRanger) Added option to ignore SSL validation errors

## 2.1.14 (2020-11-30)
* (Apollon77) Prevented a crash case (Sentry IOBROKER-MQTT-11)

## 2.1.13 (2020-11-16)
* (Apollon77) Prevented a crash case (Sentry IOBROKER-MQTT-Q)

## 2.1.12 (2020-11-08)
* (Apollon77) Crash cases prevented (Sentry IOBROKER-MQTT-M)

## 2.1.10 (2020-10-30)
* (Apollon77) Crash cases prevented (Sentry IOBROKER-MQTT-G)
* (Apollon77) prevent errors on MQTT connection test

## 2.1.9 (2020-09-17)
* (Apollon77) Crash cases prevented (Sentry IOBROKER-MQTT-E, IOBROKER-MQTT-F)

## 2.1.8 (2020-08-24)
* (Apollon77) Crash case prevented on unsubscribing (Sentry IOBROKER-MQTT-D)

## 2.1.7 (2020-08-02)
* (Apollon77) handled invalid mqtt server settings better (Sentry IOBROKER-MQTT-9)

## 2.1.6 (2020-08-02)
* (Apollon77) Try to prevent creation of objects with invalid IDs
* (Apollon77) checked that state is set before accessing it (Sentry IOBROKER-MQTT-2)
* (Apollon77) Better handle disconnection cases (Sentry IOBROKER-MQTT-3, IOBROKER-MQTT-6)

## 2.1.5 (2020-07-26)
* (Apollon77) try to prevent crashes on not existing state values
* (Apollon77) Sentry added for crash reporting with js-controller 3.x+

## 2.1.4 (2020-06-20)
* (Apollon77) websocket does not have setTimeout method
* (NorbGH) prevented messageID overflow

## 2.1.3 (2020- 05-17)
* (bluefox) Caught some errors

## 2.1.2 (2020-03-02)
* (foxriver76) removed usage of getMessage
* (mbecker) send states as an object in client mode

## 2.1.1 (2019-07-27)
* (bluefox) Added an option to overwrite the client "clean session" settings

## 2.1.0 (2019-05-02)
* (Zefau) Added an option to send the message using messagebox
* (Zefau) Fixed error with logging on `pubrec`

## 2.0.6 (2019-01-16)
* (SchumyHao) Added Chinese support

## 2.0.5 (2019-01-12)
* (simatec) Support for Compact mode

## 2.0.4 (2018-12-01)
* (Apollon77) Subscribe to topics after connect

## 2.0.3 (2018-08-11)
* (bluefox) Prefix in the server was corrected

## 2.0.2 (2018-08-09)
* (bluefox) Behavior of "set" topics was changed

## 2.0.1 (2018-07-06)
* (bluefox) Double prefix by the client was fixed

## 2.0.0 (2018-03-05)
* (bluefox) broke node.js 4 support
* (bluefox) removed mqtt-stream-server
* (bluefox) partial mqtt5 support

## 1.5.0 (2018-03-05)
* (bluefox) The patch for wifi-iot removed
* (bluefox) the mqtt library updated
* (bluefox) implement QoS>0

## 1.4.2 (2018-01-30)
* (bluefox) Admin3 settings was corrected

## 1.4.1 (2018-01-13)
* (bluefox) Converted error is caught
* (bluefox) Ready for admin3

## 1.3.3 (2017-10-15)
* (bluefox) Fixed sending of QOS=2 if server

## 1.3.2 (2017-02-08)
* (bluefox) Fixed convert of UTF8 payloads
* (bluefox) optional fix for a chunking problem

## 1.3.1 (2017-02-02)
* (bluefox) Updated mqtt packages
* (bluefox) added Interval before send topics by connection and send interval settings
* (bluefox) reorganise configuration dialog

## 1.3.0 (2017-01-07)
* (bluefox) Updated mqtt packages
* (bluefox) configurable client ID

## 1.2.5 (2016-11-24)
* (bluefox) Fixed server publishing

## 1.2.4 (2016-11-13)
* (bluefox) additional debug output

## 1.2.1 (2016-11-06)
* (bluefox) fixed the publish on start

## 1.2.0 (2016-09-27)
* (bluefox) implementation of LWT for server
* (bluefox) updated mqtt package version

## 1.1.2 (2016-09-13)
* (bluefox) fixed authentication in server

## 1.1.1 (2016-09-12)
* (bluefox) do not parse JSON states, that do not have the attribute `val` to support other systems

## 1.1.0 (2016-07-23)
* (bluefox) added new setting: Use different topic names for a set and get

## 1.0.4 (2016-07-19)
* (bluefox) converted values like `+58,890` into numbers too

## 1.0.3 (2016-05-14)
* (cdjm) changed client protocolID

## 1.0.2 (2016-04-26)
* (bluefox) updated mqtt module

## 1.0.1 (2016-04-25)
* (bluefox) Fixed translations in admin

## 1.0.0 (2016-04-22)
* (bluefox) Fixed error with direct publish in server

## 0.5.0 (2016-03-15)
* (bluefox) fixed web sockets
* (bluefox) fixed SSL

## 0.4.2 (2016-02-10)
* (bluefox) created the object `info.connection`
* (bluefox) added reconnection tests

## 0.4.1 (2016-02-04)
* (bluefox) fixed error with states creation

## 0.4.0 (2016-01-27)
* (bluefox) added tests
* (bluefox) client and server run

## 0.3.1 (2016-01-14)
* (bluefox) changed creation of states by client

## 0.3.0 (2016-01-13)
* (bluefox) try to fix event emitter

## 0.2.15 (2015-11-23)
* (Pmant) fixed publish on subscribing

## 0.2.14 (2015-11-21)
* (bluefox) fixed error with wrong variable names

## 0.2.13 (2015-11-20)
* (Pmant) fixed error with wrong variable name

## 0.2.12 (2015-11-14)
* (Pmant) send last known value on subscription (server)

## 0.2.11 (2015-10-17)
* (bluefox) set maximal length of topic name
* (bluefox) converted `true` and `false` to boolean values

## 0.2.10 (2015-09-16)
* (bluefox) protected against empty topics

## 0.2.8 (2015-05-17)
* (bluefox) do not ty to parse JSON objects

## 0.2.7 (2015-05-16)
* (bluefox) fixed test button

## 0.2.6 (2015-05-16)
* (bluefox) fixed names if from mqtt adapter

## 0.2.5 (2015-05-15)
* (bluefox) subscribe to all states if no mask defined

## 0.2.4 (2015-05-14)
* (bluefox) added state `clients` to server with the list of clients

## 0.2.3 (2015-05-14)
* (bluefox) fixed some errors

## 0.2.2 (2015-05-13)
* (bluefox) fixed some errors with sendOnStart and fix flag sendAckToo

## 0.2.0 (2015-05-13)
* (bluefox) translations and rename config sendNoAck=>sendAckToo
* (bluefox) lets create server not only on localhost

## 0.1.8 (2015-05-13)
* (bluefox) fixed topic names in server mode
* (bluefox) implemented subscribe
* (bluefox) update mqtt package

## 0.1.7 (2015-03-24)
* (bluefox) created objects if new state received
* (bluefox) updated mqtt library

## 0.1.6 (2015-03-04)
* (bluefox) just update index.html

## 0.1.5 (2015-01-02)
* (bluefox) fix error if state deleted

## 0.1.4 (2015-01-02)
* (bluefox) support for npm install

## 0.1.2 (2014-11-28)
* (bluefox) support for npm install

## 0.1.1 (2014-11-22)
* (bluefox) support for new naming concept

## 0.1.0 (2014-10-23)
* (bluefox) Updated readme
* (bluefox) Support of authentication for server and client
* (bluefox) Support of prefix for own topics

## 0.0.2 (2014-10-19)
* (bluefox) support of server (actual no authentication)
