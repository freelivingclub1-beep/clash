/**
 * Renderer, lighting and camera rig.
 *
 * The camera is a spherical rig -- target point, radius, azimuth, elevation,
 * field of view -- and every "view" in the UI is just five numbers. Interior
 * shots are the same rig with the target moved inside the cabin, which is why
 * dragging works identically indoors and out with no second control scheme.
 */

import * as THREE from 'three';
import { RoomEnvironment } from '../vendor/three/RoomEnvironment.js';
import { makeShadowTexture } from './materials.js';

const damp = (current, target, lambda, dt) =>
  current + (target - current) * (1 - Math.exp(-lambda * dt));

export class Stage {
  constructor(container) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);

    // Image-based lighting from a procedural room. No HDR file to ship, and
    // the soft box reflections it produces are what make paint look wet.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(4, 6, 3);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0xc9dcff, 0.7);
    rim.position.set(-5, 3, -4);
    this.scene.add(rim);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6b6f74, 0.45));

    // Ground shadow: one painted, blurred ellipse. Cheaper than a shadow map
    // and it never shimmers when the camera moves.
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(6.4, 3.4),
      new THREE.MeshBasicMaterial({
        map: makeShadowTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0.9,
      })
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.001;
    this.scene.add(this.shadow);
    this.shadowBase = { width: 6.4, depth: 3.4 };

    this.pose = { targetY: 0.72, targetX: 0, radius: 9.4, azimuth: 0.9, elevation: 0.16, fov: 30 };
    this.goal = { ...this.pose };
    this.autoSpin = false;

    this._bindPointer();
    this._resize();
    this._observer = new ResizeObserver(() => this._resize());
    this._observer.observe(container);

    this.clock = new THREE.Clock();
  }

  setView(view) {
    Object.assign(this.goal, view);
  }

  /** Resizes the ground shadow to whichever car is currently on the stage. */
  frameGround(dims) {
    const length = dims.front - dims.rear;
    const scale = length / 4.0;
    this.shadow.scale.set(scale, (dims.trackHalf * 2) / 1.8, 1);
  }

  /** Snap without animating -- used for the very first frame. */
  jumpTo(view) {
    Object.assign(this.goal, view);
    Object.assign(this.pose, this.goal);
  }

  _bindPointer() {
    const el = this.renderer.domElement;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    el.addEventListener('pointerdown', (e) => {
      dragging = true;
      this.autoSpin = false;
      lastX = e.clientX;
      lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
      el.classList.add('grabbing');
    });

    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      this.goal.azimuth -= dx * 0.006;
      this.goal.elevation = THREE.MathUtils.clamp(
        this.goal.elevation + dy * 0.004,
        -0.12,
        0.85
      );
      // Dragging is a manual override; keep the eased pose from fighting it.
      this.pose.azimuth += (this.goal.azimuth - this.pose.azimuth) * 0.55;
    });

    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      el.releasePointerCapture?.(e.pointerId);
      el.classList.remove('grabbing');
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);

    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.goal.radius = THREE.MathUtils.clamp(
          this.goal.radius * (1 + Math.sign(e.deltaY) * 0.08),
          2.2,
          16
        );
      },
      { passive: false }
    );
  }

  _resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  update() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.autoSpin) this.goal.azimuth += dt * 0.22;

    for (const k of ['targetX', 'targetY', 'radius', 'elevation', 'fov']) {
      this.pose[k] = damp(this.pose[k], this.goal[k], 5.5, dt);
    }
    this.pose.azimuth = damp(this.pose.azimuth, this.goal.azimuth, 5.5, dt);

    const { radius, azimuth, elevation, targetX, targetY } = this.pose;
    const cosE = Math.cos(elevation);
    this.camera.position.set(
      targetX + radius * cosE * Math.sin(azimuth),
      targetY + radius * Math.sin(elevation),
      radius * cosE * Math.cos(azimuth)
    );
    this.camera.lookAt(targetX, targetY, 0);

    if (Math.abs(this.camera.fov - this.pose.fov) > 0.01) {
      this.camera.fov = this.pose.fov;
      this.camera.updateProjectionMatrix();
    }

    this.renderer.render(this.scene, this.camera);
  }

  start() {
    const loop = () => {
      this.update();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
