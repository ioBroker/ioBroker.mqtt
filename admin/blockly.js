// GENERATED FILE - do not edit.
// Source: src-blockly/blockly.ts - rebuild with `npm run build:blockly`.
"use strict";
(() => {
  // src-blockly/helpers.ts
  var Blockly = window.Blockly;
  function instanceOptions() {
    const options = [];
    const instances = window.main?.instances;
    if (instances) {
      for (let i = 0; i < instances.length; i++) {
        const m = /^system\.adapter\.mqtt\.(\d+)$/.exec(instances[i]);
        if (m) {
          options.push([`mqtt.${parseInt(m[1], 10)}`, `.${parseInt(m[1], 10)}`]);
        }
      }
    }
    if (!options.length) {
      for (let n = 0; n <= 4; n++) {
        options.push([`mqtt.${n}`, `.${n}`]);
      }
    }
    options.unshift([Blockly.Translate("mqtt_anyInstance"), ""]);
    return options;
  }
  function registerGenerator(type, generator) {
    if (Blockly.JavaScript.forBlock) {
      Blockly.JavaScript.forBlock[type] = generator;
    } else {
      Blockly.JavaScript[type] = generator;
    }
  }

  // src-blockly/blocks/sendMessage.ts
  var Blockly2 = window.Blockly;
  function installSendMessage() {
    Blockly2.Sendto.blocks.mqtt_sendmessage = `<block type="mqtt_sendmessage">
  <field name="INSTANCE"></field>
  <field name="RETAIN">FALSE</field>
  <value name="TOPIC">
    <shadow type="text">
      <field name="TEXT">your/topic/here</field>
    </shadow>
  </value>
  <value name="MESSAGE">
    <shadow type="text">
      <field name="TEXT">your message</field>
    </shadow>
  </value>
</block>`;
    Blockly2.Blocks.mqtt_sendmessage = {
      init: function() {
        this.appendDummyInput("INSTANCE").appendField(Blockly2.Translate("mqtt_sendmessage")).appendField(new Blockly2.FieldDropdown(instanceOptions()), "INSTANCE");
        this.appendValueInput("TOPIC").appendField(Blockly2.Translate("mqtt_topic"));
        this.appendValueInput("MESSAGE").appendField(Blockly2.Translate("mqtt_message"));
        this.appendDummyInput("RETAIN").appendField(Blockly2.Translate("mqtt_retain")).appendField(new Blockly2.FieldCheckbox("FALSE"), "RETAIN");
        this.setInputsInline(false);
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour(Blockly2.Sendto.HUE);
        this.setTooltip(Blockly2.Translate("mqtt_tooltip"));
        this.setHelpUrl(Blockly2.Translate("mqtt_help"));
      }
    };
    registerGenerator("mqtt_sendmessage", (block) => {
      const instance = block.getFieldValue("INSTANCE");
      const topic = Blockly2.JavaScript.valueToCode(block, "TOPIC", Blockly2.JavaScript.ORDER_ATOMIC);
      const message = Blockly2.JavaScript.valueToCode(block, "MESSAGE", Blockly2.JavaScript.ORDER_ATOMIC);
      const field = block.getFieldValue("RETAIN");
      const retain = field === true || field === "TRUE" || field === "true";
      return `sendTo('mqtt${instance}', 'sendMessage2Client', { topic: ${topic}, message: ${message}, retain: ${retain} });
`;
    });
  }

  // src-blockly/i18n/de.json
  var de_default = {
    mqtt_anyInstance: "Alle Instanzen",
    mqtt_message: "Nachricht",
    mqtt_retain: "Retain",
    mqtt_sendmessage: "MQTT-Nachricht",
    mqtt_tooltip: "Sendet eine Nachricht an ein benutzerdefiniertes Thema",
    mqtt_topic: "Thema (Topic)"
  };

  // src-blockly/i18n/en.json
  var en_default = {
    mqtt_anyInstance: "All instances",
    mqtt_message: "Message",
    mqtt_retain: "Retain",
    mqtt_sendmessage: "MQTT Message",
    mqtt_tooltip: "Sends a message on a user defined topic",
    mqtt_topic: "Topic"
  };

  // src-blockly/i18n/es.json
  var es_default = {
    mqtt_anyInstance: "Todas las instancias",
    mqtt_message: "Mensaje",
    mqtt_retain: "Retain",
    mqtt_sendmessage: "MQTT message",
    mqtt_tooltip: "Enviar un mensaje sobre un tema definido por el usuario",
    mqtt_topic: "Tema (Topic)"
  };

  // src-blockly/i18n/fr.json
  var fr_default = {
    mqtt_anyInstance: "Toutes les instances",
    mqtt_message: "Message",
    mqtt_retain: "Retain",
    mqtt_sendmessage: "Message MQTT",
    mqtt_tooltip: "Envoyer un message sur un sujet défini",
    mqtt_topic: "Thème (Topic)"
  };

  // src-blockly/i18n/it.json
  var it_default = {
    mqtt_anyInstance: "Tutte le istanze",
    mqtt_message: "Messaggio",
    mqtt_retain: "Retain",
    mqtt_sendmessage: "Messaggio MQTT",
    mqtt_tooltip: "Invia un messaggio su un argomento definito dall'utente",
    mqtt_topic: "Argomento (Topic)"
  };

  // src-blockly/i18n/nl.json
  var nl_default = {
    mqtt_anyInstance: "Alle instanties",
    mqtt_message: "Bericht",
    mqtt_retain: "Retain",
    mqtt_sendmessage: "MQT",
    mqtt_tooltip: "Stuur een bericht naar een gebruiker",
    mqtt_topic: "Ondertiteling (Topic)"
  };

  // src-blockly/i18n/pl.json
  var pl_default = {
    mqtt_anyInstance: "Wszystkie instancje",
    mqtt_message: "Message",
    mqtt_retain: "Retain",
    mqtt_sendmessage: "MQTT",
    mqtt_tooltip: "Wysyłanie wiadomości na temat użytkownika określonego tematu",
    mqtt_topic: "Topi (Topic)"
  };

  // src-blockly/i18n/pt.json
  var pt_default = {
    mqtt_anyInstance: "Todas as instâncias",
    mqtt_message: "Mensagem",
    mqtt_retain: "Retain",
    mqtt_sendmessage: "MQTT mensagem",
    mqtt_tooltip: "Enviar uma mensagem sobre um tópico definido pelo usuário",
    mqtt_topic: "Assunto (Topic)"
  };

  // src-blockly/i18n/ru.json
  var ru_default = {
    mqtt_anyInstance: "Все экземпляры",
    mqtt_message: "Сообщение",
    mqtt_retain: "Retain",
    mqtt_sendmessage: "MQTT сообщение",
    mqtt_tooltip: "Отправить сообщение на определенную тему пользователя",
    mqtt_topic: "Тема (Topic)"
  };

  // src-blockly/i18n/uk.json
  var uk_default = {
    mqtt_anyInstance: "Всі екземпляри",
    mqtt_message: "Новини",
    mqtt_retain: "Retain",
    mqtt_sendmessage: "MQTT повідомлення",
    mqtt_tooltip: "Надіслати повідомлення на певну тему користувача",
    mqtt_topic: "Головна (Topic)"
  };

  // src-blockly/i18n/zh-cn.json
  var zh_cn_default = {
    mqtt_anyInstance: "所有案件",
    mqtt_message: "导 言",
    mqtt_retain: "Retain",
    mqtt_sendmessage: "MQTT信息",
    mqtt_tooltip: "关于用户界定专题的信息",
    mqtt_topic: "议题 (Topic)"
  };

  // src-blockly/words.ts
  var Blockly3 = window.Blockly;
  var LANGUAGES = {
    de: de_default,
    en: en_default,
    es: es_default,
    fr: fr_default,
    it: it_default,
    nl: nl_default,
    pl: pl_default,
    pt: pt_default,
    ru: ru_default,
    uk: uk_default,
    "zh-cn": zh_cn_default
  };
  var DOCS = "https://github.com/ioBroker/ioBroker.mqtt/blob/master/docs";
  function installWords() {
    Blockly3.Translate || (Blockly3.Translate = function(word, lang) {
      lang || (lang = window.systemLang);
      const entry = Blockly3.Words?.[word];
      return entry ? entry[lang || "en"] || entry.en : word;
    });
    const words = {};
    for (const [lang, texts] of Object.entries(LANGUAGES)) {
      for (const [word, text] of Object.entries(texts)) {
        if (text) {
          (words[word] || (words[word] = {}))[lang] = text;
        }
      }
    }
    Object.assign(Blockly3.Words, words);
    Blockly3.Words.mqtt_help = {
      en: `${DOCS}/en/README.md`,
      de: `${DOCS}/de/README.md`
    };
  }

  // src-blockly/blockly.ts
  installWords();
  installSendMessage();
})();
