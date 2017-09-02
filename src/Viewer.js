var Renderer = require('qtek/lib/Renderer');
var GLTF2Loader = require('qtek/lib/loader/GLTF2');
var Vector3 = require('qtek/lib/math/Vector3');
var Animation = require('qtek/lib/animation/Animation');
var meshUtil = require('qtek/lib/util/mesh');
var Task = require('qtek/lib/async/Task');
var TaskGroup = require('qtek/lib/async/TaskGroup');
var util = require('qtek/lib/core/util');
var Node = require('qtek/lib/Node');
var RenderMain = require('./graphic/RenderMain');
var graphicHelper = require('./graphic/helper');
var SceneHelper = require('./graphic/SceneHelper');

var getBoundingBoxWithSkinning = require('./util/getBoundingBoxWithSkinning');
var OrbitControl = require('./OrbitControl');
var HotspotManager = require('./HotspotManager');

/**
 * @constructor
 * @param {HTMLDivElement} dom Root node
 * @param {Object} [opts]
 * @param {Object} [opts.shadow]
 * @param {boolean} [opts.devicePixelRatio]
 * @param {Object} [opts.postEffect]
 * @param {Object} [opts.mainLight]
 * @param {Object} [opts.ambientLight]
 * @param {Object} [opts.ambientCubemapLight]
 */
function Viewer(dom, opts) {

    this.init(dom, opts);
}

Viewer.prototype.init = function (dom, opts) {
    opts = opts || {};

    /**
     * @type {HTMLDivElement}
     */
    this.root = dom;

    /**
     * @private
     */
    this._animation = new Animation();

    var renderer = new Renderer({
        devicePixelRatio: opts.devicePixelRatio || window.devicePixelRatio
    });
    dom.appendChild(renderer.canvas);
    renderer.canvas.style.cssText = 'position:absolute;left:0;top:0';

    /**
     * @private
     */
    this._renderer = renderer;

    this._renderMain = new RenderMain(renderer, opts.shadow, 'perspective');

    this._cameraControl = new OrbitControl({
        renderer: renderer,
        animation: this._animation,
        dom: dom
    });
    this._cameraControl.setCamera(this._renderMain.camera);
    this._cameraControl.init();

    this._hotspotManager = new HotspotManager({
        dom: dom,
        renderer: renderer,
        camera: this._renderMain.camera
    });

    /**
     * List of skeletons
     */
    this._skeletons = [];
    /**
     * List of animation clips
     */
    this._clips = [];
    /**
     * Map of materials
     */
    this._materialsMap = {};

    this._sceneHelper = new SceneHelper(this._renderMain.scene);
    this._initLights(opts);

    this.resize();

    if (opts.postEffect) {
        this.setPostEffect(opts.postEffect);
    }
    if (opts.mainLight) {
        this.setMainLight(opts.mainLight);
    }
    if (opts.ambientLight) {
        this.setAmbientLight(opts.ambientLight);
    }
    if (opts.ambientCubemapLight) {
        this.setAmbientCubemapLight(opts.ambientCubemapLight);
    }
    
    this._cameraControl.on('update', this.refresh, this);
};

Viewer.prototype._initLights = function (opts) {
    this._sceneHelper.initLight(this._renderMain.scene);
};

Viewer.prototype._addModel = function (modelNode, nodes, skeletons, clips) {
    // Remove previous loaded
    var prevModelNode = this._modelNode;
    if (prevModelNode) {
        this._renderer.disposeNode(prevModelNode);
        this._renderMain.scene.remove(prevModelNode);
    }

    this._skeletons.forEach(function (skeleton) {
        if (skeleton.__debugScene) {
            this._renderer.disposeScene(skeleton.__debugScene);
        }
    }, this);

    this._renderMain.scene.add(modelNode);

    this._skeletons = skeletons.slice();
    this._modelNode = modelNode;

    this._setAnimationClips(clips);

    // Not save if glTF has only animation info
    if (nodes && nodes.length) {
        this._nodes = nodes;
        var materialsMap = {};
        // Save material
        nodes.forEach(function (node) {
            if (node.material) {
                var material = node.material;
                // Avoid name duplicate
                materialsMap[material.name] = materialsMap[material.name] || [];
                materialsMap[material.name].push(material);
            }
        }, this);

        this._materialsMap = materialsMap;
    }

    this._updateMaterialsSRGB();
};

