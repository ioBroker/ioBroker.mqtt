// check if tmp directory exists
var fs              = require('fs');
var path            = require('path');
var child_process   = require('child_process');
var rootDir         = path.normalize(__dirname + '/../../');
var debug           = typeof v8debug === 'object';

var adapterName = path.normalize(rootDir).replace(/\\/g, '/').split('/');
adapterName = adapterName[adapterName.length - 2];

var pid = null;

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
    var objects = JSON.parse(f.toString());
    objects['system.adapter.admin.0'].common.enabled = false;
    fs.writeFileSync(rootDir + 'tmp/iobroker-data/objects.json.original', JSON.stringify(objects));
    f = fs.readFileSync(rootDir + 'tmp/iobroker-data/states.json');
    fs.writeFileSync(rootDir + 'tmp/iobroker-data/states.json.original', f);
}

function restoreOriginalFiles() {
    var f = fs.readFileSync(rootDir + 'tmp/iobroker-data/objects.json.original');
    fs.writeFileSync(rootDir + 'tmp/iobroker-data/objects.json', f);
    f = fs.readFileSync(rootDir + 'tmp/iobroker-data/states.json.original');
    fs.writeFileSync(rootDir + 'tmp/iobroker-data/states.json', f);
}

function installAdapter() {
    // make first install
    child_process.execSync('node node_modules/iobroker.js-controller/iobroker.js add ' + adapterName.split('.').pop(), {
        cwd:   rootDir + 'tmp',
        stdio: [0, 1, 2]
    });
}

function installJsController(cb) {
    if (!fs.existsSync(rootDir + 'tmp/node_modules/iobroker.js-controller')) {
        // TODO check if port 9000 is free, else admin adapter will be added to running instance
        var client = new require('net').Socket();
        client.connect(9000, '127.0.0.1', function() {
            console.error('One instance of ioBroker is running on this PC');
            process.exit(0);
        });

        setTimeout(function () {
            client.destroy();

            child_process.execSync('npm install iobroker.js-controller --prefix ./', {
                cwd:   rootDir + 'tmp/',
                stdio: [0, 1, 2]
            });

            // let npm install admin and run setup
            setTimeout(function () {
                child_process.execSync('node node_modules/iobroker.js-controller/iobroker.js stop', {
                    cwd:   rootDir + 'tmp',
                    stdio: [0, 1, 2]
                });

                // change ports for object and state DBs
                var config = require(rootDir + 'tmp/iobroker-data/iobroker.json');
                config.objects.port = 19001;
                config.states.port  = 19000;
                fs.writeFileSync(rootDir + 'tmp/iobroker-data/iobroker.json', JSON.stringify(config, null, 2));

                copyAdapterToController();
                installAdapter();
                storeOriginalFiles();
                if (cb) cb(true);
            }, 4000);
        }, 1000);
    } else {
        setTimeout(function () {
            if (cb) cb(false);
        }, 0);
    }
}

function copyAdapterToController() {
    // Copy adapter to tmp/node_modules/iobroker.adapter
    copyFolderRecursiveSync(rootDir, rootDir + 'tmp/node_modules/', ['.idea', 'test', 'tmp']);
    console.log('Adapter copied.');
}

function clearControllerLog() {
    var dirPath = rootDir + 'tmp/log';
    var files;
    try {
        files = fs.readdirSync(dirPath); }
    catch(e) {
        console.error('Cannot read "' + dirPath + '"');
        return;
    }
    if (files.length > 0) {
        for (var i = 0; i < files.length; i++) {
            var filePath = dirPath + '/' + files[i];
            fs.unlinkSync(filePath);
        }
    }
}

function setupController(cb) {
    installJsController(function (isInited) {
        if (!isInited) {
            restoreOriginalFiles();
            copyAdapterToController();
            clearControllerLog();
        }
        if (cb) cb();
    });
}

function startController(cb) {
    if (pid) {
        console.error('Controller is already started!');
    } else {
        try {
            if (debug) {
                // start controller
                pid = child_process.exec('node node_modules/iobroker.js-controller/controller.js', {
                    cwd:   rootDir + 'tmp',
                    stdio: [0, 1, 2]
                });
            } else {
                // start controller
                pid = child_process.fork(rootDir + 'tmp/node_modules/iobroker.js-controller/controller.js', {
                    cwd:   rootDir + 'tmp',
                    stdio: [0, 1, 2]
                });
            }

        } catch (error) {
            console.log(JSON.stringify(error));
        }
    }

    if (cb) {
        setTimeout(function () {
            cb();
        }, 0);
    }
}

function stopController(cb) {
    if (!pid) {
        console.error('Controller is not running!');
        if (cb) {
            setTimeout(function () {
                cb();
            }, 0);
        }
    } else {
        pid.on('close', function (code, signal) {
            console.log('child process terminated due to receipt of signal ' + signal);
            if (cb) {
                cb();
                cb = null;
            }
        });
        pid.kill('SIGTERM');
        setTimeout(function () {
            if (cb) {
                cb();
                cb = null;
            }
        }, 2000);
    }
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
    module.exports.setupController  = setupController;
}