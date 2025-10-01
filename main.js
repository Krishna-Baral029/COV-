// Variables for scene, camera, renderer, controls, and model
let scene, camera, renderer, controls, character, lobbyGroup, cityGroup, clock, mixer, walkAction, idleAction;
let isWalkingActive = false;
let loadingManager, loadingScreen;
let playerReady = true; // Track if player is ready (default to ready)

// Model path - only load standing_idle.glb as the base model
// CRITICAL: Only these two files are allowed to be loaded
const MODEL_PATH = 'standing_idle.glb';
const WALK_ANIM_PATH = 'walk.glb';

const ALLOWED_GLB_FILES = [MODEL_PATH, WALK_ANIM_PATH];
console.log('✅ ONLY APPROVED FILES:', ALLOWED_GLB_FILES);

// Helper to verify a GLB URL/path is approved
function isApprovedGLB(url) {
    try {
        const absolute = typeof url === 'string' ? url : String(url);
        return ALLOWED_GLB_FILES.some(function(allowed) { return absolute.includes(allowed); });
    } catch (e) {
        return false;
    }
}

function isForbiddenGLB(url) {
    try {
        const absolute = (typeof url === 'string' ? url : String(url)).toLowerCase();
        // Block any attempt that references the forbidden asset name, regardless of query strings
        return absolute.includes('character_high_quality') && absolute.includes('.glb');
    } catch (e) {
        return false;
    }
}

// Purge any scene nodes that resemble the forbidden model by name
function purgeForbiddenNodes(root) {
    try {
        const tokens = ['character_high_quality', 'characteer_higgh_quality', 'high_quality'];
        root.traverse?.(function(node) {
            try {
                const name = (node && node.name ? String(node.name) : '').toLowerCase();
                if (name && tokens.some(function(t){ return name.includes(t); })) {
                    node.visible = false;
                    if (node.geometry) node.geometry.dispose?.();
                    if (node.material) {
                        if (Array.isArray(node.material)) node.material.forEach(function(m){ m.dispose?.(); });
                        else node.material.dispose?.();
                    }
                }
            } catch (e) {
                // ignore per-node errors
            }
        });
    } catch (e) {
        // ignore traversal errors
    }
}

// Default camera values
const DEFAULT_CAMERA_POS = {
    x: 0,
    y: 4.5,
    z: 7.4
};

// Performance and streaming configuration
const ENABLE_WINDOWS = false; // Disable heavy window meshes for performance
const CHUNK_SIZE = 32; // Larger chunks reduce total objects and draw calls
const CHUNK_RADIUS = 1; // Load a 3x3 grid around the player for smoother streaming
let loadedChunks = new Map(); // key => THREE.Group
let lastChunkX = null, lastChunkZ = null;

// Movement and camera follow settings
const MOVE_SPEED = 5; // units per second
const SPRINT_MULTIPLIER = 2; // Shift+W sprint speed multiplier
const DEFAULT_CAMERA_FOLLOW_HEIGHT = 4.25;
const DEFAULT_CAMERA_FOLLOW_DISTANCE = 8.14;
const CAMERA_HEIGHT_RANGE = { min: 0.8, max: 8.0 };
const CAMERA_DISTANCE_RANGE = { min: 4.0, max: 14.0 };

// ALWAYS use default values - ignore any saved preferences to ensure consistency
let cameraFollowHeight = DEFAULT_CAMERA_FOLLOW_HEIGHT;
let cameraFollowDistance = DEFAULT_CAMERA_FOLLOW_DISTANCE;
const keysPressed = {};

// Pointer-lock mouselook state
const POINTER_SENSITIVITY = 0.0018;
let isPointerLocked = false;
let cameraYaw = 0;   // radians, around Y
let cameraPitch = 0; // radians, up/down (clamped)
let isPaused = false;
let isInGame = false; // true only after city is created
let skipNextMouseDelta = false; // ignore first delta after pointer lock to avoid jump
let movementYaw = 0; // filtered yaw used for movement/orientation only (not camera)

// Camera pitch persistence and constraints (in degrees for UI)
// Limit how far down the camera can look to avoid dipping into the ground/feet
const CAMERA_PITCH_RANGE_DEG = { min: -30, max: 60 };
// Ensure camera stays above character by at least this vertical offset (world units)
const MIN_CAMERA_ABOVE_CHARACTER = 0.6;
const DEFAULT_CAMERA_PITCH_DEG = 23;
// Initialize pitch from default value (ignore saved preferences)
cameraPitch = DEFAULT_CAMERA_PITCH_DEG * Math.PI / 180;

// Audio context for sound effects
let audioContext = null;
let errorSoundBuffer = null;

// Function to initialize audio context (must be called after user interaction)
function initAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        // Load a generic error sound (replace with your own URL if needed)
        fetch('https://interactive-examples.mdn.mozilla.net/media/cc0-audio/error-01.wav')
            .then(response => response.arrayBuffer())
            .then(data => audioContext.decodeAudioData(data))
            .then(buffer => {
                errorSoundBuffer = buffer;
                console.log('Error sound loaded successfully.');
            })
            .catch(e => console.error('Error loading sound:', e));
    }
}

// Function to play the loaded sound
function playErrorSound() {
    if (audioContext && errorSoundBuffer) {
        const source = audioContext.createBufferSource();
        source.buffer = errorSoundBuffer;
        source.connect(audioContext.destination);
        source.start(0);
    }
}

// Clear browser cache for GLB files to avoid stale models
function clearGLBCache() {
    console.log('🧹 Clearing browser cache for GLB files...');

    // List of files whose caches we want to clear
    const forbiddenFiles = [
        'standing_idle.glb',
        'walk.glb'
    ];

    // Clear cache for each forbidden file
    forbiddenFiles.forEach(filename => {
        try {
            // Try to clear from caches API if available
            if ('caches' in window) {
                caches.keys().then(names => {
                    names.forEach(name => {
                        caches.open(name).then(cache => {
                            cache.delete(filename).then(success => {
                                if (success) {
                                    console.log('✅ Cache cleared for:', filename);
                                }
                            });
                        });
                    });
                });
            }

            // Also try to clear from localStorage/sessionStorage if used
            if (typeof Storage !== "undefined") {
                try {
                    localStorage.removeItem(filename);
                    sessionStorage.removeItem(filename);
                } catch (e) {
                    // Ignore storage errors
                }
            }

            console.log('🚫 BLOCKED from cache:', filename);
        } catch (e) {
            console.warn('Could not clear cache for:', filename, e);
        }
    });

    console.log('🛡️ Cache protection active');
}

// Initialize the scene
function init() {
    loadingScreen = document.getElementById('loading-screen');
    clock = new THREE.Clock();

    // Clear browser cache for GLB files
    clearGLBCache();

    // Activate runtime protection against non-approved GLB loading
    runtimeGLBProtection();
    
    // Create a loading manager to track loading progress
    loadingManager = new THREE.LoadingManager();
    loadingManager.onLoad = function() {
        loadingScreen.style.display = 'none';
    };
    
    // Add error handler to loading manager (sanitized)
    loadingManager.onError = function(url) {
        console.error('Error loading resource');
        document.querySelector('.loading-text').textContent = 
            'Error loading a resource. Check console for details.';
    };
    
    // Create scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x151515); // slightly brighter for visibility
    
    // Environment groups for easy switching
    lobbyGroup = new THREE.Group();
    lobbyGroup.name = 'lobbyGroup';
    scene.add(lobbyGroup);
    
    cityGroup = new THREE.Group();
    cityGroup.name = 'cityGroup';
    cityGroup.visible = false;
    scene.add(cityGroup);
    
    // Create camera
    camera = new THREE.PerspectiveCamera(
        45,
        window.innerWidth / window.innerHeight,
        0.1,
        1000
    );
    camera.position.set(
        DEFAULT_CAMERA_POS.x,
        DEFAULT_CAMERA_POS.y,
        DEFAULT_CAMERA_POS.z
    );
    
    // Create renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    // Cap pixel ratio for performance on high-DPI displays
    renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    // Output color space and tone mapping
    if ('outputColorSpace' in renderer) {
        renderer.outputColorSpace = THREE.SRGBColorSpace;
    } else {
        renderer.outputEncoding = THREE.sRGBEncoding;
    }
    renderer.physicallyCorrectLights = true;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    document.getElementById('container').appendChild(renderer.domElement);
    
    // Create orbit controls (limited to avoid shake in gameplay)
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false; // disable damping to reduce oscillation
    controls.enableRotate = false; // prevent user rotation fighting follow camera
    controls.enablePan = false;
    controls.minDistance = 1;
    controls.maxDistance = 50;
    controls.target.set(0, 1, 0);
    
    // Set up lighting - physically-based, balanced for skin/cloth
    setupLighting();
    
    // Add the ground/road
    createGround();
    
    // Load the character model (idle base), then load walk animation
    loadCharacterModel();
    
    // Set up camera controls in UI
    setupCameraControls();
    
    // Set up debugging tools
    setupDebugTools();
    
    // Set up UI event listeners
    setupUIEvents();
    
    // Input handlers for WASD movement
    setupInput();

    // Pointer lock and mouse look
    setupPointerLock();
    
    // Add window resize handler
    window.addEventListener('resize', onWindowResize);
    
    // Start animation loop
    animate();
    
    // Initialize audio context on first click anywhere
    document.body.addEventListener('click', initAudioContext, { once: true });
}

