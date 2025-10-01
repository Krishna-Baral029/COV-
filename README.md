# COV - Crime Over Virtue

[![Deploy](https://img.shields.io/badge/Deploy-Render-blue)](https://render.com)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![Three.js](https://img.shields.io/badge/Built%20with-Three.js-orange)](https://threejs.org/)

A 3D web-based action game built with Three.js featuring immersive urban environments, character movement, and dynamic city exploration.

![COV Game Logo](COV.png)

## 🎮 Features

- **3D Character Control**: WASD movement with smooth camera follow
- **Dynamic City Environment**: Procedurally generated urban landscape with streaming chunks
- **Immersive Graphics**: High-quality 3D models with realistic lighting and shadows
- **Lobby System**: Interactive game lobby with ready/play mechanics
- **Mouse Look**: First-person camera control with pointer lock
- **Performance Optimized**: Chunk-based world streaming for smooth gameplay
- **Cross-Platform**: Runs in any modern web browser

## 🕹️ Gameplay

### Controls
- **W, A, S, D** - Character movement
- **Mouse** - Camera look (when pointer locked)
- **Click Canvas** - Lock pointer for mouse look
- **ESC** - Exit pointer lock
- **~ (Tilde)** - Toggle debug controls panel

### Game Flow
1. **Lobby**: Set your ready status and start the game
2. **City Exploration**: Navigate through the procedurally generated urban environment
3. **Dynamic World**: Experience seamless chunk loading as you explore

## 🛠️ Technology Stack

- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **3D Engine**: Three.js (v0.132.2)
- **3D Models**: GLTF/GLB format with Draco compression support
- **Audio**: Web Audio API for immersive sound effects
- **Deployment**: Static hosting compatible (Render, Netlify, Vercel)

## 📁 Project Structure

```
COV/
├── index.html              # Main HTML file
├── main.js                 # Core game logic and Three.js setup
├── styles.css              # Game styling and UI
├── render.yaml             # Render deployment configuration
├── base (1).glb # 3D character model
├── Standing Idle.fbx       # Alternative character animation
├── COV.png                 # Game logo
├── Lobby.png              # Lobby background
├── transparentcoin.png    # In-game currency icon
└── README.md              # Project documentation
```

## 🚀 Quick Start

### Local Development

1. **Clone the repository**
   ```bash
   git clone https://github.com/Krishna-Baral029/COV-.git
   cd COV-
   ```

2. **Start a local server**
   ```bash
   # Using Python 3
   python -m http.server 8000
   
   # Using Python 2
   python -m SimpleHTTPServer 8000
   
   # Using Node.js (if you have http-server installed)
   npx http-server
   
   # Using Live Server (VS Code extension)
   # Right-click on index.html and select "Open with Live Server"
   ```

3. **Open in browser**
   Navigate to `http://localhost:8000` in your web browser

### Online Deployment

The game is ready to deploy on any static hosting platform:

- **Render**: Configured with `render.yaml` - just connect your GitHub repo
- **Netlify**: Drag and drop the entire folder
- **Vercel**: Connect GitHub repo for automatic deployments
- **GitHub Pages**: Enable Pages in repository settings

## 🎯 Game Architecture

### Core Components

1. **Scene Management**
   - Three.js scene setup with optimized lighting
   - Multiple environment groups (lobby, city)
   - Dynamic object management

2. **Character System**
   - GLTF model loading with fallback support
   - Smooth movement with physics-based controls
   - Animation state management

3. **World Streaming**
   - Chunk-based world generation
   - Dynamic loading/unloading of city sections
   - Performance-optimized rendering

4. **Audio System**
   - Web Audio API integration
   - Context-aware sound loading
   - Interactive feedback systems

### Performance Features

- **LOD Management**: Level of detail optimization for distant objects
- **Chunk Streaming**: Only loads visible world sections
- **Shadow Optimization**: Selective shadow casting for performance
- **Material Reuse**: Efficient resource management

## 🎨 Customization

### Adding New Models
1. Place your `.glb` or `.gltf` files in the root directory
2. Update the `MODEL_PATH` constant in `main.js`
3. Adjust scaling in the `handleLoadedModel` function

### Modifying the City
- Edit `buildCityChunk()` function to change building generation
- Adjust `CHUNK_SIZE` and `CHUNK_RADIUS` for world density
- Customize materials in `createBuildingMesh()`

### UI Customization
- Modify `styles.css` for visual changes
- Update `index.html` for structural changes
- Edit lobby behavior in `setupUIEvents()`

## 🐛 Troubleshooting

### Common Issues

1. **Model Not Loading**
   - Ensure model file is named correctly
   - Check browser console for detailed error messages
   - Verify model format (GLB/GLTF)
   - Use debug tools (press ~ key)

2. **Performance Issues**
   - Reduce `CHUNK_RADIUS` in main.js
   - Disable windows by setting `ENABLE_WINDOWS = false`
   - Lower shadow quality in lighting setup

3. **Audio Not Working**
   - Audio requires user interaction to start
   - Check browser's autoplay policies
   - Verify audio context initialization

## 📈 Browser Compatibility

- **Chrome 88+** ✅
- **Firefox 85+** ✅ 
- **Safari 14+** ✅
- **Edge 88+** ✅

### Required Browser Features
- WebGL 2.0 support
- ES6+ JavaScript features
- Pointer Lock API
- Web Audio API

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🎓 Credits

- **Developer**: Krishna Baral
- **3D Engine**: [Three.js](https://threejs.org/)
- **Fonts**: Custom grunge and urban fonts
- **Assets**: Original game assets and models

## 🔗 Links

- **Live Demo**: [Coming Soon]
- **GitHub Repository**: https://github.com/Krishna-Baral029/COV-
- **Issues**: https://github.com/Krishna-Baral029/COV-/issues
- **Discussions**: https://github.com/Krishna-Baral029/COV-/discussions

## 🎯 Roadmap

- [ ] Multiplayer support
- [ ] Advanced physics system
- [ ] Mobile device optimization
- [ ] Sound effects and music
- [ ] Character customization
- [ ] Mission/quest system
- [ ] Inventory and items system
- [ ] Enhanced AI and NPCs

---

**Built with ❤️ using Three.js and modern web technologies**
