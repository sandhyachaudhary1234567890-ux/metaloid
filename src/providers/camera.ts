// Camera placeholder. Frontend may show a real preview via getUserMedia
// when the user grants permission, but AI vision stays mocked.

export type CameraState = 'idle' | 'requesting' | 'live' | 'denied' | 'off';

export async function requestCamera(videoEl: HTMLVideoElement): Promise<MediaStream> {
  // Throws if permission denied — caller maps to polished denied state.
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  videoEl.srcObject = stream;
  await videoEl.play().catch(() => {});
  return stream;
}

export function stopCamera(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}
