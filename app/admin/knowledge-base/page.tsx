'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

// Preserve bookmarks without maintaining a second knowledge editor.
export default function KnowledgeBasePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/admin/creator');
  }, [router]);

  return (
    <p role="status">
      Knowledge is now managed in{' '}
      <Link href="/admin/creator" className="underline">Logo Creator</Link>.
    </p>
  );
}
