'use client';

import { useEffect } from 'react';

// Tiny version switch. In v2 context it stamps the version cookie to 'v2' on
// mount; clicking switches back to v1 (cookie + hard nav to '/'). Styling comes
// from the `.v2-ver` class in the sibling-authored v2.css.
export function VersionToggle() {
  useEffect(() => {
    document.cookie = 'sentinel.version=v2; path=/; max-age=31536000';
  }, []);

  const toV1 = () => {
    document.cookie = 'sentinel.version=v1; path=/; max-age=31536000';
    window.location.href = '/';
  };

  return (
    <button type="button" className="v2-ver" onClick={toV1} title="Switch to v1">
      <span>v2</span>
      <span aria-hidden>→ v1</span>
    </button>
  );
}
