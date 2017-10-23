import Filer from 'filer.js';
import { updateGLTFMaterials, mergeMetallicRoughness, mergeSpecularGlossiness, TEXTURES } from './glTFHelper';

var filer = new Filer();
var filerInited = false;

function init(cb) {
    filer.init({
        persistent: true,
        size: 1024 * 1024 * 200
    }, function (fs) {
        filerInited = true;

        filer.mkdir('/project', false, function () {
            Promise.all([
                loadModelFromFS(),
                loadSceneFromFS()
            ]).then(function (result) {
                cb && cb(result[0][0], result[0][1], result[1]);
            });
        }, function (err) {
            swal('Create project error.' + err.toString());
        });
    }, function (err) {
        swal('Init error.' + err.toString());
    });
}

function saveModelFiles(files) {
    if (!filerInited) {
        swal('Not inited yet.');
    }
    function doSave() {
        filer.mkdir('/project/model', false, function () {
            var count = files.length;
            files.forEach(function (file) {
                filer.write('/project/model/' + file.name, { data: file, type: file.type }, function () {
                    count--;
                    if (count === 0) {
                    }
                }, function (err) {
                    swal(err.toString());
                });
            });
        }, function (err) {
            swal(err.toString());
        });
    }
    filer.ls('/project/model', function (entries) {
        var count = entries.length;
        if (count === 0) {
            doSave();
        }
        entries.forEach(function (entry) {
            filer.rm(entry, function () {
                count--;
                if (count === 0) {
                    doSave();
                }
            });
        });
    }, function (err) {
        doSave();
    });
}

function saveSceneConfig(sceneCfg) {
    filer.mkdir('/project', false, function () {
        filer.write('/project/scene.json', {
            data: JSON.stringify(sceneCfg, null, 2),
            type: 'application/json'
        }, function () {
            console.log('Saved scene');
        }, function (err) {
            console.error('Failed to save scene,' + err.toString());
        });
    });
}

function loadSceneFromFS() {
    return new Promise(function (resolve, reject) {
        filer.create('/project/scene.json', true, function () {
            resolve(null);
        }, function () {
            // FIXME it will throw async error if file not exists
            filer.open('/project/scene.json', function (file) {
                FileAPI.readAsText(file, 'utf-8', function (evt) {
                    if (evt.type === 'load') {
                        resolve(JSON.parse(evt.result || '{}'));
                    }
                });
            }, function (err) {
                resolve(null);
            });
        });
    });
}

function loadModelFromFS() {
    return new Promise(function (resolve, reject) {
        readModelFilesFromFS().then(function (files) {
            if (!files) {
                resolve([]);
            }
            else {
                loadModelFiles(files, function (glTF, filesMap) {
                    resolve([glTF, filesMap]);
                });
            }
        });
    });
}

function writeTextureImage(file) {
    filer.write('/project/model/' + file.name, { data: file, type: file.type }, function () {
        console.log('Writed file ' + file.name);
    }, function (err) {
        swal(err.toString());
    });
}

var filesMap = {};
function loadModelFiles(files, cb) {
    var glTFFile = files.find(function (file) {
        return file.name.match(/.gltf$/);
    });
    if (!glTFFile) {
        swal('glTF file nout found');
    }

    // Unload urls after use
    for (var name in filesMap) {
        URL.revokeObjectURL(filesMap[name]);
    }
    filesMap = {};

    function readAllFiles(cb) {
        var count = 0;
        files.forEach(function (file) {
            if (file !== glTFFile) {
                count++;
                filesMap[file.name] = URL.createObjectURL(file);
            }
        });
        cb && cb(filesMap);
    }
    FileAPI.readAsText(glTFFile, 'utf-8', function (evt) {
        if (evt.type == 'load') {
            // Success
             var json = JSON.parse(evt.result);
             readAllFiles(function (filesMap) {
                cb && cb(json, filesMap);
             });
        } else if(evt.type =='progress'){
            var pr = evt.loaded / evt.total * 100;
        }
    });
}

function removeProject() {
    filer.rm('/project', function () {
        filer.mkdir('/project', false, function () {}, function (err) {
            console.error(err.toString());
        });
    }, function (err) {
        console.log(err.toString());
    });
}

