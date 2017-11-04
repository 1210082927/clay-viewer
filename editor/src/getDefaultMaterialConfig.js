
export default function () {
    return {

        name: '',

        type: 'pbrMetallicRoughness',
        
        color: '#fff',

        transparent: false,
        alpha: 1,

        diffuseMap: '',
        normalMap: '',
        parallaxOcclusionScale: 0.01,
        parallaxOcclusionMap: '',

        emission: '#fff',
        emissionIntensity: 0,
        emissiveMap: '',

        uvRepeat: [1, 1],
        
        // Metallic and roughness
        metalness: 0,
        roughness: 0.5,
        metalnessMap: '',
        roughnessMap: '',

        // Specular and glossiness
        glossiness: 0.5,
        specularColor: '#111',
        glossinessMap: '',
        specularMap: '',

        $alphaRange: [0, 1],
        $metalnessRange: [0, 1],
        $roughnessRange: [0, 1],
        $glossinessRange: [0, 1],
        $parallaxOcclusionScaleRange: [0, 0.2],

        $textureTiling: 1
    };
}