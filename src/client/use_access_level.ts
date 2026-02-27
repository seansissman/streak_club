import { useEffect, useState } from 'react';

export type AccessLevel = 'user' | 'mod' | 'dev';

const isAccessLevel = (value: unknown): value is AccessLevel =>
  value === 'user' || value === 'mod' || value === 'dev';

export const useAccessLevel = (): AccessLevel => {
  const [accessLevel, setAccessLevel] = useState<AccessLevel>('user');

  useEffect(() => {
    const run = async () => {
      try {
        const response = await fetch('/api/viewer-context');
        if (!response.ok) {
          return;
        }

        const data: unknown = await response.json();
        if (
          typeof data === 'object' &&
          data !== null &&
          'accessLevel' in data &&
          isAccessLevel(data.accessLevel)
        ) {
          setAccessLevel(data.accessLevel);
        }
      } catch {
        // Fall back to least privilege.
      }
    };

    void run();
  }, []);

  return accessLevel;
};