Viewer.prototype._setAnimationClips = function (clips) {

    this._clips.forEach(function (clip) {
        this._animation.removeClip(clip);
    }, this);

    var self = this;
    clips.forEach(function (clip) {
        if (!clip.target) {
            clip.target = this._nodes[clip.targetNodeIndex];
        }
        // Override onframe.
        clip.onframe = function () {
            self.refresh();
        };

        this._animation.addClip(clip);
    }, this);

    this._clips = clips.slice();
};

Viewer.prototype.resize = function () {
    var renderer = this._renderer;
    renderer.resize(this.root.clientWidth, this.root.clientHeight);
    this._renderMain.setViewport(0, 0, renderer.getWidth(), renderer.getHeight(), renderer.getDevicePixelRatio());
};

/**
 * Scale model to auto fit the camera.
 */
Viewer.prototype.autoFitModel = function (fitSize) {
    fitSize = fitSize || 10;
    if (this._modelNode) {
        this.setPose(0);
        this._modelNode.update();
        var bbox = getBoundingBoxWithSkinning(this._modelNode);

        var size = new Vector3();
        size.copy(bbox.max).sub(bbox.min);

        var center = new Vector3();
        center.copy(bbox.max).add(bbox.min).scale(0.5);

        var scale = fitSize / Math.max(size.x, size.y, size.z);

        this._modelNode.scale.set(scale, scale, scale);
        this._modelNode.position.copy(center).scale(-scale);

        this._hotspotManager.setBoundingBox(bbox.min._array, bbox.max._array);
    }
};

/**
 * Load glTF model resource
 * @param {string} url Model url
 * @param {Object} [opts]
 * @param {Object} [opts.shader='lambert'] 'basic'|'lambert'|'standard'
 * @param {boolean} [opts.includeTexture=true]
 */
Viewer.prototype.loadModel = function (url, opts) {
    opts = opts || {};
    var alphaCutoff = opts.alphaCutoff != null ? opts.alphaCutoff : 0.95;
    if (!url) {
        throw new Error('URL of model is not provided');
    }
    var shaderName = opts.shader || 'lambert';

    var loader = new GLTF2Loader({
        rootNode: new Node(),
        shaderName: 'qtek.' + shaderName,
        textureRootPath: opts.textureRootPath,
        bufferRootPath: opts.bufferRootPath,
        crossOrigin: 'Anonymous',
        includeTexture: opts.includeTexture == null ? true : opts.includeTexture,
        textureFlipY: true
    });
    loader.load(url);

    var task = new Task();

    var vertexCount = 0;
    var triangleCount = 0;
    var nodeCount = 0;

    loader.success(function (res) {
        var meshNeedsSplit = [];
        res.rootNode.traverse(function (mesh) {
            nodeCount++;
            if (mesh.skeleton) {
                meshNeedsSplit.push(mesh);
            }
            if (mesh.geometry) {
                triangleCount += mesh.geometry.triangleCount;
                vertexCount += mesh.geometry.vertexCount;
            }
        });
        meshNeedsSplit.forEach(function (mesh) {
            meshUtil.splitByJoints(mesh, 15, true, loader.shaderLibrary, 'qtek.' + shaderName);
        }, this);
        res.rootNode.traverse(function (mesh) {
            if (mesh.geometry) {
                mesh.geometry.updateBoundingBox();
                mesh.culling = false;
            }
            if (mesh.skeleton) {
                // Avoid wrong culling when skinning matrices transforms alot.
                mesh.frustumCulling = false;
            }
            if (mesh.material) {
                mesh.material.shader.define('fragment', 'DIFFUSEMAP_ALPHA_ALPHA');
                mesh.material.shader.define('fragment', 'ALPHA_TEST');
                mesh.material.shader.precision = 'mediump';
                mesh.material.set('alphaCutoff', alphaCutoff);

                // Transparent mesh not cast shadow
                if (mesh.material.transparent) {
                    mesh.castShadow = false;
                }
            }
        });

        this._addModel(res.rootNode, res.nodes, res.skeletons, res.clips);

        this.autoFitModel();

        this.setCameraControl({
            distance: 20,
            minDisntance: 2,
            maxDistance: 100,
            center: [0, 0, 0]
        });

        var stat = {
            triangleCount: triangleCount,
            vertexCount: vertexCount,
            nodeCount: nodeCount,
            meshCount: Object.keys(res.meshes).length,
            materialCount: Object.keys(res.materials).length,
            textureCount: Object.keys(res.textures).length
        };

        task.trigger('loadmodel', stat);
        
        var loadingTextures = [];
        util.each(res.textures, function (texture) {
            if (!texture.isRenderable()) {
                loadingTextures.push(texture);
            }
        });
        var taskGroup = new TaskGroup();
        taskGroup.allSettled(loadingTextures).success(function () {
            task.trigger('ready');
            this.refresh();
        }, this);

        this.refresh();
    }, this);
    loader.error(function () {
        task.trigger('error');
    });

    return task;
};