// Keyboard input setup
function setupInput() {
    window.addEventListener('keydown', function(e) {
        const key = e.key.toLowerCase();
        // Ignore movement keys entirely when not in game (lobby)
        if (!isInGame && (key === 'w' || key === 'a' || key === 's' || key === 'd' || key === 'shift')) {
            e.preventDefault();
            return;
        }
        if (key === 'w' || key === 'a' || key === 's' || key === 'd' || key === 'shift') {
            keysPressed[key] = true;
            e.preventDefault();
            // Animation transitions handled in updateCharacterMovement() only
        }
    });
    
    window.addEventListener('keyup', function(e) {
        const key = e.key.toLowerCase();
        // Ignore movement keys in lobby and ensure state is not set
        if (!isInGame && (key === 'w' || key === 'a' || key === 's' || key === 'd' || key === 'shift')) {
            keysPressed[key] = false;
            e.preventDefault();
            return;
        }
        if (key === 'w' || key === 'a' || key === 's' || key === 'd' || key === 'shift') {
            keysPressed[key] = false;
            e.preventDefault();
            // Animation transitions handled in updateCharacterMovement() only
        }
    });
}

// Pointer lock and mouse-look setup
function setupPointerLock() {
    const canvas = renderer.domElement;
    const crosshair = document.getElementById('crosshair');
    const pauseMenu = document.getElementById('pause-menu');

    function onPointerLockChange() {
        isPointerLocked = document.pointerLockElement === canvas;
        if (isPointerLocked) {
            // Keep crosshair hidden per request
            crosshair.style.display = 'none';
            document.body.style.cursor = 'none';
            if (pauseMenu) pauseMenu.style.display = 'none';
            isPaused = false;
            // Ignore the first mouse delta to prevent sudden rotation spike
            skipNextMouseDelta = true;
        } else {
            crosshair.style.display = 'none';
            document.body.style.cursor = 'default';
        }
    }

    function onPointerLockError() {
        console.warn('Pointer lock error');
    }

    canvas.addEventListener('click', function() {
        // Only request lock once the city is active
        if (isInGame) {
            canvas.requestPointerLock?.();
        }
    });

    document.addEventListener('pointerlockchange', onPointerLockChange, false);
    document.addEventListener('pointerlockerror', onPointerLockError, false);

    // Mouse move to rotate camera yaw/pitch
    document.addEventListener('mousemove', function(e) {
        if (!isPointerLocked) return;
        if (skipNextMouseDelta) { skipNextMouseDelta = false; return; }

        // Clamp per-event mouse delta to prevent overshoot on spiky inputs
        const maxDelta = 30; // pixels per event cap
        const dx = Math.max(-maxDelta, Math.min(maxDelta, e.movementX || 0));
        const dy = Math.max(-maxDelta, Math.min(maxDelta, e.movementY || 0));

        cameraYaw -= dx * POINTER_SENSITIVITY; // invert to feel natural
        cameraPitch -= dy * POINTER_SENSITIVITY;
        // Clamp pitch using configured bounds (degrees -> radians)
        const minPitch = CAMERA_PITCH_RANGE_DEG.min * Math.PI / 180;
        const maxPitch = CAMERA_PITCH_RANGE_DEG.max * Math.PI / 180;
        cameraPitch = Math.max(minPitch, Math.min(maxPitch, cameraPitch));
    });

    // ESC to show pause menu
    window.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && isInGame) {
            if (document.pointerLockElement === canvas) {
                document.exitPointerLock?.();
            }
            if (pauseMenu) pauseMenu.style.display = 'flex';
            isPaused = true;
        }
    });
}

// Helper: shortest angular difference [-PI, PI]
function angleDelta(current, target) {
    let delta = target - current;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    return delta;
}

// Smoothly move an angle towards target by a fraction alpha (0..1)
function smoothAngleTowards(current, target, alpha) {
    return current + angleDelta(current, target) * Math.min(1, Math.max(0, alpha));
}

// Set up debug tools
function setupDebugTools() {
    // Debug button to show file info
    const debugBtn = document.getElementById('debug-btn');
    debugBtn.addEventListener('click', function() {
        const debugInfo = {
            'Browser': navigator.userAgent,
            'WebGL Info': getWebGLInfo(),
            'THREE.js Version': THREE.REVISION,
            'Attempted Path': MODEL_PATH,
            'Absolute URL': new URL(MODEL_PATH, window.location.href).href
        };
        
        console.table(debugInfo);
        alert('Debug info printed to console. Press F12 to view it.');
    });
    
    // Reload model button
    const reloadBtn = document.getElementById('reload-model');
    reloadBtn.addEventListener('click', function() {
        // Remove existing character if it exists
        if (character) {
            scene.remove(character);
            character = null;
        }
        
        // Update debug output
        const debugOutput = document.querySelector('.debug-output');
        debugOutput.innerHTML = `Attempting to reload model at: ${new Date().toLocaleTimeString()}<br>`;
        debugOutput.innerHTML += `Path: ${MODEL_PATH}<br>`;
        
        // Reload the model
        loadCharacterModel();
    });
}

// Get WebGL info for debugging
function getWebGLInfo() {
    const gl = renderer.getContext();
    let info = 'WebGL not available';
    
    if (gl) {
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
            info = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) + ' - ' +
                   gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
        } else {
            info = 'WebGL available but debug info not accessible';
        }
    }
    
    return info;
}

// Create lighting setup similar to the one in Blender
function setupLighting() {
    // Balanced PBR lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
    scene.add(ambientLight);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x333344, 0.6);
    hemi.position.set(0, 10, 0);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(5, 6, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0001;
    scene.add(key);

    const fill = new THREE.DirectionalLight(0xffffff, 0.8);
    fill.position.set(-6, 3, -2);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffffff, 0.8);
    rim.position.set(0, 4, -6);
    scene.add(rim);
}

// Create a ground plane to represent the road
function createGround() {
    const groundGeometry = new THREE.PlaneGeometry(10, 10);
    
    // Create shader material for asphalt with center line
    const groundMaterial = new THREE.MeshStandardMaterial({
        color: 0x222222,
        roughness: 0.8,
        metalness: 0.1,
    });
    
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2; // Rotate to be horizontal
    ground.position.y = 0;
    ground.receiveShadow = true;
    lobbyGroup.add(ground);
    
    // Create yellow center line
    const lineGeometry = new THREE.PlaneGeometry(0.1, 10);
    const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xf7d617 });
    const line = new THREE.Mesh(lineGeometry, lineMaterial);
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.005; // Slightly above the ground to avoid z-fighting
    lobbyGroup.add(line);
}

