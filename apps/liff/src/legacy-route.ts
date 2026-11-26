/**
 * Translate links emitted by the Worker-served LIFF client into the path
 * routes used by the Pages LIFF client. Keeping this compatibility layer
 * means links already delivered to users continue to work after an install
 * changes topology during an update.
 */
export function legacyQueryTarget(search: string): string {
  const params = new URLSearchParams(search);
  const page = params.get('page');
  params.delete('page');

  let pathname = '/booking';
  switch (page) {
    case 'webinar': {
      const slug = params.get('slug');
      if (!slug) break;
      params.delete('slug');
      pathname = `/webinar/${encodeURIComponent(slug)}`;
      break;
    }
    case 'event': {
      const id = params.get('id');
      if (!id) break;
      params.delete('id');
      pathname = `/events/${encodeURIComponent(id)}`;
      break;
    }
    case 'event-me':
      pathname = '/events/me';
      break;
    case 'affiliate':
      pathname = '/affiliate';
      break;
    case 'book':
    case 'salon-book':
    case null:
      pathname = '/booking';
      break;
    default:
      // The Pages app does not implement every Worker-client page (notably
      // forms). Preserve today's fallback instead of inventing a broken path.
      pathname = '/booking';
  }

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
