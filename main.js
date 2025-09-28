// Variables for scene, camera, renderer, controls, and model
let scene, camera, renderer, controls, character, lobbyGroup, cityGroup, clock;
let loadingManager, loadingScreen;
let playerReady = true; // Track if player is ready (default to ready)

// Model path - update this with where you'll host the model
const MODEL_PATH = 'character_high_quality.glb';

// Default camera values
const DEFAULT_CAMERA_POS = {
    x: 0,
    y: 4.5,
    z: 7.4
};

// Performance and streaming configuration
const ENABLE_WINDOWS = false; // Disable heavy window meshes for performance
const CHUNK_SIZE = 20; // World units per chunk (smaller for better precision)
const CHUNK_RADIUS = 2; // Number of chunks to load around player (2 => 5x5 for better coverage)
let loadedChunks = new Map(); // key => THREE.Group
let lastChunkX = null, lastChunkZ = null;

// Movement and camera follow settings
const MOVE_SPEED = 5; // units per second
const SPRINT_MULTIPLIER = 2; // Shift+W sprint speed multiplier
const CAMERA_FOLLOW_HEIGHT = 6; // camera height above character
const CAMERA_FOLLOW_DISTANCE = 10; // camera distance behind character
const keysPressed = {};

// Pointer-lock mouselook state
const POINTER_SENSITIVITY = 0.0045;
let isPointerLocked = false;
let cameraYaw = 0;   // radians, around Y
let cameraPitch = 0; // radians, up/down (clamped)
let isPaused = false;
let isInGame = false; // true only after city is created

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

