import type { PropsWithChildren } from 'react';

import { SessionProvider } from '@/session/session-provider';
import { HostAudioPlayer } from '@/audio/host-audio-player';

import './app.scss';

export default function App({ children }: PropsWithChildren) {
  return (
    <SessionProvider>
      {children}
      <HostAudioPlayer />
    </SessionProvider>
  );
}
