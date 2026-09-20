import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Mic, MicOff, Video, VideoOff, Repeat, Volume2, Settings2, PhoneOff, Eye, Scan } from 'lucide-react';
import { requestCamera, stopCamera } from '../providers/camera';
import { analyzeImage } from '../providers/vision';
import { useApp } from '../lib/store';
import { ChatWindow } from './ChatWindow';
import { MetaloidCore } from './MetaloidCore';
import type { ChatMessage } from '../lib/types';
import { uid } from '../lib/storage';
import { cn } from '../lib/cn';

export function LiveCamera({ embedded = false }: { embedded?: boolean }) {
  const { status, setStatus, toast, openModal, sendMessage, activeConv, settings, speakMessage } = useApp();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camState, setCamState] = useState<'idle' | 'requesting' | 'live' | 'denied' | 'off'>('idle');
  const [muted, setMuted] = useState(false);
  const [visionLog, setVisionLog] = useState<ChatMessage[]>([]);
  const [visionPhase, setVisionPhase] = useState<string>('Ready');
  const [facing, setFacing] = useState<'user' | 'environment'>('user');

  const start = async () => {
    if (!videoRef.current) return;
    setCamState('requesting');
    setStatus('vision');
    try {
      const s = await requestCamera(videoRef.current);
      streamRef.current = s;
      setCamState('live');
      setVisionPhase('Looking…');
      toast({ title: 'Live session started', desc: 'Vision is in demo mode' });
    } catch {
      setCamState('denied');
      setStatus('idle');
    }
  };

  const stop = () => {
    stopCamera(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamState('off');
    setStatus('idle');
  };

  useEffect(() => () => stopCamera(streamRef.current), []);

  const flip = async () => {
    setFacing((f) => (f === 'user' ? 'environment' : 'user'));
    toast({ title: 'Camera flipped (demo)' });
  };

  const askVision = async (q: string) => {
    const user: ChatMessage = { id: uid('msg'), role: 'user', content: q, createdAt: Date.now(), vision: true };
    setVisionLog((p) => [...p, user]);
    setStatus('vision');
    for (const ph of ['Scanning…', 'Looking…', 'Analyzing…']) {
      setVisionPhase(ph);
      await new Promise((r) => setTimeout(r, 550));
    }
    setVisionPhase('I can see…');
    const answer = await analyzeImage(q);
    setVisionLog((p) => [...p, { id: uid('msg'), role: 'assistant', content: answer, createdAt: Date.now(), vision: true }]);
    if (settings.autoSpeak && settings.voiceEnabled) {
      setStatus('speaking');
      await speakMessage(answer);
    }
    setVisionPhase('Ready');
    setStatus('idle');
  };

  const allMessages = [...(activeConv?.messages.slice(-6) ?? []), ...visionLog].slice(-12);

  return (
    <div className={cn('flex flex-col', embedded ? 'h-full' : '')}>
      {/* top bar */}
      <div className="flex items-center gap-3 px-1 py-1">
        <span className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.16em] uppercase text-red-400">
          <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" /> LIVE
        </span>
        <span className="chip !py-0.5 !text-[11.5px]"><Eye size={12} className="text-[var(--accent)]" /> Vision enabled · Demo</span>
        <span className="ml-auto text-[12px] text-[var(--fg-muted)] hidden sm:inline">{visionPhase}</span>
      </div>

      <div className="mt-3 grid lg:grid-cols-[1.5fr_1fr] gap-4 flex-1 min-h-0">
        {/* camera view */}
        <div className="relative rounded-2xl overflow-hidden border border-[var(--border)] bg-black min-h-[320px] lg:min-h-[440px] shadow-sm">
          <video
            ref={videoRef}
            className={camState === 'live' ? 'absolute inset-0 w-full h-full object-cover' : 'hidden'}
            muted
            playsInline
            aria-label="Camera preview"
          />
          {camState === 'live' ? (
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute inset-x-8 h-[2px] bg-[var(--accent)] blur-[0.5px] scan-line opacity-75" />
              <div className="absolute inset-4 rounded-xl border border-white/10" />
              <div className="absolute top-4 left-4 flex gap-2">
                <span className="chip !bg-black/60 backdrop-blur !text-[10.5px] !font-semibold !tracking-[0.14em] !text-white/80">YOU · CAMERA</span>
                <span className="chip !bg-black/60 backdrop-blur !text-[11px] !text-white/80"><Scan size={12} /> {visionPhase}</span>
              </div>
              <div className="absolute bottom-4 left-4 right-4 flex justify-center">
                <div className="rounded-full bg-black/60 backdrop-blur px-3.5 py-1.5 text-[12px] text-white/90 border border-white/10">
                  “I’m looking at what you’re showing me.”
                </div>
              </div>
            </div>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-8 bg-[radial-gradient(circle_at_50%_40%,var(--accent-subtle),transparent_65%)]">
              <MetaloidCore status={status === 'vision' ? 'vision' : 'idle'} size={110} />
              <h3 className="mt-5 text-[16px] font-semibold text-[var(--fg)]">
                {camState === 'requesting' ? 'Requesting camera…' : camState === 'denied' ? 'Camera unavailable' : 'Start a live session'}
              </h3>
              <p className="text-[12.5px] text-[var(--fg-muted)] mt-1.5 max-w-[360px]">
                {camState === 'denied'
                  ? 'Permission was blocked. You can still explore the vision demo — no video leaves this device.'
                  : 'Grant camera access for a live preview. AI analysis stays local in this prototype.'}
              </p>
              <div className="mt-5 flex gap-2.5">
                {camState !== 'requesting' && (
                  <button onClick={start} className="btn-primary h-10 px-5 text-[13px]">
                    <Video size={15} /> {camState === 'off' ? 'Restart camera' : 'Enable camera'}
                  </button>
                )}
                {camState === 'requesting' && <div className="shimmer h-10 w-40 rounded-lg" />}
              </div>
            </div>
          )}
        </div>

        {/* agent conversation */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] flex flex-col min-h-[320px] max-h-[560px]">
          <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-full bg-[var(--accent-subtle)] border border-[var(--border)] flex items-center justify-center text-[11px] font-semibold text-[var(--accent)]">m</div>
            <div>
              <div className="text-[12.5px] font-semibold text-[var(--fg)] leading-none">METALOID</div>
              <div className="text-[11px] text-[var(--fg-muted)] mt-0.5">{camState === 'live' ? '● Live · vision active' : '● Ready · vision inactive'}</div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {allMessages.length === 0 ? (
              <div className="p-6 text-center text-[12.5px] text-[var(--fg-muted)]">
                Ask “What am I showing you?” to analyze camera preview.
              </div>
            ) : (
              <ChatWindow messages={allMessages} live />
            )}
          </div>
          <div className="p-3 border-t border-[var(--border-subtle)] flex flex-wrap gap-1.5">
            {['What am I showing you?', 'Describe this scene', 'Analyze image…'].map((q) => (
              <button key={q} onClick={() => { askVision(q); sendMessage(q, { vision: true }); }} className="chip hover:bg-[var(--surface-hover)] transition-colors text-[12px]">
                {q}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* bottom controls */}
      <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
        <LiveBtn label={muted ? 'Unmute' : 'Mute'} onClick={() => setMuted((m) => !m)} Icon={muted ? MicOff : Mic} off={muted} />
        <LiveBtn label="Camera" onClick={() => (camState === 'live' ? stop() : start())} Icon={camState === 'live' ? Video : VideoOff} off={camState !== 'live'} />
        <LiveBtn label="Flip" onClick={flip} Icon={Repeat} />
        <LiveBtn label="Speaker" onClick={() => toast({ title: 'Speaker toggled (demo)' })} Icon={Volume2} />
        <LiveBtn label="Settings" onClick={() => toast({ title: 'Live settings (demo)' })} Icon={Settings2} />
        <button
          onClick={() => openModal('end-live')}
          className="btn-danger h-10 px-4 text-[13px]"
        >
          <PhoneOff size={15} /> End
        </button>
      </div>
      <AnimatePresence>
        {camState === 'requesting' && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center text-[11.5px] text-[var(--fg-muted)] mt-2">Waiting for camera permission…</motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

function LiveBtn({ label, onClick, Icon, off }: { label: string; onClick: () => void; Icon: typeof Mic; off?: boolean }) {
  return (
    <button
      onClick={onClick} title={label} aria-label={label}
      className={cn(
        'w-10 h-10 rounded-xl border flex items-center justify-center transition-all active:scale-95',
        off ? 'border-[var(--border)] bg-[var(--surface-sunken)] text-[var(--fg-muted)]' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] hover:bg-[var(--surface-hover)]'
      )}
    ><Icon size={16} /></button>
  );
}