// Create a city environment
function createCity() {
    console.log('Creating city environment...');

    // Keep lobby UI hidden but keep character visible across lobby and game
    const lobbyUI = document.getElementById('game-lobby');
    if (lobbyUI) lobbyUI.style.display = 'none';
    // Do not hide lobbyGroup because character is parented there per requirement

    // Ensure city group exists
    if (!cityGroup) {
        cityGroup = new THREE.Group();
        cityGroup.name = 'cityGroup';
        scene.add(cityGroup);
    }

    // Clear previous city if any
    while (cityGroup.children.length > 0) {
        const child = cityGroup.children.pop();
        if (child) {
            // Dispose geometries/materials if present
            if (child.traverse) {
                child.traverse(function(node) {
                    if (node.geometry) node.geometry.dispose?.();
                    if (node.material) {
                        if (Array.isArray(node.material)) {
                            node.material.forEach(m => m.dispose?.());
                        } else {
                            node.material.dispose?.();
                        }
                    }
                });
            }
            cityGroup.remove(child);
        }
    }

    // Reset chunk tracking
    loadedChunks.clear();
    lastChunkX = null;
    lastChunkZ = null;

    // Load initial chunks around origin to ensure ground exists
    console.log('Loading initial city chunks around origin...');
    for (let x = -1; x <= 1; x++) {
        for (let z = -1; z <= 1; z++) {
            const chunkKey = `${x},${z}`;
            if (!loadedChunks.has(chunkKey)) {
                const chunk = buildCityChunk(x, z);
                loadedChunks.set(chunkKey, chunk);
                cityGroup.add(chunk);
                // initial chunk loaded
            }
        }
    }

    cityGroup.visible = true;
    console.log('City environment created successfully');
    isInGame = true;
}

// Return to lobby: restore UI, hide city, show lobby ground
function returnToLobby() {
    // Hide pause menu
    const pauseMenu = document.getElementById('pause-menu');
    if (pauseMenu) pauseMenu.style.display = 'none';
    isPaused = false;

    // Ensure any walk animation is stopped in the lobby
    if (walkAction && isWalkingActive) {
        walkAction.fadeOut(0.15);
        // Remove the setTimeout and immediately stop the walk animation
        walkAction.stop();
        isWalkingActive = false;
    }
    // Ensure idle is playing in lobby (visual consistency)
    if (idleAction) {
        idleAction.reset();
        idleAction.fadeIn(0.15).play();
    }

    // Clear any movement key states to prevent residual input
    keysPressed['w'] = false;
    keysPressed['a'] = false;
    keysPressed['s'] = false;
    keysPressed['d'] = false;
    keysPressed['shift'] = false;

    // Exit pointer lock
    document.exitPointerLock?.();

    // Show lobby UI and group
    const lobbyUI = document.getElementById('game-lobby');
    if (lobbyUI) lobbyUI.style.display = 'block';
    if (lobbyGroup) lobbyGroup.visible = true;

    // Hide and clear city
    if (cityGroup) {
        cityGroup.visible = false;
        while (cityGroup.children.length > 0) {
            const child = cityGroup.children.pop();
            if (!child) continue;
            child.traverse?.(function(node) {
                if (node.geometry) node.geometry.dispose?.();
                if (node.material) {
                    if (Array.isArray(node.material)) node.material.forEach(m => m.dispose?.());
                    else node.material.dispose?.();
                }
            });
        }
    }

    // Harden: ensure character is visible and correctly parented back to lobby
    if (character) {
        try {
            if (!lobbyGroup) {
                lobbyGroup = new THREE.Group();
                lobbyGroup.name = 'lobbyGroup';
                scene.add(lobbyGroup);
            }
            if (character.parent !== lobbyGroup) {
                lobbyGroup.add(character);
            }
            character.visible = true;
            // Safety: reset transform to a known good state in the lobby
            character.position.set(0, 0.1, 0);
            character.rotation.y = 0;
        } catch (e) {
            console.warn('Return-to-lobby character restore warning:', e);
        }
    }

    // Ensure animation state is idle in lobby
    try { mixer?.stopAllAction?.(); } catch (e) {}
    if (idleAction) {
        idleAction.reset();
        idleAction.fadeIn(0.15).play();
    }
    isWalkingActive = false;

    // Reset camera
    camera.position.set(DEFAULT_CAMERA_POS.x, DEFAULT_CAMERA_POS.y, DEFAULT_CAMERA_POS.z);
    controls.target.set(0, 1, 0);
    controls.update();

    isInGame = false;
}

// Create city blocks with buildings
function createCityBlocks() {
    // Deprecated in favor of chunk streaming
}

// Create individual building
function createBuilding(x, z, blockSize) {
    const buildingHeight = Math.random() * 12 + 6; // Slightly narrower range for stability
    const buildingWidth = blockSize * (0.6 + Math.random() * 0.4); // Vary width
    const buildingDepth = blockSize * (0.6 + Math.random() * 0.4); // Vary depth

    const buildingGeometry = new THREE.BoxGeometry(buildingWidth, buildingHeight, buildingDepth);

    // Random building materials
    const materials = [
        new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.8, metalness: 0.1 }), // Concrete
        new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.7, metalness: 0.0 }), // Brown brick
        new THREE.MeshStandardMaterial({ color: 0x708090, roughness: 0.6, metalness: 0.2 }), // Blue-gray
        new THREE.MeshStandardMaterial({ color: 0x2f4f4f, roughness: 0.9, metalness: 0.0 }), // Dark slate
    ];

    const buildingMaterial = materials[Math.floor(Math.random() * materials.length)];

    const building = new THREE.Mesh(buildingGeometry, buildingMaterial);
    building.position.set(x, buildingHeight / 2, z);
    building.castShadow = true;
    building.receiveShadow = true;
    cityGroup.add(building);

    // Optional: windows are performance-heavy; toggle via ENABLE_WINDOWS
    if (ENABLE_WINDOWS) {
        addBuildingWindows(building, buildingWidth, buildingHeight, buildingDepth);
    }
}

// Add windows to building
function addBuildingWindows(building, width, height, depth) {
    const windowSize = 0.8;
    const windowSpacing = 2;
    const windowsPerFloor = Math.floor(width / windowSpacing);
    const floors = Math.floor(height / windowSpacing);

    for (let floor = 1; floor < floors; floor++) {
        for (let window = 0; window < windowsPerFloor; window++) {
            // Front face windows
            if (Math.random() > 0.3) { // 70% chance of window
                const windowGeometry = new THREE.PlaneGeometry(windowSize, windowSize);
                const windowMaterial = new THREE.MeshBasicMaterial({
                    color: Math.random() > 0.5 ? 0xffff88 : 0x000000,
                    transparent: true,
                    opacity: 0.8
                });

                const window = new THREE.Mesh(windowGeometry, windowMaterial);
                window.position.set(
                    (window - windowsPerFloor/2) * windowSpacing,
                    floor * windowSpacing - height/2 + windowSpacing/2,
                    depth/2 + 0.01
                );
                building.add(window);
            }

            // Back face windows
            if (Math.random() > 0.3) {
                const backWindowGeometry = new THREE.PlaneGeometry(windowSize, windowSize);
                const backWindowMaterial = new THREE.MeshBasicMaterial({
                    color: Math.random() > 0.5 ? 0xffff88 : 0x000000,
                    transparent: true,
                    opacity: 0.8
                });

                const backWindow = new THREE.Mesh(backWindowGeometry, backWindowMaterial);
                backWindow.position.set(
                    (window - windowsPerFloor/2) * windowSpacing,
                    floor * windowSpacing - height/2 + windowSpacing/2,
                    -depth/2 - 0.01
                );
                backWindow.rotation.y = Math.PI;
                building.add(backWindow);
            }
        }
    }
}

// Create street lights
function createStreetLights() {
    const lightPositions = [
        { x: -10, z: -10 }, { x: 10, z: -10 },
        { x: -10, z: 10 }, { x: 10, z: 10 }
    ];

    lightPositions.forEach(pos => {
        // Street light pole
        const poleGeometry = new THREE.CylinderGeometry(0.1, 0.1, 6);
        const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x444444 });
        const pole = new THREE.Mesh(poleGeometry, poleMaterial);
        pole.position.set(pos.x, 3, pos.z);
        cityGroup.add(pole);

        // Street light fixture
        const fixtureGeometry = new THREE.SphereGeometry(0.3);
        const fixtureMaterial = new THREE.MeshStandardMaterial({
            color: 0x333333,
            emissive: 0x222222
        });
        const fixture = new THREE.Mesh(fixtureGeometry, fixtureMaterial);
        fixture.position.set(pos.x, 6.2, pos.z);
        cityGroup.add(fixture);

        // Add point light
        const streetLight = new THREE.PointLight(0xffaa44, 0.6, 16);
        streetLight.position.set(pos.x, 6, pos.z);
        streetLight.castShadow = false; // reduce shadow cost
        cityGroup.add(streetLight);
    });
}