/**
 * Load animation glTF
 * @param {string} url
 */
Viewer.prototype.loadAnimation = function (url) {
    var loader = new GLTF2Loader({
        rootNode: new Node(),
        crossOrigin: 'Anonymous'
    });
    loader.load(url);
    loader.success(function (res) {
        this._setAnimationClips(res.clips);
        // this.autoFitModel();
    }, this);

    return loader;
};

/**
 * Pause animation
 */
Viewer.prototype.pauseAnimation = function () {
    this._clips.forEach(function (clip) {
        clip.pause();
    });
};

/**
 * Resume animation
 */
Viewer.prototype.resumeAnimation = function () {
    this._clips.forEach(function (clip) {
        clip.resume();
    });
};

/**
 * @param {Object} [opts]
 * @param {number} [opts.distance]
 * @param {number} [opts.minDistance]
 * @param {number} [opts.maxDistance]
 * @param {number} [opts.alpha]
 * @param {number} [opts.beta]
 * @param {number} [opts.minAlpha]
 * @param {number} [opts.maxAlpha]
 * @param {number} [opts.minBeta]
 * @param {number} [opts.maxBeta]
 * @param {number} [opts.rotateSensitivity]
 * @param {number} [opts.panSensitivity]
 * @param {number} [opts.zoomSensitivity]
 */
Viewer.prototype.setCameraControl = function (opts) {
    this._cameraControl.setOption(opts);
    this.refresh();
};

/**
 * @param {Object} [opts]
 * @param {number} [opts.intensity]
 * @param {string} [opts.color]
 * @param {number} [opts.alpha]
 * @param {number} [opts.beta]
 * @param {number} [opts.shadow]
 * @param {number} [opts.shadowQuality]
 */
Viewer.prototype.setMainLight = function (opts) {
    this._sceneHelper.updateMainLight(opts, this);
    this.refresh();
};

/**
 * @param {Object} [opts]
 * @param {number} [opts.intensity]
 * @param {string} [opts.color]
 */
Viewer.prototype.setAmbientLight = function (opts) {
    this._sceneHelper.updateAmbientLight(opts, this);
    this.refresh();
};
/**
 * @param {Object} [opts]
 * @param {Object} [opts.texture]
 * @param {Object} [opts.exposure]
 * @param {number} [opts.diffuseIntensity]
 * @param {number} [opts.specularIntensity]
 */
Viewer.prototype.setAmbientCubemapLight = function (opts) {
    this._sceneHelper.updateAmbientCubemapLight(opts, this);
    this.refresh();
};

/**
 * @param {string} name
 * @param {Object} materialCfg
 * @param {boolean} [materialCfg.transparent]
 * @param {boolean} [materialCfg.alphaCutoff]
 */
Viewer.prototype.setMaterial = function (name, materialCfg) {
    materialCfg = materialCfg || {};
    var materials = this._materialsMap[name];
    if (!materials) {
        console.warn('Material %s not exits', name);
        return;
    }
    materials.forEach(function (mat) {
        if (materialCfg.transparent != null) {
            mat.transparent = !!materialCfg.transparent;
            mat.depthMask = !materialCfg.transparent;
        }
        if (materialCfg.alphaCutoff != null) {
            mat.set('alphaCutoff', materialCfg.alphaCutoff);
        }
    }, this);
    this.refresh();
};

