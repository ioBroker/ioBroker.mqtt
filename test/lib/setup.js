// check if tmp directory exists
var fs              = require('fs');
var path            = require('path');
var child_process   = require('child_process');
var rootDir         = path.normalize(__dirname + '/../../');

var adapterName = path.normalize(rootDir).replace(/\\/g, '/').split('/');
adapterName = adapterName[adapterName.length - 2];

function copyFileSync(source, target) {

    var targetFile = target;

    //if target is a directory a new file with the same name will be created
    if (fs.existsSync(target)) {
        if ( fs.lstatSync( target ).isDirectory() ) {
            targetFile = path.join(target, path.basename(source));
        }
    }

    fs.writeFileSync(targetFile, fs.readFileSync(source));
}

function copyFolderRecursiveSync(source, target, ignore) {
    var files = [];

    //check if folder needs to be created or integrated
    var targetFolder = path.join(target, path.basename(source));
    if ( !fs.existsSync(targetFolder) ) {
        fs.mkdirSync(targetFolder);
    }

    //copy
    if (fs.lstatSync(source).isDirectory()) {
        files = fs.readdirSync(source);
        files.forEach(function (file) {
            if (ignore && ignore.indexOf(file) !== -1) {
                return;
            }

            var curSource = path.join(source, file);
            if (fs.lstatSync(curSource).isDirectory()) {
                // ignore grunt files
                if (file.indexOf('grunt') !== -1) return;
                if (file == 'chai') return;
                if (file == 'mocha') return;
                copyFolderRecursiveSync(curSource, targetFolder);
            } else {
                copyFileSync(curSource, targetFolder);
            }
        });
    }
}

if (!fs.existsSync(rootDir + 'tmp')) {
    fs.mkdirSync(rootDir + 'tmp');
}

function storeOriginalFiles() {
    var f = fs.readFileSync(rootDir + 'tmp/iobroker-data/objects.json');
    fs.writeFileSnyc(rootDir + 'tmp/iobroker-data/objects.json.original', f);
    f = fs.readFileSync(rootDir + 'tmp/iobroker-data/states.json');
    fs.writeFileSnyc(rootDir + 'tmp/iobroker-data/states.json.original', f);
}

function restoreOriginalFiles() {
    var f = fs.readFileSync(rootDir + 'tmp/iobroker-data/objects.json.original');
    fs.writeFileSnyc(rootDir + 'tmp/iobroker-data/objects.json', f);
    f = fs.readFileSync(rootDir + 'tmp/iobroker-data/states.json.original');
    fs.writeFileSnyc(rootDir + 'tmp/iobroker-data/states.json', f);
}

function installAdapter() {
    // make first install
    child_process.execSync('node node_modules/iobroker.js-controller/iobroker.js add ' + adapterName.split('.').pop(), {
        cwd:   rootDir + 'tmp',
        stdio: [0, 1, 2]
    });
}

function installJsController() {
    if (!fs.existsSync(rootDir + 'tmp/node_modules/iobroker.js-controller')) {
        child_process.execSync('npm install iobroker.js-controller --prefix ./', {
            cwd:   rootDir + 'tmp/',
            stdio: [0, 1, 2]
        });

        // change ports for object and state DBs
        var config = require(rootDir + 'tmp/iobroker-data/iobroker.json');
        config.objects.port   = 19001;
        config.objects.states = 19000;
        fs.writeFileSync(rootDir + 'tmp/iobroker-data/iobroker.json', JSON.stringify(config, null, 2));

        // stop admin adapter
        child_process.execSync('node node_modules/iobroker.js-controller/iobroker.js stop admin', {
            cwd:   rootDir + 'tmp',
            stdio: [0, 1, 2]
        });

        copyAdapterToController();
        installAdapter();
        storeOriginalFiles();
        return true;
    } else {
        return false;
    }
}

function copyAdapterToController() {
    // Copy adapter to tmp/node_modules/iobroker.adapter
    copyFolderRecursiveSync(rootDir, rootDir + 'tmp/node_modules/', ['.idea', 'test', 'tmp']);
    console.log('Adapter copied.');
}

function startController() {
    // make first install
    child_process.execSync('node node_modules/iobroker.js-controller/iobroker.js start', {
        cwd:   rootDir + 'tmp',
        stdio: [0, 1, 2]
    });
}

function stopController() {
    // make first install
    child_process.execSync('node node_modules/iobroker.js-controller/iobroker.js stop', {
        cwd:   rootDir + 'tmp',
        stdio: [0, 1, 2]
    });
}

if (!installJsController()) {
    restoreOriginalFiles();
    copyAdapterToController();
}

// Setup the adapter
function setAdapterConfig(common, native, instance) {
    var objects = JSON.parse(fs.readFileSync(rootDir + 'tmp/iobroker-data/objects.json').toString());
    var id = 'system.adapter.' + adapterName.split('.').pop() + '.' + (instance || 0);
    if (common) objects[id].common = common;
    if (native) objects[id].native = native;
    fs.writeFileSync(rootDir + 'tmp/iobroker-data/objects.json', JSON.stringify(objects));
}

// Read config of the adapter
function getAdapterConfig(instance) {
    var objects = JSON.parse(fs.readFileSync(rootDir + 'tmp/iobroker-data/objects.json').toString());
    var id      = 'system.adapter.' + adapterName.split('.').pop() + '.' + (instance || 0);
    return objects[id];
}

if (typeof module !== undefined && module.parent) {
    module.exports.getAdapterConfig = getAdapterConfig;
    module.exports.setAdapterConfig = setAdapterConfig;
    module.exports.startController  = startController;
    module.exports.stopController   = stopController;
}