function readModelFilesFromFS() {
    return new Promise(function (resolve, reject) {
        filer.ls('/project/model', function (entries) {
            var files = [];
            entries = entries.filter(function (entry) {
                return entry.isFile;
            });
            entries.forEach(function (entry) {
                filer.open(entry, function (file) {
                    files.push(file);
                    if (files.length === entries.length) {
                        resolve(files);
                    }
                });
            });
        }, function (err) {
            resolve(null);
        });
    });
}

function downloadProject() {
    Promise.all([
        readModelFilesFromFS(),
        loadSceneFromFS()
    ]).then(function (result) {
        var files = result[0];
        var loadedSceneCfg = result[1];

        var zip = new JSZip();

        var glTFFile;
        var filesMap = {};
        files = (files || []).filter(function (file) {
            if (file.name.match(/.gltf$/)) {
                glTFFile = file;
            }
            else {
                filesMap[file.name] = file;
                return true;
            }
        });

        if (!glTFFile) {
            swal('No glTF file in project!');
        }

        function removeFile(file) {
            var idx = files.indexOf(file);
            if (idx >= 0) {
                files.splice(idx, 1);
            }
        }

        Promise.all(loadedSceneCfg.materials.map(function (matConfig, idx) {
            // TODO Different material use same metalnessMap and roughnessMap.
            if (matConfig.metalnessMap || matConfig.roughnessMap) {
                var metalnessFile = filesMap[matConfig.metalnessMap];
                var roughnessFile = filesMap[matConfig.roughnessMap];
                return new Promise(function (resolve) {
                    mergeMetallicRoughness(metalnessFile, roughnessFile, matConfig.metalness, matConfig.roughness).then(function (canvas) {
                        var fileName = matConfig.name + '$' + idx + '_metallicRoughness.png';
                        var dataUrl = canvas.toDataURL();
                        dataUrl = dataUrl.slice('data:image/png;base64,'.length);
                        zip.file(fileName, dataUrl, {
                            base64: true
                        });
                        matConfig.metalnessMap = matConfig.roughnessMap = fileName;

                        console.log('Merged %s, %s to %s', matConfig.metalnessMap, matConfig.roughnessMap, fileName);

                        resolve();
                    });
                });
            }
            else if (matConfig.specularMap || matConfig.glossinessMap) {
                var specularFile = filesMap[matConfig.specularMap];
                var glossinessFile = filesMap[matConfig.glossinessMap];
                return new Promise(function (resolve) {
                    mergeSpecularGlossiness(specularFile, glossinessFile, matConfig.specularColor, matConfig.glossiness).then(function (canvas) {
                        var fileName = matConfig.name + '$' + idx + '_specularGlossiness.png';
                        var dataUrl = canvas.toDataURL();
                        dataUrl = dataUrl.slice('data:image/png;base64,'.length);
                        zip.file(fileName, dataUrl, {
                            base64: true
                        });
                        matConfig.specularMap = matConfig.glossinessMap = fileName;

                        console.log('Merged %s, %s to %s', matConfig.specularMap, matConfig.glossinessMap, fileName);

                        resolve();
                    });
                });
            }
            return null;
        }).filter(function (p) { return p != null; })).then(function () {
            FileAPI.readAsText(glTFFile, 'utf-8', function (e) {
                if (e.type == 'load') {
                    var newGLTF = updateGLTFMaterials(JSON.parse(e.result), loadedSceneCfg);
                    // Remove unused images
                    files = files.filter(function (file) {
                        if (file.type.match(/image/)) {
                            return newGLTF.images && newGLTF.images.some(function (img) {
                                return img.uri === file.name;
                            });
                        }
                        // Other is binary file.
                        return true;
                    });
                    zip.file(glTFFile.name, JSON.stringify(newGLTF, null, 2));
                    files.forEach(function (file) {
                        zip.file(file.name, file);         
                    });
                    zip.generateAsync({ type: 'blob' })
                        .then(function (blob) {
                            saveAs(blob, 'model.zip');
                        });
                }
            });
        });
    });
}


export {
    init,
    saveModelFiles,
    loadModelFiles,
    saveSceneConfig,
    writeTextureImage,
    removeProject,
    downloadProject
};