// Create traffic lights
function createTrafficLights() {
    const trafficLightPositions = [
        { x: -8, z: -8 }, { x: 8, z: -8 },
        { x: -8, z: 8 }, { x: 8, z: 8 }
    ];

    trafficLightPositions.forEach(pos => {
        // Traffic light pole
        const poleGeometry = new THREE.CylinderGeometry(0.08, 0.08, 4);
        const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 });
        const pole = new THREE.Mesh(poleGeometry, poleMaterial);
        pole.position.set(pos.x, 2, pos.z);
        cityGroup.add(pole);

        // Traffic light box
        const boxGeometry = new THREE.BoxGeometry(0.6, 1.2, 0.2);
        const boxMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
        const box = new THREE.Mesh(boxGeometry, boxMaterial);
        box.position.set(pos.x, 4.5, pos.z);
        cityGroup.add(box);

        // Traffic lights (red, yellow, green)
        const lightSize = 0.15;
        const lightGeometry = new THREE.SphereGeometry(lightSize);

        const redLight = new THREE.Mesh(lightGeometry, new THREE.MeshBasicMaterial({ color: 0xff0000 }));
        redLight.position.set(pos.x - 0.15, 4.8, pos.z + 0.11);
        cityGroup.add(redLight);

        const yellowLight = new THREE.Mesh(lightGeometry, new THREE.MeshBasicMaterial({ color: 0xffff00 }));
        yellowLight.position.set(pos.x, 4.5, pos.z + 0.11);
        cityGroup.add(yellowLight);

        const greenLight = new THREE.Mesh(lightGeometry, new THREE.MeshBasicMaterial({ color: 0x00ff00 }));
        greenLight.position.set(pos.x + 0.15, 4.2, pos.z + 0.11);
        cityGroup.add(greenLight);
    });
}

// Create urban props (cars, benches, etc.)
function createUrbanProps() {
    // Reduce props density for performance
    const carPositions = [ { x: -8, z: -4 }, { x: 8, z: 6 } ];

    carPositions.forEach(pos => {
        const carGeometry = new THREE.BoxGeometry(3, 1.2, 1.2);
        const carMaterial = new THREE.MeshStandardMaterial({ color: Math.random() > 0.5 ? 0xff3333 : 0x3366ff });
        const car = new THREE.Mesh(carGeometry, carMaterial);
        car.position.set(pos.x, 0.6, pos.z);
        car.castShadow = false;
        cityGroup.add(car);
    });
    
    const benchPositions = [ { x: -6, z: -6 }, { x: 6, z: 6 } ];
    benchPositions.forEach(pos => {
        const benchGeometry = new THREE.BoxGeometry(2, 0.1, 0.8);
        const benchMaterial = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
        const bench = new THREE.Mesh(benchGeometry, benchMaterial);
        bench.position.set(pos.x, 0.4, pos.z);
        cityGroup.add(bench);
        const backrestGeometry = new THREE.BoxGeometry(2, 0.6, 0.1);
        const backrest = new THREE.Mesh(backrestGeometry, benchMaterial);
        backrest.position.set(pos.x, 0.7, pos.z - 0.35);
        cityGroup.add(backrest);
    });
}

// Create a simple test cube to verify 3D loading works
function createTestCube() {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
    const cube = new THREE.Mesh(geometry, material);
    cube.position.set(0, 0.5, 0);
    cube.castShadow = true;
    cube.receiveShadow = true;
    scene.add(cube);
    console.log('Test cube created successfully');
}

// Load walk animation only (extract animation data without model)
function loadWalkAnimationOnly() {
    console.log('🔄 Loading walk animation data ONLY from walk.glb...');
    console.log('⚠️ CRITICAL: This function will ONLY extract animations. NO models will be loaded.');

    // Create a minimal loader that focuses only on animations
    const animLoader = new THREE.GLTFLoader(loadingManager);
    const draco2 = new THREE.DRACOLoader();
    draco2.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
    animLoader.setDRACOLoader(draco2);

    // CRITICAL: Add cache-busting and allowlist enforcement
    const timestamp = new Date().getTime();
    const originalLoad = animLoader.load.bind(animLoader);
    animLoader.load = function(url, onLoad, onProgress, onError) {
        if (isForbiddenGLB(url) || !isApprovedGLB(url)) {
            console.warn('Blocked non-approved GLB load attempt');
            if (onError) onError(new Error('Non-approved GLB blocked'));
            return;
        }
        const cacheBustedUrl = url + '?cache=' + timestamp;
        return originalLoad(cacheBustedUrl, onLoad, onProgress, onError);
    };

    console.log('🎯 Starting animation-only load from:', WALK_ANIM_PATH);

    animLoader.load(
        WALK_ANIM_PATH,
        function(animGltf) {
            console.log('📦 Animation GLB loaded - IMMEDIATELY checking for scene data to destroy...');

            // IMMEDIATE: Check if there's any scene data and destroy it BEFORE processing animations
            if (animGltf.scene) {
                console.log('🚨 DANGER: Found scene data in walk.glb - DESTROYING IMMEDIATELY to ensure animations-only load');
                animGltf.scene.traverse(function(node) {
                    if (node.geometry) {
                        node.geometry.dispose();
                        console.log('💀 Destroyed geometry:', node.name || 'unnamed');
                    }
                    if (node.material) {
                        if (Array.isArray(node.material)) {
                            node.material.forEach(m => m.dispose());
                        } else {
                            node.material.dispose();
                        }
                        console.log('💀 Destroyed material:', node.name || 'unnamed');
                    }
                });
                // Extra safety: purge by name patterns
                purgeForbiddenNodes(animGltf.scene);
                console.log('✅ SUCCESS: All scene data from walk.glb DESTROYED - no models loaded!');
            } else {
                console.log('✅ No scene data found in walk.glb - safe to proceed');
            }

            // NOW process animations after ensuring no model data exists
            if (!mixer) mixer = new THREE.AnimationMixer(character);

            if (animGltf.animations && animGltf.animations.length > 0) {
                try {
                    const walkClip = animGltf.animations.find(c => /walk|walking/i.test(c.name)) || animGltf.animations[0];
                    walkAction = mixer.clipAction(walkClip);
                    walkAction.loop = THREE.LoopRepeat;
                    walkAction.enabled = true;
                    walkAction.stop();
                    console.log('🎬 SUCCESS: Walk animation extracted and ready (no models loaded)');
                } catch (e) {
                    console.warn('❌ Failed to setup walk animation:', e);
                }
            } else {
                console.warn('❌ No animations found in walk.glb');
            }

            // Final cleanup - ensure no references remain
            if (animGltf.scene) {
                animGltf.scene = null;
            }
            console.log('🛡️ PROTECTION: All walk.glb model data eliminated - only animations remain');
        },
        undefined,
        function(err) {
            console.error('❌ CRITICAL: Failed to load walk animation GLB:', err);
        }
    );
}

