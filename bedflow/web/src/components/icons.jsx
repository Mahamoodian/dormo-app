const I = ({ d, className = 'h-5 w-5', ...p }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} {...p}>
    {d}
  </svg>
);
export const IconHome = (p) => <I {...p} d={<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>} />;
export const IconBed = (p) => <I {...p} d={<><path d="M3 18V7" /><path d="M21 18v-5a3 3 0 0 0-3-3H8v8" /><path d="M3 14h18" /><circle cx="6" cy="10.5" r="1.5" /></>} />;
export const IconCash = (p) => <I {...p} d={<><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 9.5v5M18 9.5v5" /></>} />;
export const IconUsers = (p) => <I {...p} d={<><circle cx="9" cy="8" r="3.2" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3 3 0 0 1 0 6M21.5 20a5.5 5.5 0 0 0-4-5.3" /></>} />;
export const IconReceipt = (p) => <I {...p} d={<><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z" /><path d="M9 8h6M9 12h6" /></>} />;
export const IconBuilding = (p) => <I {...p} d={<><rect x="4" y="3" width="16" height="18" rx="1.5" /><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10 21v-3h4v3" /></>} />;
export const IconMenu = (p) => <I {...p} d={<path d="M4 6h16M4 12h16M4 18h16" />} />;
export const IconX = (p) => <I {...p} d={<path d="M6 6l12 12M18 6 6 18" />} />;
export const IconPlus = (p) => <I {...p} d={<path d="M12 5v14M5 12h14" />} />;
export const IconSearch = (p) => <I {...p} d={<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>} />;
export const IconChevron = (p) => <I {...p} d={<path d="m9 6 6 6-6 6" />} />;
export const IconLogout = (p) => <I {...p} d={<><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l-5-5 5-5M5 12h11" /></>} />;
export const IconShield = (p) => <I {...p} d={<path d="M12 3 4.5 6v6c0 4.5 3.2 8 7.5 9 4.3-1 7.5-4.5 7.5-9V6z" />} />;
export const IconKey = (p) => <I {...p} d={<><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M17 6l3 3" /></>} />;
export const IconChart = (p) => <I {...p} d={<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />} />;
export const IconEye = (p) => <I {...p} d={<><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>} />;
export const IconPhone = (p) => <I {...p} d={<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />} />;
export const IconTrash = (p) => <I {...p} d={<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />} />;
export const IconEdit = (p) => <I {...p} d={<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />} />;
export const IconDoor = (p) => <I {...p} d={<><path d="M4 21h16M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17" /><circle cx="14.5" cy="12" r=".8" /></>} />;
