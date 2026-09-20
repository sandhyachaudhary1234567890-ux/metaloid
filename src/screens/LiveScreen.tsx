import { LiveCamera } from '../components/LiveCamera';

export function LiveScreen() {
  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-8 py-6 pb-32 md:pb-10 h-full">
      <LiveCamera />
      <p className="text-center text-[12px] text-zinc-600 mt-4">
        Frontend only — camera preview is local. Vision answers are simulated. No video leaves this device.
      </p>
    </div>
  );
}