// Load character model
function loadCharacterModel() {
    console.log('Loading standing_idle.glb model...');
    document.querySelector('.loading-text').textContent = 'Loading standing_idle.glb...';
    
    // Show loading screen if hidden
    loadingScreen.style.display = 'flex';
    
    // Create GLTF loader with strict controls
    const loader = new THREE.GLTFLoader(loadingManager);
    // Also harden FileLoader to block at a lower level in three.js
    if (THREE && THREE.FileLoader && !THREE.FileLoader.prototype.__covHardened) {
        const originalFileLoaderLoad = THREE.FileLoader.prototype.load;
        THREE.FileLoader.prototype.load = function(url, onLoad, onProgress, onError) {
            try {
                const s = typeof url === 'string' ? url : String(url);
                if (s.toLowerCase().includes('.glb')) {
                    if (isForbiddenGLB(s) || !isApprovedGLB(s)) {
                        if (onError) onError(new Error('Non-approved GLB blocked'));
                        return;
                    }
                }
            } catch (e) {
                // fallthrough
            }
            return originalFileLoaderLoad.call(this, url, onLoad, onProgress, onError);
        };
        THREE.FileLoader.prototype.__covHardened = true;
    }

    // CRITICAL: Ensure we only load standing_idle.glb, nothing else
    const originalLoaderLoad = loader.load.bind(loader);
    loader.load = function(url, onLoad, onProgress, onError) {
        if (isForbiddenGLB(url) || !isApprovedGLB(url)) {
            if (onError) onError(new Error('Non-approved GLB blocked'));
            return;
        }
        return originalLoaderLoad(url, onLoad, onProgress, onError);
    };
    // Ensure high-quality texture sampling
    loader.manager.onLoad = function() {
        scene.traverse(function(node) {
            if (node.isMesh) {
                const mats = Array.isArray(node.material) ? node.material : [node.material];
                mats.forEach(function(mat) {
                    if (!mat) return;
                    ['map','normalMap','metalnessMap','roughnessMap','emissiveMap','aoMap'].forEach(function(key) {
                        const tex = mat[key];
                        if (tex) {
                            tex.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy?.() || 8);
                            tex.minFilter = THREE.LinearMipmapLinearFilter;
                            tex.magFilter = THREE.LinearFilter;
                            tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
                            if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
                            else tex.encoding = THREE.sRGBEncoding;
                            tex.needsUpdate = true;
                        }
                    });
                });
            }
        });
    };
    
    // Optional: Set up Draco decoder for compressed models
    const dracoLoader = new THREE.DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
    loader.setDRACOLoader(dracoLoader);
    
    // Update debug output
    const debugOutput = document.querySelector('.debug-output');
    if (debugOutput) {
        debugOutput.innerHTML += 'Starting load...<br>';
    }

    // Note: Test cube removed - character should spawn in city center
    
    // Simplified loading - only load the specified model file
    // Removed alternative loading logic to prevent loading wrong models
    
    // Function to handle loaded model with given scale
    const handleLoadedModel = function(gltf, scale) {
        console.log('Model loaded successfully!', gltf);
        character = gltf.scene;
        // Ensure no forbidden remnants exist in the loaded model
        purgeForbiddenNodes(character);

        // Log model details and ensure we're using the correct model
        console.log('Model structure:', gltf);
        console.log('CONFIRMED: Using standing_idle.glb as the only character model');
        
        // Ensure model is properly scaled and positioned - much larger scale
        character.scale.set(scale * 100, scale * 100, scale * 100);

        // Log the model name to verify which model is actually loading
        console.log('Loaded model file:', MODEL_PATH);
        
        // Position the model properly on the ground and center it
        character.position.set(0, 0.1, 0); // Slight lift to avoid z-fighting with ground
        character.rotation.y = 0; // Face forward initially
        console.log('Character positioned at center:', character.position);
        console.log('Character scale:', character.scale);
        
    // Ensure model receives and casts shadows, and texture quality is high
        character.traverse(function(node) {
            if (node.isMesh) {
                console.log('Found mesh:', node.name, 'Material color:', node.material?.color);

                // Hide any green cube/box that might be part of the model
                if (node.material && node.material.color &&
                    node.material.color.r > 0.8 && node.material.color.g > 0.8 && node.material.color.b < 0.1) {
                    console.log('Hiding green cube mesh:', node.name);
                    node.visible = false;
                    return; // Skip shadow settings for hidden meshes
                }

                node.castShadow = true;
                node.receiveShadow = true;
                
                // Log material details
                if (node.material) {
                    console.log('Material:', node.material);
                    // Make materials more visible
                    node.material.metalness = 0.3;
                    node.material.roughness = 0.7;
                    
                    // Ensure textures are properly set
                    if (node.material.map) {
                    if ('colorSpace' in node.material.map) node.material.map.colorSpace = THREE.SRGBColorSpace;
                    else node.material.map.encoding = THREE.sRGBEncoding;
                    node.material.map.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy?.() || 8);
                    node.material.map.minFilter = THREE.LinearMipmapLinearFilter;
                    node.material.map.magFilter = THREE.LinearFilter;
                    }
                }
            }
        });
        
        scene.add(character);
        lobbyGroup.add(character); // keep character visible in lobby

        // Prepare animation: only play when moving (W/A/S/D)
        if (gltf.animations && gltf.animations.length > 0) {
            try {
                if (!mixer) mixer = new THREE.AnimationMixer(character);
                // Set up idle animation from standing_idle.glb only
                const idleClip = gltf.animations.find(c => /idle|stand/i.test(c.name)) || gltf.animations[0];
                idleAction = mixer.clipAction(idleClip);
                idleAction.clampWhenFinished = false;
                idleAction.loop = THREE.LoopRepeat;
                idleAction.enabled = true;
                idleAction.play();
                console.log('Prepared idle clip from standing_idle.glb:', idleClip.name);
            } catch (e) {
                console.warn('Failed to setup idle animation from standing_idle.glb:', e);
            }
        } else {
            console.log('No animations found in standing_idle.glb - this is expected if using external animations.');
        }

        // Ensure character has a referenceable position object
        if (!character.position) {
            character.position = new THREE.Vector3(0, 0.1, 0);
        }
        
        // Center camera on character with better framing
        camera.position.set(
            DEFAULT_CAMERA_POS.x,
            DEFAULT_CAMERA_POS.y,
            DEFAULT_CAMERA_POS.z
        );
        controls.target.set(0, 1, 0); // Look at character's center
        controls.update();
        
        document.querySelector('.loading-text').textContent = 'Character loaded successfully!';
        setTimeout(() => {
            loadingScreen.style.display = 'none';
        }, 1000);
        
        if (debugOutput) {
            debugOutput.innerHTML += 'Model loaded successfully!<br>';
        }
    };
    
    // Load model with first attempt
    loader.load(
        MODEL_PATH,
        function(gltf) {
            handleLoadedModel(gltf, 0.02); // Increased initial scale

            // Load walk animation only for animation data, not additional models
            loadWalkAnimationOnly();
        },
        function(xhr) {
            // Loading progress
            const percent = (xhr.loaded / xhr.total) * 100;
            console.log('Loading progress:', Math.round(percent) + '%');
            document.querySelector('.loading-text').textContent = 
                `Loading Character: ${Math.round(percent)}%`;
        },
        function(error) {
            console.error('Error loading model:', error);
            console.error('Error details:', error);
            document.querySelector('.loading-text').textContent =
                'Failed to load standing_idle.glb. Check console for details.';

            if (debugOutput) {
                debugOutput.innerHTML += `Failed to load model: ${error.message}<br>`;
            }
        }
    );
}

// UI controls for camera position
function setupCameraControls() {
    // Camera position sliders
    const cameraX = document.getElementById('camera-x');
    const cameraY = document.getElementById('camera-y');
    const cameraZ = document.getElementById('camera-z');
    
    const cameraXValue = document.getElementById('camera-x-value');
    const cameraYValue = document.getElementById('camera-y-value');
    const cameraZValue = document.getElementById('camera-z-value');
    
    // Initialize values
    cameraXValue.textContent = cameraX.value;
    cameraYValue.textContent = cameraY.value;
    cameraZValue.textContent = cameraZ.value;
    
    // X position
    cameraX.addEventListener('input', function() {
        camera.position.x = parseFloat(this.value);
        cameraXValue.textContent = this.value;
        controls.update();
    });
    
    // Y position
    cameraY.addEventListener('input', function() {
        camera.position.y = parseFloat(this.value);
        cameraYValue.textContent = this.value;
        controls.update();
    });
    
    // Z position
    cameraZ.addEventListener('input', function() {
        camera.position.z = parseFloat(this.value);
        cameraZValue.textContent = this.value;
        controls.update();
    });
    
    // Reset camera
    document.getElementById('reset-camera').addEventListener('click', function() {
        // Reset camera position
        camera.position.set(
            DEFAULT_CAMERA_POS.x,
            DEFAULT_CAMERA_POS.y,
            DEFAULT_CAMERA_POS.z
        );
        
        // Reset controls target
        controls.target.set(0, 0.8, 0);
        controls.update();
        
        // Reset sliders
        cameraX.value = DEFAULT_CAMERA_POS.x;
        cameraY.value = DEFAULT_CAMERA_POS.y;
        cameraZ.value = DEFAULT_CAMERA_POS.z;
        
        cameraXValue.textContent = DEFAULT_CAMERA_POS.x;
        cameraYValue.textContent = DEFAULT_CAMERA_POS.y;
        cameraZValue.textContent = DEFAULT_CAMERA_POS.z;
    });
}