// Initialize the scene
function init() {
    loadingScreen = document.getElementById('loading-screen');
    clock = new THREE.Clock();
    
    // Create a loading manager to track loading progress
    loadingManager = new THREE.LoadingManager();
    loadingManager.onLoad = function() {
        loadingScreen.style.display = 'none';
    };
    
    // Add error handler to loading manager
    loadingManager.onError = function(url) {
        console.error('Error loading resource: ' + url);
        document.querySelector('.loading-text').textContent = 
            'Error loading: ' + url + '. Check console for details.';
    };
    
    // Create scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a); // Darker background to match lobby
    
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
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.physicallyCorrectLights = true;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.gammaOutput = true;
    renderer.gammaFactor = 2.2;  // Standard gamma correction
    document.getElementById('container').appendChild(renderer.domElement);
    
    // Create orbit controls (limited to avoid shake in gameplay)
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false; // disable damping to reduce oscillation
    controls.enableRotate = false; // prevent user rotation fighting follow camera
    controls.enablePan = false;
    controls.minDistance = 1;
    controls.maxDistance = 50;
    controls.target.set(0, 1, 0);
    
    // Set up lighting - similar to what we had in Blender
    setupLighting();
    
    // Add the ground/road
    createGround();
    
    // Load the character model
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
        if (key === 'w' || key === 'a' || key === 's' || key === 'd' || key === 'shift') {
            keysPressed[key] = true;
            e.preventDefault();
        }
    });
    
    window.addEventListener('keyup', function(e) {
        const key = e.key.toLowerCase();
        if (key === 'w' || key === 'a' || key === 's' || key === 'd' || key === 'shift') {
            keysPressed[key] = false;
            e.preventDefault();
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
            crosshair.style.display = 'block';
            document.body.style.cursor = 'none';
            if (pauseMenu) pauseMenu.style.display = 'none';
            isPaused = false;
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
        cameraYaw -= e.movementX * POINTER_SENSITIVITY; // invert to feel natural
        cameraPitch -= e.movementY * POINTER_SENSITIVITY;
        const maxPitch = Math.PI / 3; // clamp ~60 degrees
        cameraPitch = Math.max(-maxPitch, Math.min(maxPitch, cameraPitch));
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
    // Ambient light - increased intensity for better visibility
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    
    // Hemisphere light for better overall illumination
    const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
    scene.add(hemisphereLight);
    
    // Key light (main light) - increased intensity
    const keyLight = new THREE.DirectionalLight(0xfff5e6, 1.5);
    keyLight.position.set(3, -2, 5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    scene.add(keyLight);
    
    // Fill light - increased intensity
    const fillLight = new THREE.DirectionalLight(0xe6f0ff, 0.7);
    fillLight.position.set(-4, 2, 3);
    scene.add(fillLight);
    
    // Back light - increased intensity
    const backLight = new THREE.DirectionalLight(0xffffff, 0.6);
    backLight.position.set(0, 5, -4);
    scene.add(backLight);
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

    // Hide lobby UI overlay
    const lobbyUI = document.getElementById('game-lobby');
    if (lobbyUI) lobbyUI.style.display = 'none';

    // Hide lobby 3D group
    if (lobbyGroup) lobbyGroup.visible = false;

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
    for (let x = -2; x <= 2; x++) {
        for (let z = -2; z <= 2; z++) {
            const chunkKey = `${x},${z}`;
            if (!loadedChunks.has(chunkKey)) {
                const chunk = buildCityChunk(x, z);
                loadedChunks.set(chunkKey, chunk);
                cityGroup.add(chunk);
                console.log('Loaded initial chunk:', chunkKey, 'at position:', x * CHUNK_SIZE, z * CHUNK_SIZE);
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

// Load character model
function loadCharacterModel() {
    console.log('Attempting to load model from:', MODEL_PATH);
    document.querySelector('.loading-text').textContent = 'Preparing to load character...';
    
    // Show loading screen if hidden
    loadingScreen.style.display = 'flex';
    
    // Create GLTF loader
    const loader = new THREE.GLTFLoader(loadingManager);
    
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
    
    // Try loading with different scale values and file version
    const tryAlternateVersion = function() {
        // Try loading an alternative version or different scaling approach
        document.querySelector('.loading-text').textContent = 'Trying alternative approach...';
        
        // Remove extension and try alternate extensions
        const basePath = MODEL_PATH.substring(0, MODEL_PATH.lastIndexOf('.'));
        const altPath = basePath + '.gltf'; // Try GLTF instead of GLB
        
        if (debugOutput) {
            debugOutput.innerHTML += `Trying alternate path: ${altPath}<br>`;
        }
        
        loader.load(
            altPath,
            function(gltf) {
                handleLoadedModel(gltf, 0.01); // Different scale for GLTF
            },
            function(xhr) {
                const percent = (xhr.loaded / xhr.total) * 100;
                document.querySelector('.loading-text').textContent = 
                    `Loading alternate: ${Math.round(percent)}%`;
            },
            function(error) {
                console.error('Error loading alternate model:', error);
                document.querySelector('.loading-text').textContent = 
                    'Model file not found or corrupted. Check console for details.';
                    
                if (debugOutput) {
                    debugOutput.innerHTML += 'Model loading failed. Test cube should be visible.<br>';
                }
            }
        );
    };
    
    // Function to handle loaded model with given scale
    const handleLoadedModel = function(gltf, scale) {
        console.log('Model loaded successfully!', gltf);
        character = gltf.scene;
        
        // Log model details
        console.log('Model structure:', gltf);
        
        // Ensure model is properly scaled and positioned - much larger scale
        character.scale.set(scale * 100, scale * 100, scale * 100);
        
        // Position the model properly on the ground and center it
        character.position.set(0, 0.1, 0); // Slight lift to avoid z-fighting with ground
        character.rotation.y = 0; // Face forward initially
        console.log('Character positioned at center:', character.position);
        console.log('Character scale:', character.scale);
        
        // Ensure model receives and casts shadows
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
                        node.material.map.encoding = THREE.sRGBEncoding;
                    }
                }
            }
        });
        
        scene.add(character);

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
                'Primary model failed. Trying alternative...';
                
            if (debugOutput) {
                debugOutput.innerHTML += `First attempt failed: ${error.message}<br>`;
            }
            
            // Try alternative approach
            tryAlternateVersion();
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

                // Position character at city center (0, 0.1, 0)
                if (character) {
                    character.position.set(0, 0.1, 0);
                    character.rotation.y = 0; // Face forward
                    console.log('Character positioned at city center:', character.position);

                    // Ensure character is on the ground (y = 0.1)
                    character.position.y = 0.1;
                }

                // Set up third-person camera view (behind character, looking at world)
                const thirdPersonDistance = 8;
                const thirdPersonHeight = 3;
                camera.position.set(
                    character.position.x,
                    character.position.y + thirdPersonHeight,
                    character.position.z + thirdPersonDistance
                );
                controls.target.set(
                    character.position.x,
                    character.position.y + 1.2,
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
}

// Animation loop
function animate() {
    requestAnimationFrame(animate);

    const delta = clock ? clock.getDelta() : 0.016;

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
    
    // Render scene
    renderer.render(scene, camera);
}

// Update character movement using camera-relative WASD
function updateCharacterMovement(delta) {
    if (!character) return;

    // Derive forward from camera direction (no translation)
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() > 0) forward.normalize();

    // Right vector perpendicular to forward and up
    const right = new THREE.Vector3();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    let move = new THREE.Vector3(0, 0, 0);
    if (keysPressed['w']) {
        move.add(forward); // Forward
    }
    if (keysPressed['s']) {
        move.sub(forward); // Backward
    }
    if (keysPressed['a']) {
        move.sub(right); // Left (subtract right vector to go left)
    }
    if (keysPressed['d']) {
        move.add(right); // Right (add right vector to go right)
    }

    const isMoving = move.lengthSq() > 1e-6;
    if (isMoving) {
        const speed = MOVE_SPEED * (keysPressed['shift'] && keysPressed['w'] ? SPRINT_MULTIPLIER : 1);
        move.normalize().multiplyScalar(speed * delta);
        character.position.add(move);

        // Smoothly rotate character to face movement direction
        const targetYaw = Math.atan2(move.x, move.z);
        const targetQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), targetYaw);
        character.quaternion.slerp(targetQuat, Math.min(1, 12 * delta));
    }

    // Apply mouse-look yaw/pitch to define camera orbit behind the character
    const thirdPersonDistance = 8;
    const thirdPersonHeight = 2.0;
    const baseYaw = character.rotation.y + cameraYaw;
    const offsetX = Math.sin(baseYaw) * -thirdPersonDistance;
    const offsetZ = Math.cos(baseYaw) * -thirdPersonDistance;
    const offsetY = thirdPersonHeight + Math.sin(cameraPitch) * 1.0; // slight pitch influence
    const desiredCameraPos = new THREE.Vector3(
        character.position.x + offsetX,
        character.position.y + offsetY,
        character.position.z + offsetZ
    );
    const camLerp = isPointerLocked ? 0.25 : 0.15; // slightly faster when locked
    const targetLerp = isPointerLocked ? 0.35 : 0.25;
    camera.position.lerp(desiredCameraPos, camLerp);
    controls.target.lerp(character.position.clone().add(new THREE.Vector3(0, 1.2, 0)), targetLerp);

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

    console.log(`Character at (${pos.x.toFixed(1)}, ${pos.z.toFixed(1)}), chunk (${cx}, ${cz})`);

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

    console.log(`Building chunk at (${cx}, ${cz}) with origin (${originX.toFixed(1)}, ${originZ.toFixed(1)})`);

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
    const hRoad = new THREE.Mesh(new THREE.PlaneGeometry(CHUNK_SIZE, 2), roadMaterial);
    hRoad.rotation.x = -Math.PI / 2;
    hRoad.position.set(originX + CHUNK_SIZE / 2, 0.01, originZ + CHUNK_SIZE / 2);
    group.add(hRoad);
    const vRoad = new THREE.Mesh(new THREE.PlaneGeometry(2, CHUNK_SIZE), roadMaterial);
    vRoad.rotation.x = -Math.PI / 2;
    vRoad.position.set(originX + CHUNK_SIZE / 2, 0.01, originZ + CHUNK_SIZE / 2);
    group.add(vRoad);

    // Buildings: place 4 around the cross
    const blockSize = 8;
    const placements = [
        { x: originX + 6, z: originZ + 6 },
        { x: originX + CHUNK_SIZE - 6, z: originZ + 6 },
        { x: originX + 6, z: originZ + CHUNK_SIZE - 6 },
        { x: originX + CHUNK_SIZE - 6, z: originZ + CHUNK_SIZE - 6 },
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