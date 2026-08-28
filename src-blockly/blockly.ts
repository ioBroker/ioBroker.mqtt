/**
 * The ioBroker.mqtt blocks for the Blockly editor of ioBroker.javascript.
 *
 * This is the source of `admin/blockly.js`, which is a generated bundle - do not edit that file,
 * run `npm run build:blockly` instead.
 *
 * The editor loads the bundle as a classic script *after* Blockly itself is up, so the runtime is
 * taken from `window.Blockly` and the `blockly` package contributes types only. See
 * `src-blockly/README.md` for why importing the runtime would break the blocks.
 */
import { installSendMessage } from './blocks/sendMessage';
import { installWords } from './words';

// The words have to be in place before a block asks for its labels
installWords();

installSendMessage();
