'use client';

import { useRef, useEffect } from 'react';
import { MapControls } from '@react-three/drei';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/** Fixed offset from target so the view angle never tilts when zooming/panning. */
const CAMERA_OFFSET = new THREE.Vector3(60, 80, 60);

interface MapControllerProps {
  target?: [number, number, number];
}

/**
 * Camera controls for panning and zooming the isometric map.
 * Uses drei's MapControls with a locked perspective: camera position is always
 * target + CAMERA_OFFSET so zoom and pan do not change the viewing angle.
 */
export default function MapController({ target }: MapControllerProps) {
  const controlsRef = useRef<any>(null);
  const { camera } = useThree();

  useEffect(() => {
    if (target && controlsRef.current) {
      controlsRef.current.target.set(...target);
      controlsRef.current.update();
    }
  }, [target]);

  // Lock camera to fixed perspective: position = target + offset, lookAt(target).
  // Runs after controls.update() so zoom (orthographic) and pan (target) still work.
  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls?.target) return;
    const t = controls.target;
    camera.position.set(t.x + CAMERA_OFFSET.x, t.y + CAMERA_OFFSET.y, t.z + CAMERA_OFFSET.z);
    camera.lookAt(t.x, t.y, t.z);
  });

  return (
    <MapControls
      ref={controlsRef}
      enableRotate={false}
      enableDamping
      dampingFactor={0.15}
      minZoom={2}
      maxZoom={60}
      zoomSpeed={1.5}
      panSpeed={1.8}
      screenSpacePanning
    />
  );
}
