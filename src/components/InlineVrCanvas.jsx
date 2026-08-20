import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { RotateCcw, Glasses, Compass, X } from 'lucide-react';

export const VR_MODES = [
  { id: '180_3d_sbs', label: '180° 3D (左右 SBS)' },
  { id: '180_2d', label: '180° 半球全景 (Dome)' },
  { id: '360_2d', label: '360° 全景 (2D)' },
  { id: '360_3d_sbs', label: '360° 3D (左右 SBS)' },
  { id: '360_3d_tb', label: '360° 3D (上下 Top-Bottom)' },
  { id: 'plane_cinema', label: '📺 虚拟曲面巨幕' }
];

export default function InlineVrCanvas({
  videoRef,
  isActive,
  onClose,
  initialMode = '180_3d_sbs'
}) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const meshRef = useRef(null);
  const textureRef = useRef(null);
  const animFrameRef = useRef(null);

  // Rotation & State
  const isUserInteractingRef = useRef(false);
  const onPointerDownPointerXRef = useRef(0);
  const onPointerDownPointerYRef = useRef(0);
  const onPointerDownLonRef = useRef(0);
  const onPointerDownLatRef = useRef(0);
  const lonRef = useRef(0);
  const latRef = useRef(0);
  const phiRef = useRef(0);
  const thetaRef = useRef(0);
  const fovRef = useRef(100);

  const [vrMode, setVrMode] = useState(initialMode);
  const [fov, setFov] = useState(100);

  // Setup Geometry based on VR mode
  const setupGeometry = useCallback((mode) => {
    const scene = sceneRef.current;
    if (!scene || !textureRef.current) return;

    if (meshRef.current) {
      scene.remove(meshRef.current);
      if (meshRef.current.geometry) meshRef.current.geometry.dispose();
      if (meshRef.current.material) meshRef.current.material.dispose();
      meshRef.current = null;
    }

    let geometry;
    const radius = 500;

    switch (mode) {
      case '180_2d':
        // 180 Hemisphere Dome
        geometry = new THREE.SphereGeometry(radius, 64, 32, -Math.PI / 2, Math.PI, 0, Math.PI);
        geometry.scale(-1, 1, 1);
        break;

      case '180_3d_sbs':
        // 180 SBS 3D: Map left eye half to front 180 dome
        geometry = new THREE.SphereGeometry(radius, 64, 32, -Math.PI / 2, Math.PI, 0, Math.PI);
        geometry.scale(-1, 1, 1);
        const uvs180 = geometry.attributes.uv;
        for (let i = 0; i < uvs180.count; i++) {
          uvs180.setX(i, uvs180.getX(i) * 0.5);
        }
        uvs180.needsUpdate = true;
        break;

      case '360_3d_sbs':
        // 360 SBS 3D: Map left eye half to full 360 sphere
        geometry = new THREE.SphereGeometry(radius, 64, 32);
        geometry.scale(-1, 1, 1);
        const uvs360 = geometry.attributes.uv;
        for (let i = 0; i < uvs360.count; i++) {
          uvs360.setX(i, uvs360.getX(i) * 0.5);
        }
        uvs360.needsUpdate = true;
        break;

      case '360_3d_tb':
        // 360 Top-Bottom 3D: Map top half to full 360 sphere
        geometry = new THREE.SphereGeometry(radius, 64, 32);
        geometry.scale(-1, 1, 1);
        const uvsTb = geometry.attributes.uv;
        for (let i = 0; i < uvsTb.count; i++) {
          uvsTb.setY(i, uvsTb.getY(i) * 0.5 + 0.5);
        }
        uvsTb.needsUpdate = true;
        break;

      case 'plane_cinema':
        // Curved Virtual Cinema Screen
        geometry = new THREE.CylinderGeometry(radius * 0.8, radius * 0.8, radius * 0.9, 48, 1, true, -Math.PI / 3, (2 * Math.PI) / 3);
        geometry.scale(-1, 1, 1);
        break;

      case '360_2d':
      default:
        // Full 360 Equirectangular Sphere
        geometry = new THREE.SphereGeometry(radius, 64, 32);
        geometry.scale(-1, 1, 1);
        break;
    }

    const material = new THREE.MeshBasicMaterial({
      map: textureRef.current,
      side: THREE.FrontSide
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    meshRef.current = mesh;
  }, []);

  // Initialize Three.js WebGL Engine inside current window/tile container
  useEffect(() => {
    if (!isActive || !containerRef.current || !videoRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth || 400;
    const height = container.clientHeight || 225;

    // 1. Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // 2. Camera
    const camera = new THREE.PerspectiveCamera(fovRef.current, width / height, 1, 1100);
    camera.target = new THREE.Vector3(0, 0, 0);
    cameraRef.current = camera;

    // 3. Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    rendererRef.current = renderer;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // 4. Video Texture bound directly to current playing <video> element
    const video = videoRef.current;
    const texture = new THREE.VideoTexture(video);
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.format = THREE.RGBAFormat;
    textureRef.current = texture;

    setupGeometry(vrMode);

    // 5. Render Loop
    let isRunning = true;
    const animate = () => {
      if (!isRunning) return;
      animFrameRef.current = requestAnimationFrame(animate);

      latRef.current = Math.max(-85, Math.min(85, latRef.current));
      phiRef.current = THREE.MathUtils.degToRad(90 - latRef.current);
      thetaRef.current = THREE.MathUtils.degToRad(lonRef.current);

      camera.target.x = 500 * Math.sin(phiRef.current) * Math.cos(thetaRef.current);
      camera.target.y = 500 * Math.cos(phiRef.current);
      camera.target.z = 500 * Math.sin(phiRef.current) * Math.sin(thetaRef.current);
      camera.lookAt(camera.target);

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      const w = container.clientWidth || 400;
      const h = container.clientHeight || 225;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      isRunning = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      resizeObserver.disconnect();
      if (meshRef.current) {
        scene.remove(meshRef.current);
        if (meshRef.current.geometry) meshRef.current.geometry.dispose();
        if (meshRef.current.material) meshRef.current.material.dispose();
      }
      if (textureRef.current) textureRef.current.dispose();
      if (rendererRef.current) rendererRef.current.dispose();
      if (container) container.innerHTML = '';
    };
  }, [isActive, setupGeometry, vrMode]);

  // Pointer Drag to Look Around (Pitch & Yaw)
  const handlePointerDown = (e) => {
    isUserInteractingRef.current = true;
    onPointerDownPointerXRef.current = e.clientX || e.touches?.[0]?.clientX || 0;
    onPointerDownPointerYRef.current = e.clientY || e.touches?.[0]?.clientY || 0;
    onPointerDownLonRef.current = lonRef.current;
    onPointerDownLatRef.current = latRef.current;
  };

  const handlePointerMove = (e) => {
    if (!isUserInteractingRef.current) return;
    const clientX = e.clientX || e.touches?.[0]?.clientX || 0;
    const clientY = e.clientY || e.touches?.[0]?.clientY || 0;
    lonRef.current = (onPointerDownPointerXRef.current - clientX) * 0.18 + onPointerDownLonRef.current;
    latRef.current = (clientY - onPointerDownPointerYRef.current) * 0.18 + onPointerDownLatRef.current;
  };

  const handlePointerUp = () => {
    isUserInteractingRef.current = false;
  };

  // Wheel to adjust FOV / Seek
  const handleWheel = (e) => {
    if (e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      const deltaFov = e.deltaY > 0 ? 4 : -4;
      const nextFov = Math.max(50, Math.min(130, fovRef.current + deltaFov));
      fovRef.current = nextFov;
      setFov(nextFov);
      if (cameraRef.current) {
        cameraRef.current.fov = nextFov;
        cameraRef.current.updateProjectionMatrix();
      }
    }
  };

  const resetOrientation = (e) => {
    if (e) e.stopPropagation();
    lonRef.current = 0;
    latRef.current = 0;
    fovRef.current = 100;
    setFov(100);
    if (cameraRef.current) {
      cameraRef.current.fov = 100;
      cameraRef.current.updateProjectionMatrix();
    }
  };

  if (!isActive) return null;

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-black overflow-hidden select-none">
      {/* Top Inline VR HUD inside this tile */}
      <div 
        className="absolute top-2 inset-x-2 z-30 flex items-center justify-between pointer-events-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1.5 bg-black/80 backdrop-blur-md px-2 py-0.5 rounded-lg border border-cyan-500/40 text-[11px] font-bold text-cyan-300 shadow-md">
          <Glasses size={13} className="animate-pulse text-amber-400" />
          <span>VR 模式</span>
        </div>

        <div className="flex items-center gap-1">
          {/* Mode Selector */}
          <select
            value={vrMode}
            onChange={(e) => {
              const mode = e.target.value;
              setVrMode(mode);
              setupGeometry(mode);
            }}
            className="px-2 py-0.5 rounded-lg bg-black/85 border border-cyan-400/50 text-cyan-300 text-[11px] font-medium focus:outline-none cursor-pointer"
          >
            {VR_MODES.map(m => (
              <option key={m.id} value={m.id} className="bg-slate-900 text-white">
                {m.label}
              </option>
            ))}
          </select>

          {/* Reset Orientation */}
          <button
            onClick={resetOrientation}
            className="p-1 rounded-lg bg-black/80 hover:bg-black border border-white/20 text-gray-300 hover:text-cyan-300 transition"
            title="视角复位 (居中)"
          >
            <RotateCcw size={12} />
          </button>

          {/* Exit VR */}
          <button
            onClick={onClose}
            className="p-1 rounded-lg bg-red-950/90 hover:bg-red-900 border border-red-500/50 text-red-200 transition"
            title="退出 VR"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* WebGL Canvas */}
      <div
        ref={containerRef}
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        onTouchStart={handlePointerDown}
        onTouchMove={handlePointerMove}
        onTouchEnd={handlePointerUp}
        onWheel={handleWheel}
        className="w-full h-full cursor-grab active:cursor-grabbing bg-black touch-none"
      />
    </div>
  );
}
