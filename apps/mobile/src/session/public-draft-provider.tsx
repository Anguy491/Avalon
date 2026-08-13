import {
  createContext,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

interface PublicDraftContextValue {
  readonly nickname: string;
  readonly setNickname: (nickname: string) => void;
}

const PublicDraftContext = createContext<PublicDraftContextValue | undefined>(
  undefined,
);

export function PublicDraftProvider({ children }: PropsWithChildren) {
  const [nickname, setNickname] = useState('');
  const value = useMemo(() => ({ nickname, setNickname }), [nickname]);
  return (
    <PublicDraftContext.Provider value={value}>
      {children}
    </PublicDraftContext.Provider>
  );
}

export function usePublicDraft(): PublicDraftContextValue {
  const value = useContext(PublicDraftContext);
  if (value === undefined) {
    throw new Error('usePublicDraft must be used within PublicDraftProvider');
  }
  return value;
}