// Create dynamic in-game camera tuning UI
function createCameraTuningUI() {
    if (document.getElementById('camera-tuning-modal')) return; // already exists

    const modal = document.createElement('div');
    modal.id = 'camera-tuning-modal';
    modal.style.position = 'absolute';
    modal.style.top = '50%';
    modal.style.left = '50%';
    modal.style.transform = 'translate(-50%, -50%)';
    modal.style.background = 'rgba(0,0,0,0.85)';
    modal.style.color = '#fff';
    modal.style.padding = '24px 28px';
    modal.style.border = '1px solid #444';
    modal.style.borderRadius = '8px';
    modal.style.zIndex = '9999';
    modal.style.width = '320px';
    modal.style.boxShadow = '0 12px 32px rgba(0,0,0,0.45)';

    modal.innerHTML = `
        <h3 style="margin-top:0;margin-bottom:12px;font-weight:600;font-size:18px;">Camera Follow Calibration</h3>
        <p style="margin-bottom:18px;font-size:14px;line-height:1.5;color:#bbb;">
            Adjust the follow height, distance, and eye pitch (look up/down).<br>
            <strong style="color:#0f9;">Default: Height 4.25 | Distance 8.14 | Pitch 23°</strong>
        </p>
        <label style="display:block;margin-bottom:6px;font-size:13px;">Follow Height</label>
        <input id="camera-height-slider" type="range" min="${CAMERA_HEIGHT_RANGE.min}" max="${CAMERA_HEIGHT_RANGE.max}" step="0.05" value="${cameraFollowHeight}" style="width:100%;">
        <div style="margin-bottom:16px;font-size:13px;color:#aaa;">
            Current Height: <span id="camera-height-value">${cameraFollowHeight.toFixed(2)}</span>
        </div>
        <label style="display:block;margin-bottom:6px;font-size:13px;">Follow Distance</label>
        <input id="camera-distance-slider" type="range" min="${CAMERA_DISTANCE_RANGE.min}" max="${CAMERA_DISTANCE_RANGE.max}" step="0.1" value="${cameraFollowDistance}" style="width:100%;">
        <div style="margin-bottom:20px;font-size:13px;color:#aaa;">
            Current Distance: <span id="camera-distance-value">${cameraFollowDistance.toFixed(1)}</span>
        </div>
        <label style="display:block;margin-bottom:6px;font-size:13px;">Eye Pitch (deg)</label>
        <input id="camera-pitch-slider" type="range" min="${CAMERA_PITCH_RANGE_DEG.min}" max="${CAMERA_PITCH_RANGE_DEG.max}" step="1" value="${DEFAULT_CAMERA_PITCH_DEG}" style="width:100%;">
        <div style="margin-bottom:20px;font-size:13px;color:#aaa;">
            Current Pitch: <span id="camera-pitch-value">${DEFAULT_CAMERA_PITCH_DEG.toFixed(0)}</span>°
        </div>
        <div style="display:flex;justify-content:space-between;gap:12px;">
            <button id="camera-cancel-btn" style="flex:1;background:#333;border:1px solid #555;color:#eee;padding:8px 0;border-radius:4px;cursor:pointer;">Cancel</button>
            <button id="camera-apply-btn" style="flex:1;background:#1e8755;border:1px solid #2aa168;color:#fff;padding:8px 0;border-radius:4px;cursor:pointer;font-weight:600;">Apply & Make Default</button>
        </div>
    `;

    document.body.appendChild(modal);

    const heightSlider = modal.querySelector('#camera-height-slider');
    const heightValueLabel = modal.querySelector('#camera-height-value');
    const distanceSlider = modal.querySelector('#camera-distance-slider');
    const distanceValueLabel = modal.querySelector('#camera-distance-value');
    const pitchSlider = modal.querySelector('#camera-pitch-slider');
    const pitchValueLabel = modal.querySelector('#camera-pitch-value');

    heightSlider.addEventListener('input', () => {
        cameraFollowHeight = clampNumber(parseFloat(heightSlider.value), CAMERA_HEIGHT_RANGE.min, CAMERA_HEIGHT_RANGE.max);
        heightValueLabel.textContent = cameraFollowHeight.toFixed(2);
    });

    distanceSlider.addEventListener('input', () => {
        cameraFollowDistance = clampNumber(parseFloat(distanceSlider.value), CAMERA_DISTANCE_RANGE.min, CAMERA_DISTANCE_RANGE.max);
        distanceValueLabel.textContent = cameraFollowDistance.toFixed(1);
    });

    pitchSlider.addEventListener('input', () => {
        const deg = clampNumber(parseFloat(pitchSlider.value), CAMERA_PITCH_RANGE_DEG.min, CAMERA_PITCH_RANGE_DEG.max);
        pitchValueLabel.textContent = deg.toFixed(0);
        cameraPitch = deg * Math.PI / 180;
    });

    modal.querySelector('#camera-cancel-btn').addEventListener('click', () => {
        // Reset to defaults instead of saved values
        cameraFollowHeight = DEFAULT_CAMERA_FOLLOW_HEIGHT;
        cameraFollowDistance = DEFAULT_CAMERA_FOLLOW_DISTANCE;
        heightSlider.value = cameraFollowHeight;
        heightValueLabel.textContent = cameraFollowHeight.toFixed(2);
        distanceSlider.value = cameraFollowDistance;
        distanceValueLabel.textContent = cameraFollowDistance.toFixed(1);
        const defPitchDeg = 23;
        pitchSlider.value = defPitchDeg;
        pitchValueLabel.textContent = defPitchDeg.toFixed(0);
        cameraPitch = defPitchDeg * Math.PI / 180;
        closeCameraTuningModal();
    });

    modal.querySelector('#camera-apply-btn').addEventListener('click', () => {
        localStorage?.setItem('cov_camera_follow_height', String(cameraFollowHeight));
        localStorage?.setItem('cov_camera_follow_distance', String(cameraFollowDistance));
        const currentPitchDeg = clampNumber(parseFloat(pitchSlider.value), CAMERA_PITCH_RANGE_DEG.min, CAMERA_PITCH_RANGE_DEG.max);
        localStorage?.setItem('cov_camera_pitch_deg', String(currentPitchDeg));
        closeCameraTuningModal();
        alert(`Camera updated. Height: ${cameraFollowHeight.toFixed(2)}, Distance: ${cameraFollowDistance.toFixed(1)}, Pitch: ${currentPitchDeg.toFixed(0)}°.`);
    });
}

function closeCameraTuningModal() {
    const modal = document.getElementById('camera-tuning-modal');
    if (modal) modal.remove();
}

