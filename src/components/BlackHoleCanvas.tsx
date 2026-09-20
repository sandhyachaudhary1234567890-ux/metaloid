import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

// Black hole hero stage — three.js port, no CDN (bundled three@0.163).
// Perf guards: quality scales with viewport, DPR capped, static frame on
// reduced-motion, touch never hijacks page scroll, full GPU dispose on
// unmount, rAF-driven (auto-pauses in background tabs).

const BLACK_HOLE_RADIUS = 1.3;
const DISK_INNER_RADIUS = BLACK_HOLE_RADIUS + 0.2;
const DISK_OUTER_RADIUS = 8.0;
const DISK_TILT_ANGLE = Math.PI / 3.0;

const STAR_PALETTE = [
  0x88aaff, 0xffaaff, 0xaaffff, 0xffddaa, 0xffeecc, 0xffffff,
  0xff8888, 0x88ff88, 0xffff88, 0x88ffff,
];

export function BlackHoleCanvas({ className }: { className?: string }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !window.WebGLRenderingContext) return;
    const isMobile = window.matchMedia('(pointer: coarse)').matches;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const small = mount.clientWidth < 640;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x020104, 0.025);

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 4000);
    camera.position.set(-6.5, 5.0, 6.5);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: !isMobile, powerPreference: 'high-performance' });
    } catch {
      return; // no WebGL — stage background remains, UI unaffected
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.25 : 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.touchAction = 'pan-y';
    mount.appendChild(renderer.domElement);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(mount.clientWidth || 800, mount.clientHeight || 480),
      0.8, 0.7, 0.8
    );
    composer.addPass(bloomPass);

    const lensingShader = {
      uniforms: {
        tDiffuse: { value: null as unknown },
        blackHoleScreenPos: { value: new THREE.Vector2(0.5, 0.5) },
        lensingStrength: { value: 0.12 },
        lensingRadius: { value: 0.3 },
        aspectRatio: { value: 1 },
        chromaticAberration: { value: 0.005 },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: [
        'uniform sampler2D tDiffuse;',
        'uniform vec2 blackHoleScreenPos;',
        'uniform float lensingStrength;',
        'uniform float lensingRadius;',
        'uniform float aspectRatio;',
        'uniform float chromaticAberration;',
        'varying vec2 vUv;',
        'void main() {',
        '  vec2 screenPos = vUv;',
        '  vec2 toCenter = screenPos - blackHoleScreenPos;',
        '  toCenter.x *= aspectRatio;',
        '  float dist = length(toCenter);',
        '  float distortionAmount = lensingStrength / (dist * dist + 0.003);',
        '  distortionAmount = clamp(distortionAmount, 0.0, 0.7);',
        '  float falloff = smoothstep(lensingRadius, lensingRadius * 0.3, dist);',
        '  distortionAmount *= falloff;',
        '  vec2 offset = normalize(toCenter + vec2(1e-6)) * distortionAmount;',
        '  offset.x /= aspectRatio;',
        '  vec3 col;',
        '  col.r = texture2D(tDiffuse, screenPos - offset * (1.0 + chromaticAberration)).r;',
        '  col.g = texture2D(tDiffuse, screenPos - offset).g;',
        '  col.b = texture2D(tDiffuse, screenPos - offset * (1.0 - chromaticAberration)).b;',
        '  gl_FragColor = vec4(col, 1.0);',
        '}',
      ].join('\n'),
    };
    const lensingPass = new ShaderPass(lensingShader);
    composer.addPass(lensingPass);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.035;
    controls.rotateSpeed = 0.4;
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.minDistance = 2.5;
    controls.maxDistance = 100;
    controls.target.set(0, 0, 0);
    // touch screens: never trap vertical scroll — slow auto-drift instead
    controls.enabled = !isMobile;
    controls.autoRotate = true;
    controls.autoRotateSpeed = isMobile ? 0.25 : 0.12;
    controls.update();

    // ---- stars ----
    const starCount = small ? 22000 : isMobile ? 35000 : 60000;
    const starGeometry = new THREE.BufferGeometry();
    const starPositions = new Float32Array(starCount * 3);
    const starColors = new Float32Array(starCount * 3);
    const starSizes = new Float32Array(starCount);
    const starTwinkle = new Float32Array(starCount);
    const starFieldRadius = 2000;
    const tmpColor = new THREE.Color();
    for (let i = 0; i < starCount; i++) {
      const i3 = i * 3;
      const phi = Math.acos(-1 + (2 * i) / starCount);
      const theta = Math.sqrt(starCount * Math.PI) * phi;
      const radius = Math.cbrt(Math.random()) * starFieldRadius + 100;
      starPositions[i3] = radius * Math.sin(phi) * Math.cos(theta);
      starPositions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      starPositions[i3 + 2] = radius * Math.cos(phi);
      tmpColor.setHex(STAR_PALETTE[(Math.random() * STAR_PALETTE.length) | 0]);
      tmpColor.multiplyScalar(Math.random() * 0.7 + 0.3);
      starColors[i3] = tmpColor.r;
      starColors[i3 + 1] = tmpColor.g;
      starColors[i3 + 2] = tmpColor.b;
      starSizes[i] = 0.6 + Math.random() * 2.4;
      starTwinkle[i] = Math.random() * Math.PI * 2;
    }
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    starGeometry.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
    starGeometry.setAttribute('size', new THREE.BufferAttribute(starSizes, 1));
    starGeometry.setAttribute('twinkle', new THREE.BufferAttribute(starTwinkle, 1));

    const starMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: renderer.getPixelRatio() } },
      vertexShader: [
        'uniform float uTime;',
        'uniform float uPixelRatio;',
        'attribute float size;',
        'attribute float twinkle;',
        'varying vec3 vColor;',
        'varying float vTwinkle;',
        'void main() {',
        '  vColor = color;',
        '  vTwinkle = sin(uTime * 2.5 + twinkle) * 0.5 + 0.5;',
        '  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
        '  gl_PointSize = size * uPixelRatio * (300.0 / -mvPosition.z);',
        '  gl_Position = projectionMatrix * mvPosition;',
        '}',
      ].join('\n'),
      fragmentShader: [
        'varying vec3 vColor;',
        'varying float vTwinkle;',
        'void main() {',
        '  float dist = distance(gl_PointCoord, vec2(0.5));',
        '  if (dist > 0.5) discard;',
        '  float alpha = 1.0 - smoothstep(0.0, 0.5, dist);',
        '  alpha *= (0.2 + vTwinkle * 0.8);',
        '  gl_FragColor = vec4(vColor, alpha);',
        '}',
      ].join('\n'),
      transparent: true,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const stars = new THREE.Points(starGeometry, starMaterial);
    scene.add(stars);

    // ---- event horizon glow + black sphere ----
    const eventHorizonMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uCameraPosition: { value: camera.position.clone() } },
      vertexShader: [
        'varying vec3 vNormal;',
        'varying vec3 vPosition;',
        'void main() {',
        '  vNormal = normalize(normalMatrix * normal);',
        '  vPosition = position;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform float uTime;',
        'uniform vec3 uCameraPosition;',
        'varying vec3 vNormal;',
        'varying vec3 vPosition;',
        'void main() {',
        '  vec3 viewDirection = normalize(uCameraPosition - vPosition);',
        '  float fresnel = 1.0 - abs(dot(vNormal, viewDirection));',
        '  fresnel = pow(fresnel, 2.5);',
        '  vec3 glowColor = vec3(1.0, 0.4, 0.1);',
        '  float pulse = sin(uTime * 2.5) * 0.15 + 0.85;',
        '  gl_FragColor = vec4(glowColor * fresnel * pulse, fresnel * 0.4);',
        '}',
      ].join('\n'),
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
    });
    const eventHorizon = new THREE.Mesh(
      new THREE.SphereGeometry(BLACK_HOLE_RADIUS * 1.05, isMobile ? 64 : 128, isMobile ? 32 : 64),
      eventHorizonMat
    );
    scene.add(eventHorizon);

    const blackHoleMesh = new THREE.Mesh(
      new THREE.SphereGeometry(BLACK_HOLE_RADIUS, isMobile ? 64 : 128, isMobile ? 32 : 64),
      new THREE.MeshBasicMaterial({ color: 0x000000 })
    );
    blackHoleMesh.renderOrder = 0;
    scene.add(blackHoleMesh);

    // ---- accretion disk ----
    const diskMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0.0 },
        uColorHot: { value: new THREE.Color(0xffffff) },
        uColorMid1: { value: new THREE.Color(0xff7733) },
        uColorMid2: { value: new THREE.Color(0xff4477) },
        uColorMid3: { value: new THREE.Color(0x7744ff) },
        uColorOuter: { value: new THREE.Color(0x4477ff) },
        uNoiseScale: { value: 2.5 },
        uFlowSpeed: { value: 0.22 },
        uDensity: { value: 1.3 },
      },
      vertexShader: [
        'varying vec2 vUv;',
        'varying float vRadius;',
        'varying float vAngle;',
        'void main() {',
        '  vUv = uv;',
        '  vRadius = length(position.xy);',
        `  vAngle = atan(position.y, position.x);`,
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform float uTime;',
        'uniform vec3 uColorHot;',
        'uniform vec3 uColorMid1;',
        'uniform vec3 uColorMid2;',
        'uniform vec3 uColorMid3;',
        'uniform vec3 uColorOuter;',
        'uniform float uNoiseScale;',
        'uniform float uFlowSpeed;',
        'uniform float uDensity;',
        'varying vec2 vUv;',
        'varying float vRadius;',
        'varying float vAngle;',
        'vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }',
        'vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }',
        'vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }',
        'vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }',
        'float snoise(vec3 v) {',
        '  const vec2 C = vec2(1.0/6.0, 1.0/3.0);',
        '  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);',
        '  vec3 i  = floor(v + dot(v, C.yyy));',
        '  vec3 x0 = v - i + dot(i, C.xxx);',
        '  vec3 g = step(x0.yzx, x0.xyz);',
        '  vec3 l = 1.0 - g;',
        '  vec3 i1 = min(g.xyz, l.zxy);',
        '  vec3 i2 = max(g.xyz, l.zxy);',
        '  vec3 x1 = x0 - i1 + C.xxx;',
        '  vec3 x2 = x0 - i2 + C.yyy;',
        '  vec3 x3 = x0 - D.yyy;',
        '  i = mod289(i);',
        '  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));',
        '  float n_ = 0.142857142857;',
        '  vec3 ns = n_ * D.wyz - D.xzx;',
        '  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);',
        '  vec4 x_ = floor(j * ns.z);',
        '  vec4 y_ = floor(j - 7.0 * x_);',
        '  vec4 x = x_ * ns.x + ns.yyyy;',
        '  vec4 y = y_ * ns.x + ns.yyyy;',
        '  vec4 h = 1.0 - abs(x) - abs(y);',
        '  vec4 b0 = vec4(x.xy, y.xy);',
        '  vec4 b1 = vec4(x.zw, y.zw);',
        '  vec4 s0 = floor(b0)*2.0 + 1.0;',
        '  vec4 s1 = floor(b1)*2.0 + 1.0;',
        '  vec4 sh = -step(h, vec4(0.0));',
        '  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;',
        '  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;',
        '  vec3 p0 = vec3(a0.xy,h.x);',
        '  vec3 p1 = vec3(a0.zw,h.y);',
        '  vec3 p2 = vec3(a1.zw,h.z);',
        '  vec3 p3 = vec3(a1.zw,h.w);',
        '  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));',
        '  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;',
        '  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);',
        '  m = m * m;',
        '  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));',
        '}',
        'void main() {',
        `  float normalizedRadius = smoothstep(${DISK_INNER_RADIUS.toFixed(2)}, ${DISK_OUTER_RADIUS.toFixed(2)}, vRadius);`,
        '  float spiral = vAngle * 3.0 - (1.0 / (normalizedRadius + 0.1)) * 2.0;',
        '  vec2 noiseUv = vec2(vUv.x + uTime * uFlowSpeed * (2.0 / (vRadius * 0.3 + 1.0)) + sin(spiral) * 0.1, vUv.y * 0.8 + cos(spiral) * 0.1);',
        '  float noiseVal1 = snoise(vec3(noiseUv * uNoiseScale, uTime * 0.15));',
        '  float noiseVal2 = snoise(vec3(noiseUv * uNoiseScale * 3.0 + 0.8, uTime * 0.22));',
        '  float noiseVal3 = snoise(vec3(noiseUv * uNoiseScale * 6.0 + 1.5, uTime * 0.3));',
        '  float noiseVal = (noiseVal1 * 0.45 + noiseVal2 * 0.35 + noiseVal3 * 0.2);',
        '  noiseVal = (noiseVal + 1.0) * 0.5;',
        '  vec3 color = uColorOuter;',
        '  color = mix(color, uColorMid3, smoothstep(0.0, 0.25, normalizedRadius));',
        '  color = mix(color, uColorMid2, smoothstep(0.2, 0.55, normalizedRadius));',
        '  color = mix(color, uColorMid1, smoothstep(0.5, 0.75, normalizedRadius));',
        '  color = mix(color, uColorHot, smoothstep(0.7, 0.95, normalizedRadius));',
        '  color *= (0.5 + noiseVal * 1.0);',
        '  float brightness = pow(1.0 - normalizedRadius, 1.0) * 3.5 + 0.5;',
        '  brightness *= (0.3 + noiseVal * 2.2);',
        '  float pulse = sin(uTime * 1.8 + normalizedRadius * 12.0 + vAngle * 2.0) * 0.15 + 0.85;',
        '  brightness *= pulse;',
        '  float alpha = uDensity * (0.2 + noiseVal * 0.9);',
        '  alpha *= smoothstep(0.0, 0.15, normalizedRadius);',
        '  alpha *= (1.0 - smoothstep(0.85, 1.0, normalizedRadius));',
        '  alpha = clamp(alpha, 0.0, 1.0);',
        '  gl_FragColor = vec4(color * brightness, alpha);',
        '}',
      ].join('\n'),
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const diskGeometry = new THREE.RingGeometry(
      DISK_INNER_RADIUS, DISK_OUTER_RADIUS,
      small ? 128 : 192, small ? 48 : 80
    );
    const accretionDisk = new THREE.Mesh(diskGeometry, diskMaterial);
    accretionDisk.rotation.x = DISK_TILT_ANGLE;
    accretionDisk.renderOrder = 1;
    scene.add(accretionDisk);

    const resize = () => {
      const w = Math.max(1, mount.clientWidth);
      const h = Math.max(1, mount.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
      (lensingPass.uniforms as Record<string, { value: unknown }>)['aspectRatio'].value = w / h;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    const clock = new THREE.Clock();
    const holeScreen = new THREE.Vector3();
    let raf = 0;
    let disposed = false;

    const renderFrame = () => {
      const elapsed = clock.getElapsedTime();
      const delta = Math.min(clock.getDelta(), 0.05);
      diskMaterial.uniforms.uTime.value = elapsed;
      starMaterial.uniforms.uTime.value = elapsed;
      eventHorizonMat.uniforms.uTime.value = elapsed;
      (eventHorizonMat.uniforms.uCameraPosition.value as THREE.Vector3).copy(camera.position);
      holeScreen.copy(blackHoleMesh.position).project(camera);
      (lensingPass.uniforms as Record<string, { value: THREE.Vector2 }>)['blackHoleScreenPos'].value.set(
        (holeScreen.x + 1) / 2,
        (holeScreen.y + 1) / 2
      );
      controls.update();
      stars.rotation.y += delta * 0.003;
      stars.rotation.x += delta * 0.001;
      accretionDisk.rotation.z += delta * 0.005;
      composer.render(delta);
    };

    if (reduced) {
      renderFrame(); // one still frame — motion otherwise fully off
    } else {
      const loop = () => {
        if (disposed) return;
        renderFrame();
        raf = requestAnimationFrame(loop);
      };
      loop();
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        const mat = (mesh as { material?: THREE.Material | THREE.Material[] }).material;
        if (mesh.geometry) mesh.geometry.dispose();
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) mat.dispose();
      });
      starGeometry.dispose();
      try {
        (composer as unknown as { dispose?: () => void }).dispose?.();
      } catch { /* older three — GC handles it */ }
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={mountRef} className={className} aria-hidden="true" />;
}
