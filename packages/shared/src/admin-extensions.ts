/** Display metadata only. Extensions authenticate on their own origin. */
export interface AdminExtension {
  id: string;
  label: string;
  url: string;
  minRole: 'owner' | 'admin' | 'staff';
}