function readStoredNumber(key, fallback) {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

// Handle window resize
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Setup UI event listeners for the lobby interface
function setupUIEvents() {
    // Play button - load city environment
    const playBtn = document.getElementById('play-btn');
    const clickReadyPopup = document.getElementById('click-ready-popup');
    let popupTimeout = null; // Variable to store timeout ID
    
    if (playBtn) {
        playBtn.addEventListener('click', function() {
            console.log('Play button clicked, player ready state:', playerReady);
            
            // Check if player is ready before proceeding
            if (!playerReady) {
                console.log('Player not ready, showing click-ready popup');
                
                // Play error sound
                playErrorSound();
                
                // Remove any existing classes 
                clickReadyPopup.classList.remove('fade-out');
                
                // Show the temporary "click ready" message with animation
                clickReadyPopup.classList.add('show');
                
                // Clear any existing timeout
                if (popupTimeout) {
                    clearTimeout(popupTimeout);
                }
                
                // Start fade-out animation after 1.5 seconds (total visible time will be 2 seconds)
                popupTimeout = setTimeout(function() {
                    // Add fade-out class
                    clickReadyPopup.classList.add('fade-out');
                    
                    // Remove show class after fade-out animation completes
                    setTimeout(function() {
                        clickReadyPopup.classList.remove('show');
                        popupTimeout = null; // Clear timeout ID after execution
                    }, 500); // 0.5 seconds for fade-out
                }, 1500); // 1.5 seconds before starting fade-out
                
                return; // Don't proceed with game loading
            }
            
            console.log('Player ready, loading city environment');
            
            // Show loading screen
            loadingScreen.style.display = 'flex';
            document.querySelector('.loading-text').textContent = 'Loading City Environment...';
            
            // Simulate loading time
            setTimeout(function() {
                // Create the city environment (chunked)
                createCity();

    // Position character at city center (keep visible)
    if (character) {
        character.position.set(0, 0.1, 0);
        character.rotation.y = 0;
        console.log('Character positioned at city center:', character.position);
    }

                // Set up third-person camera view (behind character, looking at world)
                const thirdPersonDistance = cameraFollowDistance;
                const thirdPersonHeight = cameraFollowHeight;
                camera.position.set(
                    character.position.x,
                    character.position.y + thirdPersonHeight,
                    character.position.z + thirdPersonDistance
                );
                controls.target.set(
                    character.position.x,
                    character.position.y + Math.max(1.0, cameraFollowHeight * 0.4),
                    character.position.z
                );
                controls.update();

                loadingScreen.style.display = 'none';
                console.log('City environment loaded with character at center!');

                const debugOutput = document.querySelector('.debug-output');
                if (debugOutput) {
                    debugOutput.innerHTML += 'City environment loaded with character at center!<br>';
                }
            }, 1200);
        });
    }
    
    // Ready button - toggle ready state
    const readyBtn = document.getElementById('ready-btn');
    if (readyBtn) {
        readyBtn.addEventListener('click', function() {
            // Ensure audio context is initialized (in case this is the first interaction)
            initAudioContext();
            
            if (this.textContent === 'READY') {
                this.textContent = 'NOT READY';
                this.style.backgroundColor = 'rgba(60, 30, 30, 0.7)';
                this.style.borderColor = '#822d2d';
                this.style.color = '#822d2d';
                playerReady = false; // Player is not ready
                console.log('Player set to NOT READY');
            } else {
                this.textContent = 'READY';
                this.style.backgroundColor = 'rgba(30, 60, 40, 0.7)';
                this.style.borderColor = '#2d8259';
                this.style.color = '#2d8259';
                playerReady = true; // Player is ready
                console.log('Player set to READY');
                
                // Hide the popup immediately if the user becomes ready
                const clickReadyPopup = document.getElementById('click-ready-popup');
                if (clickReadyPopup.classList.contains('show')) {
                    clickReadyPopup.classList.add('fade-out');
                    setTimeout(function() {
                        clickReadyPopup.classList.remove('show');
                    }, 500); // 0.5 seconds for fade-out
                    
                    if (popupTimeout) {
                        clearTimeout(popupTimeout);
                        popupTimeout = null;
                    }
                }
            }
        });
    }
    
    // Toggle controls panel visibility with ~ key
    window.addEventListener('keydown', function(e) {
        if (e.key === '`' || e.key === '~') {
            const controlsPanel = document.getElementById('controls-panel');
            controlsPanel.style.display = controlsPanel.style.display === 'none' ? 'block' : 'none';
        }
    });

    // Pause menu buttons
    const resumeBtn = document.getElementById('resume-btn');
    const backBtn = document.getElementById('back-to-lobby-btn');
    const pauseMenu = document.getElementById('pause-menu');
    const canvas = renderer ? renderer.domElement : null;
    const storeBtn = document.getElementById('store-btn');
    const storeModal = document.getElementById('store-modal');
    const closeStoreBtn = document.getElementById('close-store-btn');

    if (resumeBtn) {
        resumeBtn.addEventListener('click', function() {
            if (pauseMenu) pauseMenu.style.display = 'none';
            isPaused = false;
            canvas?.requestPointerLock?.();
        });
    }

    if (backBtn) {
        backBtn.addEventListener('click', function() {
            returnToLobby();
        });
    }

    // Lobby STORE button opens gun showcase
    if (storeBtn) {
        storeBtn.addEventListener('click', function() {
            if (storeModal) storeModal.style.display = 'flex';
        });
    }
    if (closeStoreBtn) {
        closeStoreBtn.addEventListener('click', function() {
            if (storeModal) storeModal.style.display = 'none';
        });
    }

    // Expose camera calibration via keyboard shortcut (Ctrl+Shift+C)
    window.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
            e.preventDefault();
            createCameraTuningUI();
        }
    });

    // Hide crosshair permanently (user request)
    const crosshair = document.getElementById('crosshair');
    if (crosshair) crosshair.style.display = 'none';
}

// Runtime protection against non-approved GLB loading
function runtimeGLBProtection() {
    // Monitor for any unauthorized GLB loading attempts
    const originalFetch = window.fetch;
    window.fetch = function(...args) {
        const url = args[0];
        const s = typeof url === 'string' ? url : String(url);
        if (s.toLowerCase().includes('.glb')) {
            if (isForbiddenGLB(s) || !isApprovedGLB(s)) {
                console.error('🚨 RUNTIME BLOCK: Non-approved GLB load attempt blocked');
                return Promise.reject(new Error('Non-approved GLB blocked'));
            }
        }
        return originalFetch.apply(this, args);
    };

    // Also monitor XMLHttpRequest
    const originalXMLHttpRequest = window.XMLHttpRequest;
    window.XMLHttpRequest = function() {
        const xhr = new originalXMLHttpRequest();
        const originalOpen = xhr.open;
        xhr.open = function(method, url) {
            const s = typeof url === 'string' ? url : String(url);
            if (s && s.toLowerCase().includes('.glb')) {
                if (isForbiddenGLB(s) || !isApprovedGLB(s)) {
                    console.error('🚨 RUNTIME BLOCK: Non-approved GLB XHR blocked');
                    throw new Error('Non-approved GLB blocked');
                }
            }
            return originalOpen.apply(this, arguments);
        };
        return xhr;
    };

    console.log('🛡️ Runtime protection active - only approved GLB files can be loaded');
}

// Update dev stats overlay in real-time
function updateDevStats() {
    // Overlay removed; keep function as no-op to avoid call site changes.
}

// Animation loop
function animate() {
    requestAnimationFrame(animate);

    const delta = clock ? clock.getDelta() : 0.016;

    // Advance any playing GLTF/FBX animations
    if (mixer) {
        try {
            mixer.update(delta);
        } catch (e) {
            console.warn('Animation mixer update error:', e);
        }
    }

    if (isPaused) {
        // Still render the current frame so the pause menu overlays correctly
        renderer.render(scene, camera);
        return;
    }

    // Update movement only during gameplay
    if (character && isInGame && !isPaused) {
        updateCharacterMovement(delta);
    }
    
    // Update controls
    controls.update();
    
    // Dev stats removed
    // updateDevStats();
    
    // Render scene
    renderer.render(scene, camera);
}

