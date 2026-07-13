'use client';

import { useRef, useEffect } from 'react';
import { MapControls } from '@react-three/drei';
import { useThree, useFrame } from '@react-three/fiber';
import { MOUSE } from 'three';
import * as THREE from 'three';
import { useGameStore } from '@/store/useGameStore';

/**
 * Fixed offset from target so the view angle never tilts when zooming/panning.
 * Equal X/Z and Y = √2 × run gives a symmetric “true” isometric-style ortho view
 * (camera direction along (1, √2, 1) before normalize).
 */
const ISO_RUN = 72;
export const MAP_CAMERA_OFFSET = new THREE.Vector3(ISO_RUN, ISO_RUN * Math.SQRT2, ISO_RUN);

interface MapControllerProps {
  target?: [number, number, number];
  applyTargetUpdates?: boolean;
}

/**
 * Camera controls for panning and zooming the isometric map.
 * Uses drei's MapControls with a locked perspective: camera position is always
 * target + CAMERA_OFFSET so zoom and pan do not change the viewing angle.
 */
export default function MapController({ target, applyTargetUpdates = true }: MapControllerProps) {
  const controlsRef = useRef<any>(null);
  const appliedInitialTargetRef = useRef(false);
  const lastAppliedTargetRef = useRef<[number, number, number] | null>(null);
  const { camera } = useThree();

  useEffect(() => {
    if (target && controlsRef.current) {
      const last = lastAppliedTargetRef.current;
      const targetChanged =
        !last || last[0] !== target[0] || last[1] !== target[1] || last[2] !== target[2];
      if (!applyTargetUpdates && appliedInitialTargetRef.current && !targetChanged) return;
      controlsRef.current.target.set(...target);
      controlsRef.current.update();
      appliedInitialTargetRef.current = true;
      lastAppliedTargetRef.current = target;
    }
  }, [target, applyTargetUpdates]);

  // Early: turn off MapControls while box-selecting (before controls.update applies pan).
  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const boxActive = useGameStore.getState().unitBoxSelectRect !== null;
    controls.enabled = !boxActive;
  }, -1);

  // After MapControls: lock camera to fixed perspective (target + offset, lookAt target).
  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls?.target) return;
    const t = controls.target;
    camera.position.set(t.x + MAP_CAMERA_OFFSET.x, t.y + MAP_CAMERA_OFFSET.y, t.z + MAP_CAMERA_OFFSET.z);
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
      mouseButtons={{ LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: null as any }}
    />
  );
}