/**
 * @param {Object} opts
 */
Viewer.prototype.setPostEffect = function (opts) {
    this._renderMain.setPostEffect(opts);

    this._updateMaterialsSRGB();
    this.refresh();
};

/**
 * Start loop.
 */
Viewer.prototype.start = function () {
    if (this._disposed) {
        console.warn('Viewer already disposed');
        return;
    }

    this._animation.start();
    this._animation.on('frame', this._loop, this);
};

/**
 * Stop loop.
 */
Viewer.prototype.stop = function () {
    this._animation.stop();
    this._animation.off('frame', this._loop);
};

/**
 * Add html tip
 */
Viewer.prototype.addHotspot = function (position, tipHTML) {
    return this._hotspotManager.add(position, tipHTML);
};

Viewer.prototype.setPose = function (time) {
    this._clips.forEach(function (clip) {
        clip.setTime(time);
    });
    this._updateClipAndSkeletons();

    this.refresh();
};

Viewer.prototype.refresh = function () {
    this._needsRefresh = true;
};

Viewer.prototype.getRenderer = function () {
    return this._renderer;
};

Viewer.prototype._updateMaterialsSRGB = function () {
    var isLinearSpace = this._renderMain.isLinearSpace();
    for (var name in this._materialsMap) {
        var materials = this._materialsMap[name];
        for (var i = 0; i < materials.length; i++) {
            materials[i].shader[isLinearSpace ? 'define' : 'undefine']('fragment', 'SRGB_DECODE');
        }
    }
};

Viewer.prototype._updateClipAndSkeletons = function () {
    // Manually sync the transform for nodes not in skeleton
    this._clips.forEach(function (clip) {
        if (clip.channels.position) {
            clip.target.position.setArray(clip.position);
        }
        if (clip.channels.rotation) {
            clip.target.rotation.setArray(clip.rotation);
        }
        if (clip.channels.scale) {
            clip.target.scale.setArray(clip.scale);
        }
    });
    this._skeletons.forEach(function (skeleton) {
        skeleton.update();
    });
};

Viewer.prototype._loop = function (deltaTime) {
    if (this._disposed) {
        return;
    }
    if (!this._needsRefresh) {
        return;
    }

    this._needsRefresh = false;

    this._updateClipAndSkeletons();

    this._renderMain.prepareRender();
    this._renderMain.render();
    // this._renderer.render(this._renderMain.scene, this._renderMain.camera);

    this._startAccumulating();

    this._hotspotManager.update();
};

var accumulatingId = 1;
Viewer.prototype._stopAccumulating = function () {
    this._accumulatingId = 0;
    clearTimeout(this._accumulatingTimeout);
};

Viewer.prototype._startAccumulating = function (immediate) {
    var self = this;
    this._stopAccumulating();

    var needsAccumulate = self._renderMain.needsAccumulate();
    if (!needsAccumulate) {
        return;
    }

    function accumulate(id) {
        if (!self._accumulatingId || id !== self._accumulatingId) {
            return;
        }

        var isFinished = self._renderMain.isAccumulateFinished() && needsAccumulate;

        if (!isFinished) {
            self._renderMain.render(true);

            if (immediate) {
                accumulate(id);
            }
            else {
                requestAnimationFrame(function () {
                    accumulate(id);
                });
            }
        }
    }

    this._accumulatingId = accumulatingId++;

    if (immediate) {
        accumulate(self._accumulatingId);
    }
    else {
        this._accumulatingTimeout = setTimeout(function () {
            accumulate(self._accumulatingId);
        }, 50);
    }
};

/**
 * Dispose viewer.
 */
Viewer.prototype.dispose = function () {
    this._disposed = true;
    
    this._renderer.disposeScene(this._renderMain.scene);
    this._renderMain.dispose(this._renderer);
    this._sceneHelper.dispose(this._renderer);

    this._renderer.dispose();
    this._cameraControl.dispose();
    this.root.innerHTML = '';

    this.stop();
};

module.exports = Viewer;




