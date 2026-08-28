/**
 * The globals the ioBroker.javascript editor puts in place before it loads `admin/blockly.js`.
 *
 * These are deliberately *ambient declarations only*: the block files must take their Blockly runtime
 * from `window.Blockly`, never from an `import ... from 'blockly/core'`. Importing the runtime would
 * bundle a second, private Blockly instance into `admin/blockly.js`, and every block registered on
 * it would be invisible to the editor's instance.
 */
import type { Block, FieldCheckbox, FieldDropdown } from 'blockly/core';

/**
 * A block definition. Beside `init` it may carry helpers of its own, so the members are left open.
 * `init` is declared without a `this` type on purpose - every block annotates the `this` it needs.
 */
interface BlockDefinition {
    init: () => void;
    [member: string]: unknown;
}

/**
 * The JavaScript code generator. Only the members the block files actually use are declared - the
 * editor's instance is a full Blockly `JavascriptGenerator`.
 */
interface IoBrokerJavaScriptGenerator {
    ORDER_ATOMIC: number;
    /** Blockly >= 10 looks up generators here. Missing on the ancient editors. */
    forBlock?: Record<string, (block: Block) => string | [string, number] | null>;
    valueToCode: (block: Block, name: string, order: number) => string;
    /** Pre-10 editors registered generators directly on the generator object */
    [blockType: string]: unknown;
}

/** `Blockly` plus the extras the ioBroker editor adds on top of the stock library */
interface IoBrokerBlockly {
    Blocks: Record<string, BlockDefinition>;
    JavaScript: IoBrokerJavaScriptGenerator;

    FieldDropdown: new (menuGenerator: [string, string][]) => FieldDropdown;
    FieldCheckbox: new (state?: string | boolean) => FieldCheckbox;

    /** Word table shared by all adapters; `Blockly.Translate` resolves against it */
    Words: Record<string, Record<string, string>>;
    Translate: (word: string, lang?: string) => string;

    /**
     * Defined by the editor in `google-blockly/own/blocks_sendto.js`. `blocks` collects the toolbox
     * XML of every adapter block, `HUE` is the shared colour of the "sendTo" category.
     */
    Sendto: {
        HUE: number;
        blocks: Record<string, string>;
    };
}

declare global {
    interface Window {
        Blockly: IoBrokerBlockly;
        /** ioBroker system language, set by the editor before the blocks are loaded */
        systemLang?: string;
        /** The editor's admin bridge. `instances` lists every `system.adapter.*` object. */
        main?: {
            instances?: string[];
        };
    }
}