// Update character movement using camera-relative WASD
function updateCharacterMovement(delta) {
    if (!character) return;

    // Use a filtered yaw for movement to avoid micro jitter from tiny camera yaw changes
    if (!Number.isFinite(movementYaw)) movementYaw = cameraYaw;
    movementYaw = smoothAngleTowards(movementYaw, cameraYaw, 0.18);
    const yaw = movementYaw;
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    // Compute right: for yaw=0, forward=(0,0,1), right should be (1,0,0)
    // cross(up, forward) = cross((0,1,0), (0,0,1)) = (1*1 - 0*0, 0*0 - 0*1, 0*0 - 0*1) = (1, 0, 0)
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), forward).normalize();

    let move = new THREE.Vector3(0, 0, 0);
    if (keysPressed['w']) {
        move.add(forward); // Forward
    }
    if (keysPressed['s']) {
        move.sub(forward); // Backward
    }
    // Strafe (flip A/D to match expected screen-relative feel)
    if (keysPressed['a']) {
        move.add(right);
    }
    if (keysPressed['d']) {
        move.sub(right);
    }

    const isMoving = move.lengthSq() > 1e-6;
    if (isMoving) {
        const speed = MOVE_SPEED * (keysPressed['shift'] && keysPressed['w'] ? SPRINT_MULTIPLIER : 1);
        move.normalize().multiplyScalar(speed * delta);
        character.position.add(move);

        // Ensure walk animation is playing when moving
        if (walkAction && !isWalkingActive) {
            if (idleAction && idleAction.isRunning()) {
                idleAction.crossFadeTo(walkAction, 0.06, false);
                walkAction.reset().play();
            } else if (idleAction) {
                idleAction.fadeOut(0.05);
                walkAction.reset().fadeIn(0.05).play();
            } else {
                walkAction.reset().fadeIn(0.05).play();
            }
            isWalkingActive = true;
            console.log('Animation transition: idle -> walk (movement, using standing_idle.glb model)');
        }
    } else if (isWalkingActive) {
        // When not moving, transition back to idle immediately without delay
        if (walkAction) {
            if (idleAction && walkAction.isRunning()) {
                walkAction.crossFadeTo(idleAction, 0.06, false);
                idleAction.reset().play();
            } else {
                walkAction.fadeOut(0.05);
                walkAction.stop();
                if (idleAction) idleAction.reset().fadeIn(0.05).play();
            }
            isWalkingActive = false;
            console.log('Animation transition: walk -> idle (no movement, using standing_idle.glb model)');
        }
    }

    // Handle rotation based on movement direction - only rotate when actively moving
    if (isMoving) {
        const moveDir = move.clone().normalize();
        const desiredYaw = Math.atan2(moveDir.x, moveDir.z);
        character.rotation.y += angleDelta(character.rotation.y, desiredYaw) * Math.min(1, 12 * delta);
    }
    // When not moving, maintain current rotation (don't auto-rotate to forward)

    // Apply mouse-look yaw/pitch to define camera orbit behind the character
    const thirdPersonDistance = cameraFollowDistance;
    const thirdPersonHeight = cameraFollowHeight;
    const baseYaw = cameraYaw;
    const basePitch = cameraPitch; // apply pitch to orbit to look up/down
    // Compute spherical offsets using yaw (around Y) and pitch (up/down)
    const cosPitch = Math.cos(basePitch);
    const sinPitch = Math.sin(basePitch);
    const offsetX = Math.sin(baseYaw) * -thirdPersonDistance * cosPitch;
    const offsetZ = Math.cos(baseYaw) * -thirdPersonDistance * cosPitch;
    let offsetY = thirdPersonHeight + (thirdPersonDistance * sinPitch);
    // Safety: never let the camera dip too low relative to character
    const minY = MIN_CAMERA_ABOVE_CHARACTER;
    if (offsetY < minY) offsetY = minY;
    const desiredCameraPos = new THREE.Vector3(
        character.position.x + offsetX,
        character.position.y + offsetY,
        character.position.z + offsetZ
    );
    // Framerate-independent unified smoothing for camera and target
    const baseAlpha = isPointerLocked ? 0.22 : 0.16;
    const alpha = 1 - Math.pow(1 - baseAlpha, Math.max(0.0001, delta) * 60);
    camera.position.lerp(desiredCameraPos, alpha);
    controls.target.lerp(
        character.position.clone().add(new THREE.Vector3(0, Math.max(1.0, cameraFollowHeight * 0.4), 0)),
        alpha
    );

    // Stream city chunks as the character moves (always keep character at center of chunks)
    updateCityStreaming();
}

// Convert world position to chunk indices
function worldToChunk(x, z) {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    return { cx, cz };
}

// Load/unload chunks around character
function updateCityStreaming() {
    const pos = character ? character.position : new THREE.Vector3(0, 0, 0);
    const { cx, cz } = worldToChunk(pos.x, pos.z);

    // Reduce logging to avoid frame hitches
    // console.log(`Character at (${pos.x.toFixed(1)}, ${pos.z.toFixed(1)}), chunk (${cx}, ${cz})`);

    if (cx === lastChunkX && cz === lastChunkZ && loadedChunks.size > 0) return;
    lastChunkX = cx; lastChunkZ = cz;

    const needed = new Set();
    for (let x = cx - CHUNK_RADIUS; x <= cx + CHUNK_RADIUS; x++) {
        for (let z = cz - CHUNK_RADIUS; z <= cz + CHUNK_RADIUS; z++) {
            needed.add(`${x},${z}`);
            if (!loadedChunks.has(`${x},${z}`)) {
                const chunk = buildCityChunk(x, z);
                loadedChunks.set(`${x},${z}`, chunk);
                cityGroup.add(chunk);
            }
        }
    }

    // Unload chunks that are no longer needed
    for (const key of Array.from(loadedChunks.keys())) {
        if (!needed.has(key)) {
            const grp = loadedChunks.get(key);
            if (grp) {
                grp.traverse(function(node) {
                    if (node.geometry) node.geometry.dispose?.();
                    if (node.material) {
                        if (Array.isArray(node.material)) node.material.forEach(m => m.dispose?.());
                        else node.material.dispose?.();
                    }
                });
                cityGroup.remove(grp);
            }
            loadedChunks.delete(key);
        }
    }
}

// Build a single chunk with local roads and buildings
function buildCityChunk(cx, cz) {
    const group = new THREE.Group();
    const originX = cx * CHUNK_SIZE;
    const originZ = cz * CHUNK_SIZE;

    // console.log(`Building chunk at (${cx}, ${cz}) with origin (${originX.toFixed(1)}, ${originZ.toFixed(1)})`);

    // Ground for chunk - make sure it's positioned correctly
    const groundGeometry = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE);
    const groundMaterial = new THREE.MeshStandardMaterial({
        color: Math.random() > 0.5 ? 0x2c2c2c : 0x323232, // Slightly different colors for debugging
        roughness: 0.95,
        metalness: 0.05
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(originX + CHUNK_SIZE / 2, 0, originZ + CHUNK_SIZE / 2);
    ground.receiveShadow = true;
    group.add(ground);

    // Add chunk boundary markers for debugging
    const markerGeometry = new THREE.BoxGeometry(0.5, 0.1, 0.5);
    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    marker.position.set(originX + CHUNK_SIZE / 2, 0.05, originZ + CHUNK_SIZE / 2);
    group.add(marker);

    // Simple cross roads within chunk
    const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 });
    const hRoad = new THREE.Mesh(new THREE.PlaneGeometry(CHUNK_SIZE, 4), roadMaterial);
    hRoad.rotation.x = -Math.PI / 2;
    hRoad.position.set(originX + CHUNK_SIZE / 2, 0.01, originZ + CHUNK_SIZE / 2);
    group.add(hRoad);
    const vRoad = new THREE.Mesh(new THREE.PlaneGeometry(4, CHUNK_SIZE), roadMaterial);
    vRoad.rotation.x = -Math.PI / 2;
    vRoad.position.set(originX + CHUNK_SIZE / 2, 0.01, originZ + CHUNK_SIZE / 2);
    group.add(vRoad);

    // Buildings: place 4 around the cross
    const blockSize = 10; // larger buildings but spaced further from roads
    const placements = [
        { x: originX + 8, z: originZ + 8 },
        { x: originX + CHUNK_SIZE - 8, z: originZ + 8 },
        { x: originX + 8, z: originZ + CHUNK_SIZE - 8 },
        { x: originX + CHUNK_SIZE - 8, z: originZ + CHUNK_SIZE - 8 },
    ];
    placements.forEach(p => group.add(createBuildingMesh(p.x, p.z, blockSize)));

    return group;
}

// Helper to create building mesh directly (to attach to chunk group)
function createBuildingMesh(x, z, blockSize) {
    const buildingHeight = Math.random() * 12 + 6;
    const buildingWidth = blockSize * (0.6 + Math.random() * 0.4);
    const buildingDepth = blockSize * (0.6 + Math.random() * 0.4);

    const buildingGeometry = new THREE.BoxGeometry(buildingWidth, buildingHeight, buildingDepth);
    const materials = [
        new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.8, metalness: 0.1 }),
        new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.7, metalness: 0.0 }),
        new THREE.MeshStandardMaterial({ color: 0x708090, roughness: 0.6, metalness: 0.2 }),
        new THREE.MeshStandardMaterial({ color: 0x2f4f4f, roughness: 0.9, metalness: 0.0 }),
    ];
    const buildingMaterial = materials[Math.floor(Math.random() * materials.length)];
    const building = new THREE.Mesh(buildingGeometry, buildingMaterial);
    building.position.set(x, buildingHeight / 2, z);
    building.castShadow = false;
    building.receiveShadow = true;
    return building;
}

// Initialize everything when page loads
window.addEventListener('DOMContentLoaded', init); 